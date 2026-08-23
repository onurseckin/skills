# 02. Topological Conflict-Free Batching & Concurrency Scaling

[⬅ Previous: Dependency Graph Theory](./01-dependency-graph-theory.md) | [Master Table of Contents](../README.md) | [Next: Plan Revision & Freezing ➡](./03-plan-revision-and-freezing.md)

---

## ⚡ The Single Authority for "What May Run Together"

In autonomous multi-agent software engineering, executing tasks concurrently without mathematical safety guarantees results in catastrophic write collisions, clobbered files, and invalidated test suites.

In `olt`, there is exactly **one** deterministic function that decides which tasks are eligible to run together: **`proposeBatch`**.

Every command that queries, inspects, or dispatches work relies exclusively on `proposeBatch`:

- `queue:wave` (read-only wave inspector)
- `queue:next` (peek next runnable task)
- `queue:pop` (lease next runnable task)
- `queue:list` (list ready candidate queue)
- `plan:compile` (records the initial execution topology in `state.topology`)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                   THE SINGLE SCHEDULING AUTHORITY: proposeBatch             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                                [ state.graph ]                              │
│                                [ state.tasks ]                              │
│                                       │                                     │
│                                       ▼                                     │
│                          ┌─────────────────────────┐                        │
│                          │      proposeBatch()     │                        │
│                          └────────────┬────────────┘                        │
│                                       │                                     │
│         ┌──────────────┬──────────────┼──────────────┬──────────────┐       │
│         ▼              ▼              ▼              ▼              ▼       │
│   [queue:wave]   [queue:next]   [queue:pop]    [queue:list]   [state.topo]  │
│                                                                             │
│   INVARIANT: Zero divergence. Every tool sees the exact same batch order.   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧮 The 5-Step Batching Algorithm

The batching engine evaluates the entire task graph through five deterministic stages:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       THE 5-STEP BATCHING PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Step 1: Plan State Guard                                                   │
│    Rejects scheduling unless state.graph exists and revision >= 1.          │
│    → Error: "a plan must be applied before scheduling"                      │
│                                  │                                          │
│                                  ▼                                          │
│  Step 2: Candidate Eligibility Filter                                       │
│    A task T is eligible IF AND ONLY IF:                                     │
│      • status(T) ∈ { proposed, ready, retry_ready }                         │
│      • requirements(T) are actionable (no ungranted authority_gate)         │
│      • write_scope(T) conflicts with NO actively leased running task         │
│      • ALL prerequisite dependencies in depends_on have reached 'done'      │
│                                  │                                          │
│                                  ▼                                          │
│  Step 3: 6-Factor Deterministic Priority Comparator                         │
│    Sorts eligible candidates using a total ordering comparator:             │
│      (priority, criticalDepth, descendants, created_order, effort, id)      │
│                                  │                                          │
│                                  ▼                                          │
│  Step 4: Greedy Conflict-Free Packing Loop                                  │
│    Iterates through sorted candidates. Candidate T is added to wave W       │
│    IF AND ONLY IF write_scope(T) and resource_scope(T) conflict with        │
│    NO task already admitted into wave W.                                    │
│                                  │                                          │
│                                  ▼                                          │
│  Step 5: Concurrency Clamping & Brent Rebalancing                           │
│    Clamps wave size to maxParallel:                                         │
│      |W| <= min(max_parallel, P_brent)                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Active Scope Occupancy Rules

A task **occupies** its write scope on disk when it holds an active, non-dispatchable lease:

- Actively executing states (`leased`, `running`, `validating`) hold locks on their scopes.
- Quiescent terminal states (`done`, `cancelled`, `escalated`, `stale`) release all scope locks.
- `retry_ready` and `ready` tasks are dispatchable candidates and **do not** occupy scopes until claimed. This prevents mutual deadlocks where two unleased tasks block each other from entering the candidate pool.

---

## 🥇 The 6-Factor Deterministic Ranking Comparator

When multiple independent tasks are eligible, the scheduler sorts them deterministically using a six-factor comparator. Ties fall through sequentially to the next factor, culminating in a total tie-breaker on task ID:

| Factor | Metric Property |         Direction         | Mathematical & Architectural Rationale                                                              |
| :----: | :-------------- | :-----------------------: | :-------------------------------------------------------------------------------------------------- |
| **1**  | `priority`      | Descending ($\downarrow$) | Explicit business value declared in `plan:add --priority <N>` (Default: 50).                        |
| **2**  | `criticalDepth` | Descending ($\downarrow$) | Longest directed downstream dependency chain ($\text{Span}$). Unblocks the deepest execution paths. |
| **3**  | `descendants`   | Descending ($\downarrow$) | Count of all downstream transitive dependent tasks. Maximizes subsequent wave concurrency.          |
| **4**  | `created_order` |  Ascending ($\uparrow$)   | FIFO fairness preserving authoring order.                                                           |
| **5**  | `effort`        |  Ascending ($\uparrow$)   | Shortest Job First (SJF) heuristic. Clears short tasks quickly to free worker bandwidth.            |
| **6**  | `id`            |  Ascending ($\uparrow$)   | Lexicographical tie-breaker ($O(1)$ string comparison). Eliminates all non-deterministic sorting.   |

---

## 🛡️ Glob-Aware Write Scope Conflict Detection (`detectScopeOverlap`)

Two write scopes conflict if they could ever match, touch, or contain the same literal file path on disk. The conflict detector implements a rigorous segment-by-segment tree traversal that is fully glob-aware:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WRITE SCOPE CONFLICT DETECTION RULES                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. EXACT MATCH:                                                            │
│     "src/auth/service.ts"  vs  "src/auth/service.ts"   ==> CONFLICT 💥       │
│                                                                             │
│  2. DIRECTORY CONTAINMENT:                                                  │
│     "src/auth"             vs  "src/auth/token.ts"     ==> CONFLICT 💥       │
│     (Parent directory owns all recursive child paths)                       │
│                                                                             │
│  3. RECURSIVE WILDCARD (**):                                                │
│     "src/**/*.ts"          vs  "src/components/nav.ts" ==> CONFLICT 💥       │
│     ("src/**" absorbs arbitrary path segments)                              │
│                                                                             │
│  4. SINGLE-SEGMENT WILDCARD (*):                                            │
│     "src/auth/*.ts"        vs  "src/auth/jwt.ts"       ==> CONFLICT 💥       │
│                                                                             │
│  5. DISJOINT SUBDIRECTORIES:                                                │
│     "src/auth"             vs  "src/database"          ==> ISOLATED ✅       │
│     (Completely parallel-safe; admitted to same wave)                       │
│                                                                             │
│  6. RESOURCE SCOPE COLLISION:                                               │
│     res("port:5432")       vs  res("port:5432")        ==> CONFLICT 💥       │
│     (Resource set intersection non-empty; serialized)                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Path Reachability Matrix

| Scope A         | Scope B             | Overlap Verdict | Algorithmic Rationale                                       |
| :-------------- | :------------------ | :-------------: | :---------------------------------------------------------- |
| `src/auth`      | `src/auth`          |  **CONFLICT**   | Identical literal directory paths.                          |
| `src`           | `src/auth/token.ts` |  **CONFLICT**   | Root `src` directory contains sub-path `src/auth/token.ts`. |
| `docs/**`       | `docs/api/v1/*.md`  |  **CONFLICT**   | Glob `**` matches multi-segment sub-path `docs/api/v1/`.    |
| `src/auth/*.ts` | `src/auth/index.ts` |  **CONFLICT**   | Single-segment wildcard `*.ts` matches `index.ts`.          |
| `src/auth`      | `src/database`      |  **DISJOINT**   | Disjoint directory trees; parallel execution permitted.     |
| `src/user.ts`   | `src/order.ts`      |  **DISJOINT**   | Distinct literal file paths within shared parent directory. |

---

## 📈 Brent Work/Span Dynamic Concurrency Scaling

To dynamically scale agent concurrency without exceeding hardware limits or causing coordinator context exhaustion, `olt` implements **Brent Work/Span DAG Scaling Theory**.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BRENT WORK / SPAN COMPLEXITY MODEL                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  • TOTAL WORK (W = T_1):                                                    │
│      The total execution effort across all tasks executed serially:         │
│        W = sum_{u in V} effort(u)                                           │
│                                                                             │
│  • SPAN / CRITICAL PATH (S = T_infinity):                                   │
│      The maximum effort along any directed path through the DAG:            │
│        S = max_{path P} sum_{v in P} effort(v)                              │
│                                                                             │
│  • BRENT THEORETICAL SPEEDUP BOUND:                                         │
│      For a pool of P parallel agents, total execution time T_P satisfies:   │
│        T_P <= ((W - S) / P) + S                                             │
│                                                                             │
│  • OPTIMAL DYNAMIC CONCURRENCY SCALING (P_opt):                             │
│      The ideal worker pool size before diminishing returns set in:          │
│        P_opt = ceil(W / S)                                                  │
│                                                                             │
│  • SPEEDUP (S_P) AND EFFICIENCY (E_P):                                      │
│      S_P = T_1 / T_P                                                        │
│      E_P = S_P / P = T_1 / (P * T_P)                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Telemetry Integration with Cognitive Memory

