# 01. Dependency Graph Theory & Schema

[⬅ Previous: Authority Decisions](../02-requirements/03-authority-decisions-and-dispositions.md) | [Master Table of Contents](../README.md) | [Next: Topological Conflict-Free Batching ➡](./02-topological-conflict-free-batching.md)

---

## 🕸️ Why Formal Graph Theory in Autonomous Orchestration?

Complex engineering initiatives cannot be represented as naive linear to-do lists or unstructured markdown checklists. When autonomous AI agents operate on real codebases, linear task execution creates crippling bottlenecks, while uncontrolled concurrency introduces destructive race conditions, git merge collisions, and untraceable regressions.

In non-trivial multi-agent engineering:

- **Task D** depends on the completed artifacts and validated interfaces of **Task A** and **Task B**.
- **Task C** operates in an entirely disjoint directory from **Task A** and must execute concurrently in parallel wave lanes.
- **Task E** produces database migration schemas consumed by backend services in **Task F**.
- Multiple tasks cross-cut identical semantic topic domains or high-level product obligations.

To model these multidimensional constraints deterministically, `olt` compiles a **Strict Relational Directed Acyclic Graph (DAG)** via `plan:add` and `plan:compile`.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE TWO-GRAPH ARCHITECTURAL SEPARATION                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. THE PLAN GRAPH (state.graph)                                            │
│     • Authoritative mathematical execution DAG                              │
│     • Exactly 8 node types and 10 edge types                                │
│     • Strict acyclicity invariant on depends_on edges (Cycle-Free)          │
│     • Drives topological sorting, wave batching, and lease safety           │
│                                                                             │
│  2. THE NARRATIVE GRAPH (summary/graph.json)                                │
│     • Comprehensive post-execution audit dataset                            │
│     • Rich 19-edge vocabulary, chronological step sequence, evidence links  │
│     • Constructed by summary:export for human review and compliance audits   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏷️ The 8 Formal Node Types

The `olt` plan graph schema is strictly closed. It recognizes exactly eight formal node types, preventing schema drift and ambiguous execution semantics:

```text
+---------------------------------------------------------------------------------------------------+
|                                      THE 8 FORMAL NODE TYPES                                      |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  1. requirement  ---> An atomic, testable obligation decomposed from the user prompt.             |
|  2. task         ---> An executable unit of work with exclusive write scopes, gates, and lease.  |
|  3. artifact     ---> A concrete deliverable, file collection, or build target produced by work.  |
|  4. gate         ---> A literal, non-interactive verification command contract proving acceptance.|
|  5. agent        ---> A leased worker identity registered in state.agents (Tier 2/3).             |
|  6. finding      ---> A structured defect report or probe demand issued by an adversary.         |
|  7. decision     ---> An audited user authority grant/decline or architectural fork.              |
|  8. topic        ---> A high-level semantic grouping or domain concept.                          |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

### Node Schema Specifications

| Node Type         | Key Properties                                                           | Mutability             | Lifecycle Owner                     |
| :---------------- | :----------------------------------------------------------------------- | :--------------------- | :---------------------------------- |
| **`requirement`** | `id`, `line_number`, `text`, `status`, `authority_gate`, `disposition`   | Frozen at compile      | `plan:compile` / `authority:decide` |
| **`task`**        | `id`, `label`, `write_scope`, `priority`, `effort`, `status`, `lease`    | State machine evolves  | Implementer / Repairer              |
| **`artifact`**    | `id`, `path`, `content_hash`, `mime_type`, `produced_by`                 | Immutable once created | Task execution / `task:submit`      |
| **`gate`**        | `id`, `command`, `argv`, `working_dir`, `timeout_ms`, `scope`            | Frozen at compile      | `plan:compile` / `gate:prove`       |
| **`agent`**       | `id`, `role`, `host`, `model`, `thinking_level`, `status`, `parent`      | Dynamic registry       | `agent:register` / `agent:release`  |
| **`finding`**     | `id`, `kind` (`defect`\|`probe_demand`), `severity`, `remediation`       | Immutable append       | Validator / Critic                  |
| **`decision`**    | `id`, `actor`, `decision` (`grant`\|`decline`), `rationale`, `timestamp` | Append-only ledger     | `authority:decide`                  |
| **`topic`**       | `id`, `label`, `description`, `domain_tag`                               | Static / Descriptive   | `plan:enhance`                      |

---

## 🔗 The 10 Edge Types & Directionality Matrix

Edges represent directional semantic and execution relationships between nodes. Every edge belongs to a strictly typed, closed vocabulary:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DIRECTED EDGE TOPOLOGY                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│      [task] ────────────── depends_on (Prerequisite) ────────────► [task]   │
│         │                                                             │     │
│         ├──────────────── implements ──────────────────► [requirement]       │
│         │                                                     │             │
│         ├──────────────── produces ────────────────────► [artifact]          │
│         │                                                     ▲             │
│         ├──────────────── assigned_to ─────────────────► [agent]             │
│         │                                                     │             │
│      [gate] ────────────── validates ─────────────────────────┤             │
│         │                                                     ▼             │
│  [requirement] ─────────── evidenced_by ───────────────► [command]          │
│         ▲                                                     │             │
│         └──────────────── discovered_from ─────────────► [finding]          │
│                                                               │             │
│      [finding] ─────────── blocks ─────────────────────► [task]             │
│                                                                             │
│      [task / artifact] ─── supersedes ─────────────────► [task / artifact]  │
│      [any node] ────────── relates_to ─────────────────► [any node]         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Complete Edge Specification Matrix

| Edge Type             | Source Node Type          | Target Node Type       | Execution Semantics & Invariants                                                                                                                                |
| :-------------------- | :------------------------ | :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`depends_on`**      | `task`                    | `task` (Prerequisite)  | **Directional Execution Prerequisite.** Target must reach `done` status before Source becomes eligible for wave scheduling. **Must be strictly acyclic (DAG).** |
| **`implements`**      | `task`                    | `requirement`          | Binds executable units of work to decomposed prompt obligations. Mandatory 100% coverage rule.                                                                  |
| **`produces`**        | `task`                    | `artifact`             | Declares file deliverables or schema assets generated upon task submission.                                                                                     |
| **`validates`**       | `gate` / `agent`          | `task` / `requirement` | Binds verification gates or validator agents to units of work.                                                                                                  |
| **`evidenced_by`**    | `requirement` / `finding` | `gate` / `command`     | Points to cryptographic command execution receipts (`commands/C-<uuid>/record.json`).                                                                           |
| **`assigned_to`**     | `task`                    | `agent`                | Records active worker leases, lineage, and role capability bindings.                                                                                            |
| **`discovered_from`** | `finding`                 | `task` / `gate`        | Traces defect origin or probe demand back to the originating task execution.                                                                                    |
| **`supersedes`**      | `task` / `artifact`       | `task` / `artifact`    | Tracks versioning and replacement across plan revisions ($R_1 \to R_2$).                                                                                        |
| **`blocks`**          | `finding`                 | `task`                 | Prevents task completion while open findings remain unresolved.                                                                                                 |
| **`relates_to`**      | Any Node                  | Any Node               | Semantic grouping and associative relations. **Cycles permitted.**                                                                                              |

---

## 🔄 Execution DAG vs. Relational Cycles

The `olt` engine enforces a strict mathematical boundary between **Execution Dependencies** and **Semantic Relations**:

1. **`depends_on` (Execution Graph): MUST BE STRICTLY ACYCLIC (DAG)**
   - Cyclic execution dependencies (e.g., $T_A \to T_B \to T_A$) represent deadlock conditions where neither task can ever start.
   - The graph engine executes Tarjan's Strongly Connected Components algorithm during `plan:compile`. Any non-trivial component immediately aborts compilation with `INTEGRITY_CYCLE_DETECTED`.

2. **`relates_to` (Semantic Graph): CYCLES FULLY PERMITTED**
   - High-level domain concepts and topics (e.g., `Authentication` $\leftrightarrow$ `Session Storage`) frequently have bidirectional semantic links.
   - Semantic cycles do not enter the scheduling pipeline and do not impact topological wave calculation.

```text
       EXECUTION GRAPH (Strict DAG)                 SEMANTIC GRAPH (Cycles Allowed)

           ┌──────────────┐                             ┌──────────────┐
           │  Task-Auth   │                             │  Topic-Auth  │
           └──────┬───────┘                             └──────▲───────┘
                  │                                            │       ▲
            depends_on                               relates_to│       │relates_to
                  │                                            ▼       │
                  ▼                                     ┌──────────────┴┐
           ┌──────────────┐                             │  Topic-Session│
           │  Task-Route  │                             └───────────────┘
           └──────────────┘
        (Acyclic: No deadlock)                       (Cyclic: Domain context only)