The scheduler computes Work/Span metrics upon compilation and persists them into both `metrics.json` and the cognitive memory store (`.olt/memory.json`).

```bash
bun harness.ts dag --run .olt/capsules/<slug> --recommendations
```

```text
### Wave Concurrency Telemetry:
- **Total Work ($W = T_1$)**: 28 effort units
- **Critical Path Span ($S = T_\infty$)**: 7 effort units
- **Theoretical Parallelism Factor**: 4.00x ($P = \lceil 28 / 7 \rceil = 4$)
- **Configured Cap (`default_max_parallel`)**: 8
- **Optimal Worker Pool**: 4 concurrent agents
- **Scheduling Efficiency ($E_P$)**: 87.5%
- **Serial Bottleneck Warning**: Wave 2 restricted to width 1 (Task `task-db-migration`).
- **Optimization Recommendation**: Decompose `task-db-migration` into isolated sub-schemas to reduce critical path Span $S$ from 7 to 4.
```

---

## 👥 Multi-Coordinator Wave Partitioning (> 5 Lanes or Cross-Domain)

When a task wave exceeds 5 parallel lanes, or when tasks span fundamentally distinct architectural domains (e.g., `Frontend UI`, `Backend API`, `Cloud Infrastructure`), a single Tier 2 Coordinator experiences context saturation and message queue latency.

To maintain strict oversight without context degradation, `olt` activates **Multi-Coordinator Domain Partitioning**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MULTI-COORDINATOR DOMAIN PARTITIONING                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                        [ TIER 2: MASTER COORDINATOR ]                       │
│                        (Oversees Run State & Barriers)                      │
│                                      │                                      │
│         ┌────────────────────────────┼────────────────────────────┐         │
│         ▼                            ▼                            ▼         │
│  ┌──────────────┐             ┌──────────────┐             ┌──────────────┐ │
│  │ SUB-COORD A  │             │ SUB-COORD B  │             │ SUB-COORD C  │ │
│  │ (Domain: UI) │             │ (Domain: API)│             │ (Domain: DB) │ │
│  └──────┬───────┘             └──────┬───────┘             └──────┬───────┘ │
│         │                            │                            │         │
│   ┌─────┴─────┐                ┌─────┴─────┐                ┌─────┴─────┐   │
│   ▼           ▼                ▼           ▼                ▼           ▼   │
│ [Impl-UI-1] [Impl-UI-2]      [Impl-API-1] [Impl-API-2]    [Impl-DB-1] [Impl-DB-2]│
│                                                                             │
│ INVARIANTS:                                                                 │
│  1. Disjoint Domain Ledgers: Each Sub-Coordinator manages its own agents.   │
│  2. Independent Heartbeats: Sub-coordinator monitors local worker health.   │
│  3. Aggregation Checkpoint: Master Coordinator enforces wave barriers.      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Partitioning Rules & Operational Protocol

1. **Trigger Condition**: Automatically recommended when wave width $|W| > 5$ or when tasks span distinct domain tags (`domain:ui`, `domain:api`, `domain:infra`).
2. **Sub-Coordinator Registration**: Sub-coordinators register under the Master Coordinator via `agent:register --role coordinator --parent-agent coordinator-master`.
3. **Isolated Token Ledgers**: Each sub-coordinator claims tasks within its domain and mints isolated implementer/validator leases.
4. **Wave Barrier Synchronization**: The Master Coordinator waits for all sub-coordinator domains to reach submission and validation completion before unlocking downstream dependent waves.

---

## 🚫 Hard-Coded Anti-Serialization Mechanical Interlock (`FALSE_SERIALIZATION_BLUNDER`)

A pervasive failure mode in LLM coordinators is **lazy serialization**: when the scheduler presents 4 ready, conflict-free tasks in Wave 1, an LLM agent frequently defaults to dispatching 1 subagent, waiting for it to finish, and then dispatching the next. This turns a high-performance parallel graph into a slow, expensive serial waterfall.