```

---

## 🧭 Tarjan Strongly Connected Components Cycle Detection

Before any plan is compiled or scheduled, the graph engine executes Tarjan's linear-time $O(|V| + |E|)$ cycle detection algorithm (`detectCyclesTarjan`).

### Algorithmic Mechanics

Tarjan's algorithm traverses the execution graph via Depth-First Search (DFS), maintaining two integer indices for each vertex $u$:

- `discoveryIndex[u]`: Monotonically increasing counter when vertex $u$ is first visited.
- `lowlink[u]`: The smallest `discoveryIndex` reachable from $u$ through DFS exploration, including back-edges to nodes currently on the call stack.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TARJAN SCC CYCLE DETECTION PIPELINE                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  For each unvisited vertex u in state.graph.tasks:                          │
│    1. Set discoveryIndex[u] = lowlink[u] = ++currentIndex                   │
│    2. Push u onto active traversal stack S                                  │
│    3. For each directed edge (u, v) in depends_on:                          │
│         if v is unvisited:                                                  │
│           DFS(v)                                                            │
│           lowlink[u] = min(lowlink[u], lowlink[v])                          │
│         else if v is currently on stack S:                                  │
│           lowlink[u] = min(lowlink[u], discoveryIndex[v])  <-- BACK-EDGE!   │
│    4. If lowlink[u] == discoveryIndex[u]:                                   │
│         Pop nodes from stack S until u is popped.                           │
│         If popped set size > 1 (or self-loop):                              │
│           --> CYCLE DETECTED! Emit exact cycle path and fail compile.       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

If a cycle is detected, `plan:compile` produces a structured diagnostics report containing the exact cycle chain, the involved write scopes, and prescriptive remediation instructions:

```text
{"ok":false,"error":{"code":"INTEGRITY","message":"Cyclic dependency detected in planning buffer: task-auth -> task-db -> task-auth. Execution graph must be a Directed Acyclic Graph (DAG). Remove circular depends_on edge to proceed.","issues":[{"cycle":["task-auth","task-db","task-auth"]}]}}
```

---

## 📐 Sugiyama 4-Phase Hierarchical Layout Engine

To provide visual clarity in terminal interfaces without resorting to external web viewers or heavy GUI dependencies, `olt` incorporates an in-engine **Sugiyama 4-Phase Hierarchical DAG Renderer** (`dag:render`, aliased as `graph:sugiyama`).

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SUGIYAMA 4-PHASE HIERARCHICAL LAYOUT                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Phase 1: Layered Ranking (Longest Path Layer Assignment)                  │
│    Assigns discrete integer ranks L_0, L_1, ..., L_k such that              │
│    rank(v) >= rank(u) + 1 for every directed edge (u, v) in depends_on.     │
│                                  │                                          │
│                                  ▼                                          │
│  Phase 2: Dummy Node Normalization                                          │
│    Splits multi-layer edges (where rank(v) - rank(u) > 1) into chains of    │
│    synthetic dummy vertices so every segment connects strictly adjacent     │
│    layers L_i and L_{i+1}.                                                  │
│                                  │                                          │
│                                  ▼                                          │
│  Phase 3: Barycenter Crossing Minimization                                  │
│    Iteratively sweeps up and down adjacent layers. Computes the average      │
│    neighbor position for every vertex u:                                    │
│      barycenter(u) = (1 / deg(u)) * sum_{v in Neighbors(u)} position(v)     │
│    Sorts vertices within each layer to minimize visual edge crossings.      │
│                                  │                                          │
│                                  ▼                                          │
│  Phase 4: Orthogonal Grid Assignment & Box Rendering                        │
│    Computes column offsets, routes orthogonal ASCII/Unicode interconnects,  │
│    and renders rounded/sharp/ascii terminal boxes with live state badges.   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Live Visual Execution Rendering

Running `dag:render` generates an interactive, high-fidelity ASCII/Unicode topology map directly in the terminal:

```bash
bun harness.ts dag:render --run .capsules/<slug> --box-style rounded
```

```text
### Sugiyama Hierarchical DAG: slugger (Revision 1)
- **Status**: Compiled Plan (4 tasks across 3 waves)
- **Cycle Diagnostics**: PASSED ✅ (No dependency cycles detected)
- **Bypass Diagnostics**: PASSED ✅ (No illegal transitive layer bypasses)
- **Work/Span Telemetry**: Work W=12 units, Span S=4 units, Parallelism Factor P=3.00x

Layer 0 (Wave 1):
┌──────────────────────────────┐       ┌──────────────────────────────┐
│ task-schema                  │       │ task-token-gen               │
│ (✓ PASSED)                   │       │ (🟢 RUNNING)                 │
│ Scope: src/db/schema.ts      │       │ Scope: src/auth/token.ts     │
│ Gate: bun test tests/db.test │       │ Gate: bun test tests/tok.test│
└──────────────┬───────────────┘       └──────────────┬───────────────┘
               │                                      │
               ▼                                      ▼
Layer 1 (Wave 2):
┌─────────────────────────────────────────────────────────────────────┐
│ task-auth-service                                                   │
│ (⏳ BLOCKED)                                                        │
│ Scope: src/auth/service.ts                                          │
│ Gate: bun test tests/auth.test.ts                                   │
│ Deps: task-schema, task-token-gen                                   │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
Layer 2 (Wave 3):
┌──────────────────────────────┐       ┌──────────────────────────────┐
│ task-api-routes              │       │ task-cli-wiring              │
│ (⏳ BLOCKED)                 │       │ (⏳ BLOCKED)                 │
│ Scope: src/api/routes.ts     │       │ Scope: src/cli/index.ts      │
│ Gate: bun test tests/api.test│       │ Gate: bun test tests/cli.test│
└──────────────────────────────┘       └──────────────────────────────┘
```

### Deterministic State Badge Vocabulary

| Status Code                   | Visual Badge     | Formal Meaning & Scheduling Impact                                |
| :---------------------------- | :--------------- | :---------------------------------------------------------------- |
| `done`, `satisfied`, `passed` | `✓ PASSED`       | Task execution verified, gates passed, and review signed off.     |
| `leased`, `running`, `active` | `🟢 RUNNING`     | Worker holds active lease and sends regular heartbeats.           |
| `validating`                  | `🔄 VALIDATING`  | Independent validator executing probe and gate checks.            |
| `validated`                   | `🟣 VALIDATED`   | All adversarial probes and gate checks satisfied.                 |
| `ready`, `retry_ready`        | `○ READY`        | Dependencies satisfied; claimable immediately in current wave.    |
| `proposed`, `blocked`         | `⏳ BLOCKED`     | Prerequisite tasks or ungranted authority gates pending.          |
| `changes_requested`           | `🔴 CHANGES_REQ` | Validator pushback; available for repairer claim.                 |
| `failed`, `rejected`          | `❌ REJECTED`    | Terminal failure or unrecoverable defect.                         |
| `escalated`                   | `🚨 ESCALATED`   | Max repair budget (6 rounds) exhausted; requires human authority. |

---

## 🤖 Deriving Granular Tasks From a Glob: `--auto-partition`

A common failure mode in autonomous planning is **monolithic task compression**: an AI planner combines 10 separate file implementations into 1 huge task to minimize planning overhead. This destroys parallel execution speedup.

To eliminate this failure mode mechanically, `plan:add` provides `--auto-partition`. The planner specifies a filesystem glob pattern, and the harness enumerates disk matches to derive independent, parallel root tasks:

```bash
bun harness.ts plan:add --run .capsules/<slug> --actor planner --id task-curriculum \
  --label "Curriculum module" --auto-partition "src/curriculum/**/*.ts" \
  --gate-template "bun test tests/{scope}.test.ts" --group-by file
```

### Partitioning Invariants & Rules

1. **Mutual Exclusion**: `--auto-partition` is mutually exclusive with `--scope`, `--gate`, `--deps`, and `--dep-reason`. Auto-partitioned tasks derive scopes and gates mechanically from disk.
2. **Template Substitution**: `--gate-template` must contain the literal `{scope}` placeholder, dynamically substituted with each matched file or directory path.
3. **Grouping Strategy**:
   - `--group-by file` (default): Emits exactly one independent task per matched file.
   - `--group-by directory`: Emits one task per distinct directory containing matches, setting the write scope to the directory and binding all contained files.
4. **Deterministic Identifier Generation**: Every generated task id is `<id-prefix>-<slugified-scope>`, ensuring consistent, collision-free node identifiers.
5. **Path Safety**: The glob engine traverses physical repository files, skipping `.git`, `.capsules`, `node_modules`, `.bun`, `coverage`, and symlinks. If zero files match, compilation throws `INVALID_ARGUMENT` rather than silently generating an empty plan.

---

## 📋 The Mandatory Topology Declaration (C6)

A central invariant of `olt` is that **artificial serialization barriers are forbidden**. Every dependency edge declared between tasks must carry a verifiable, machine-auditable justification explaining the exact data flow or semantic prerequisite.

```bash
bun harness.ts plan:add --run .capsules/<slug> --actor coordinator --id task-api \
  --label "REST API Endpoints" --scope src/api --gate "bun test tests/api" \
  --deps task-db,task-auth \
  --dep-reason "task-db:imports database client and typeorm entities generated by task-db" \
  --dep-reason "task-auth:requires JWT validation middleware exported from task-auth"
```

### Mechanical Declaration Invariant

- `plan:compile` verifies that every dependency ID listed in `--deps` possesses an exact corresponding `--dep-reason "<task-id>:<reason>"`.
- If any edge lacks justification, `plan:compile` halts immediately:

```text
{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"dependency edge(s) without a declared justification: task-api -> task-db. Pass plan:add --dep-reason <dep-id>:\"<why this edge exists>\" for each one before compiling.","issues":[]}}
```

This mechanical gate forces planning agents to articulate why two tasks cannot run concurrently, preventing accidental serialization of disjoint engineering scopes.

---

[⬅ Previous: Authority Decisions](../02-requirements/03-authority-decisions-and-dispositions.md) | [Master Table of Contents](../README.md) | [Next: Topological Conflict-Free Batching ➡](./02-topological-conflict-free-batching.md)