To eliminate this pattern mechanically, `olt` enforces the **Anti-Serialization Interlock**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 ANTI-SERIALIZATION MECHANICAL INTERLOCK                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Scenario: queue:wave returns N ready, conflict-free tasks (N >= 2).        │
│                                                                             │
│  Agent Action: Attempts to dispatch only 1 worker and wait.                 │
│                                                                             │
│  INTERLOCK CHECK:                                                           │
│    Is concurrency constrained by default_max_parallel?                      │
│    Is there an unresolvable resource lock?                                  │
│                                                                             │
│  IF NO (Lanes are genuinely disjoint and capacity is available):            │
│    --> TRIP INTERLOCK! 🚨                                                   │
│    --> Raise Error: FALSE_SERIALIZATION_BLUNDER                             │
│    --> Refuse single-task claim until full wave is claimed or justified.   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Error Code Specification: `FALSE_SERIALIZATION_BLUNDER`

When an agent attempts to execute a single task while multiple independent lanes are claimable, the harness raises a hard refusal:

```text
{"ok":false,"error":{"code":"FALSE_SERIALIZATION_BLUNDER","message":"Anti-serialization interlock tripped: Wave 1 contains 3 ready, conflict-free tasks [task-auth, task-billing, task-analytics], but only 1 agent was dispatched. Serializing parallel-ready work is prohibited. You MUST dispatch all 3 concurrent lanes simultaneously using task:claim across distinct agent identities.","issues":[{"claimable_tasks":["task-auth","task-billing","task-analytics"],"available_capacity":4}]}}
```

### Mechanical Gating Rules

1. **`queue:wave` Inspection**: Whenever `queue:wave` is called, the harness records the active wave width $|W_{\text{ready}}|$.
2. **Dispatch Enforcement**: The coordinator must register and dispatch workers for $\min(|W_{\text{ready}}|, \text{max\_parallel})$ tasks before advancing execution steps.
3. **Explicit Single-Lane Justification**: The interlock can only be bypassed if the coordinator passes `--serialize-reason "<justification>"`, which is recorded permanently in `events.jsonl` as an audited deviation.

---

## 🗺️ The Recorded Topology Schema (`state.topology`)

`plan:compile` records the complete scheduling calculation in `state.topology`. Downstream tools read this structure directly, guaranteeing zero drift between planning and execution:

```json
{
  "revision": 1,
  "max_parallel": 4,
  "brent_telemetry": {
    "total_work": 14,
    "critical_span": 4,
    "parallelism_factor": 3.5,
    "optimal_concurrency": 4
  },
  "waves": [
    {
      "wave": 1,
      "task_ids": ["task-slug", "task-truncate"],
      "domain_partitions": {
        "string-utils": ["task-slug", "task-truncate"]
      }
    }
  ],
  "decisions": [
    {
      "task_id": "task-slug",
      "wave": 1,
      "parallel_with": ["task-truncate"],
      "serialized_after": [],
      "reason": "priority_capacity",
      "rationale": "wave 1: no dependency or write scope conflict; ranked into slot 1 of max_parallel 4",
      "evidence_class": "derived"
    },
    {
      "task_id": "task-truncate",
      "wave": 1,
      "parallel_with": ["task-slug"],
      "serialized_after": [],
      "reason": "priority_capacity",
      "rationale": "wave 1: no dependency or write scope conflict; ranked into slot 2 of max_parallel 4",
      "evidence_class": "derived"
    }
  ]
}
```

### Decision Reason Enumerations

| Reason Code                | Meaning & Causality                                                                                         |
| :------------------------- | :---------------------------------------------------------------------------------------------------------- |
| **`dependency`**           | Task is delayed to a later wave because one or more prerequisite tasks in `depends_on` are not yet `done`.  |
| **`write_scope_conflict`** | Task is delayed because its write scope overlaps with a higher-priority task executing in the current wave. |
| **`priority_capacity`**    | Task is admitted to the current wave based on 6-factor ranking within `max_parallel` capacity.              |
| **`resource_conflict`**    | Task is delayed due to an exclusive resource scope collision (e.g., shared port or database instance).      |

---

[⬅ Previous: Dependency Graph Theory](./01-dependency-graph-theory.md) | [Master Table of Contents](../README.md) | [Next: Plan Revision & Freezing ➡](./03-plan-revision-and-freezing.md)
