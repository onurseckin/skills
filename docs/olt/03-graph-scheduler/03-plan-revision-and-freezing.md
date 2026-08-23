# 03. Plan Revision, Replanning & Immutability

[⬅ Previous: Topological Conflict-Free Batching](./02-topological-conflict-free-batching.md) | [Master Table of Contents](../README.md) | [Next: Chapter 04 — Host-Agnostic Architecture ➡](../04-multi-agent/01-host-agnostic-architecture.md)

---

## ❄️ The Three-Tier Plan Evolution Model

In autonomous multi-agent orchestration, plans must balance two competing requirements: **absolute runtime stability** (to prevent race conditions and broken dependency assumptions) and **adaptive replanning** (to recover from discovered defects and architectural pivots).

To solve this, `olt` implements a **Three-Tier Plan Evolution Model**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THREE-TIER PLAN EVOLUTION MODEL                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ TIER 1: DRAFT BUFFER (Revision 0) ]                                      │
│    • Mutable staging area populated via plan:enhance and plan:add           │
│    • Fully fluid: tasks, scopes, gates, and dependencies can be edited     │
│    • Audited mechanically via plan:audit (Invariants A1-A6)                 │
│                                  │                                          │
│                                  ▼ plan:compile                             │
│                                                                             │
│  [ TIER 2: COMPILED IMMUTABLE FREEZE (Revision 1) ]                         │
│    • Cryptographically bound and written to state.graph                     │
│    • Structural freeze: write scopes, dependencies, produced artifacts      │
│      are permanently locked for the duration of Revision 1                  │
│    • Reviewed by independent Plan-Validator adversary (plan:validate-start) │
│    • Wave scheduling and lease dispatch begin against frozen topology       │
│                                                                             │
│                                  │                                          │
│                                  ▼ plan:replan (Upon findings/defects)      │
│                                                                             │
│  [ TIER 3: MONOTONIC APPEND-ONLY EXPANSION (Revision N+1) ]                 │
│    • Ingests findings, partitions defects into disjoint repair scopes       │
│    • Graph clones Revision N and appends new repair nodes/edges             │
│    • Prior history, completed tasks, and gate receipts remain intact        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔒 The Structural Freeze Invariant

Once `plan:compile` executes and commits Revision 1:

> **Structural task contracts, write scopes, produced artifacts, and prerequisite dependencies freeze permanently for the duration of that graph revision.**

### Why the Freeze is Absolute

1. **Deterministic Concurrency Guarantees**: The scheduler's conflict-free wave guarantees depend entirely on static write scope disjointness. If an active implementer could dynamically expand its write scope, it could instantly collide with a concurrent agent operating in an adjacent directory.
2. **Dependency Integrity**: If a worker could rewrite its own `depends_on` edges mid-flight, it could bypass unvalidated prerequisite contracts or introduce execution deadlocks.
3. **Audit Trail Immutability**: Cryptographic verification requires that completed work cannot be retroactively re-scoped or downgraded.

The freeze is enforced by `guardPlanRevision`: any attempt to mutate a compiled graph without calling `plan:replan` raises `INVALID_STATE: cannot mutate frozen graph revision`.

---

## 🌿 Execution-Time Branching vs. Formal Plan Revisions

When an executing agent discovers that its assigned task is more complex than anticipated, it must choose between two distinct architectural mechanisms:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                   BRANCHING vs. REPLANNING DECISION TREE                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Is the work strictly contained within the task's assigned write scope?     │
│                                                                             │
│         ├──► YES: Use EXECUTION-TIME BRANCHING (branch:open)                │
│         │         • Subdivides work into sub-tasks (e.g., S-1, S-2)         │
│         │         • Sub-scopes must be PROPER SUBSETS of assigned scope     │
│         │         • Parent lease clock freezes; parent resumes on collect   │
│         │         • Never enters the global plan DAG; zero revision bump    │
│         │                                                                   │
│         └──► NO:  Request FORMAL REPLAN (plan:replan)                       │
│                   • Requires new write scopes, new dependencies, or edges   │
│                   • Dispatches fresh repair tasks in a parallel wave        │
│                   • Bumps graph revision monotonically (R_1 -> R_2)         │
│                   • Re-records topology in state.topology                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Comparison Matrix

| Property           | Execution-Time Branching (`branch:open`)         | Plan Revision (`plan:replan`)                     |
| :----------------- | :----------------------------------------------- | :------------------------------------------------ |
| **Scope Boundary** | Strictly proper subset of existing leased scope  | Can allocate new, previously unassigned scopes    |
| **Graph Revision** | Stays at current revision (No DAG change)        | Increments monotonically ($N \to N + 1$)          |
| **Lease Impact**   | Freezes parent lease clock; mints sub-leases     | Spawns new top-level repair task leases           |
| **Target Actor**   | Current implementer agent                        | Master Coordinator / Planner                      |
| **When to Use**    | Internal task parallelism or sub-module division | Contract expansion, missing dependencies, defects |

---

## 🛑 Two Adversaries Around Compilation

To prevent flawed, monolithic, or unverifiable plans from reaching execution, `olt` deploys two independent adversarial gates:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE TWO PLAN ADVERSARIAL GATES                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ PLANNING BUFFER (Revision 0) ]                                           │
│                 │                                                           │
│                 ▼                                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ GATE 1: MECHANICAL PLAN AUDIT (plan:audit / Invariants A1-A6)         │  │
│  │   • Evaluates structural shapes mechanically                          │  │
│  │   • Blocks plan:compile on any blocking finding                       │  │
│  │   • Overrides require granular --accept-audit <id>:<reason>           │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
│                                     │                                       │
│                                     ▼ plan:compile                          │
│                                                                             │
│  [ COMPILED GRAPH (Revision 1) ]                                            │
│                 │                                                           │
│                 ▼                                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ GATE 2: INDEPENDENT PLAN-VALIDATOR (plan:validate-start/review)       │  │
│  │   • Evaluates semantic decomposition and prompt alignment             │  │
│  │   • Independent agent role; answers 4 mandatory questions in writing   │  │
│  │   • Rejection (changes_requested) BLOCKS task:claim across whole run  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Gate 1: The Plan Audit (Six Structural Invariants)

`plan:compile` automatically executes the identical invariant checks as `plan:audit`. Any **blocking** finding halts compilation immediately:

| Invariant ID                 |   Severity    | Failure Mode Detected & Checked                                                                                                                                       |
| :--------------------------- | :-----------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`A1-granularity`**         |   Blocking    | **Monolithic Task Compression**: A single task's write scope expands to $> 3$ files on disk while the overall plan touches $\ge 5$ files.                             |
| **`A2-parallelism`**         | Not Evaluated | Always reported under `not_evaluated`. The harness strictly refuses to fabricate ungrounded entity counts using unreliable NLP heuristics.                            |
| **`A3-gate-discrimination`** |   Blocking    | **Shared Indiscriminate Gate**: Two tasks with disjoint write scopes share byte-identical gate commands, meaning the gate cannot isolate task-specific regressions.   |
| **`A4-false-barrier`**       |   Blocking    | **Unjustified Dependency**: A `depends_on` edge serializes two tasks whose write scopes do not overlap without an explicit read/write justification.                  |
| **`A5-straggler`**           |   Advisory    | **Straggler Risk**: A task's effort estimate is $> 3\times$ the median effort of its wave, risking lane starvation.                                                   |
| **`A6-whole-suite-gate`**    |   Blocking    | **Run-Wide Suite as Task Gate**: A task gate runs the entire test suite rather than scoped tests. (Run-wide verification belongs exclusively to `--completion-gate`). |

#### Granular Audit Overrides

A blocking finding can be overridden with an explicit, attributed justification:

```bash
bun harness.ts plan:compile --run .capsules/<slug> --actor planner \
  --completion-gate "bun test tests/unit" \
  --accept-audit "A3-gate-discrimination:task-a and task-b share common integration fixture"
```

Blanket overrides are strictly rejected. Every overridden invariant requires its own `--accept-audit "<id>:<reason>"`.

### 2. Gate 2: The Independent Plan-Validator Role

While `plan:audit` evaluates structural shapes mechanically, the **Plan-Validator** evaluates whether the decomposition matches the semantic intent of the user prompt.

```bash
bun harness.ts agent:register --run .capsules/<slug> --agent plan-val-1 \
  --role plan-validator --host claude-code --parent-agent coordinator-1

bun harness.ts plan:validate-start --run .capsules/<slug> --validator plan-val-1
```

#### Written Verification Questions

The plan-validator must submit written answers to four mandatory architectural questions:

```bash
bun harness.ts plan:review --run .capsules/<slug> --validator plan-val-1 --token "$PV_TOKEN" \
  --status approved \
  --decomposition-answer "Decomposed into 4 granular tasks matching the 4 prompt modules" \
  --dependency-answer "All 2 dependency edges reflect real schema import requirements" \
  --gate-answer "Each gate targets specific test files corresponding to task write scopes" \
  --straggler-answer "Effort estimates are evenly balanced across wave lanes" \
  --dependency-edges-reviewed "task-api->task-db,task-auth->task-db" \
  --gate-ids-reviewed "gate-db,gate-auth,gate-api,gate-cli" \
  --summary "Decomposition is sound, gates are scope-narrow, and dependencies are justified."
```

#### Mechanical Dispatch Interlock

If the plan-validator issues a `changes_requested` verdict:

- The rejection is permanently bound to the current graph revision digest.
- `task:claim` **refuses every implementer and repairer claim** across the entire repository until a new plan revision is compiled and approved.

---

## 🧨 The `gate:prove` Falsifiability Engine

Static heuristics cannot always determine whether a gate command will legitimately fail when code is missing. `gate:prove` resolves this by testing falsifiability dynamically in an isolated scratch copy:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    GATE FALSIFIABILITY PROOF PIPELINE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Create isolated throwaway scratch directory in /tmp                     │
│  2. Copy entire repository into scratch directory                           │
│  3. In the scratch copy: revert task's write scope to base ref (HEAD)       │
│  4. Execute compiled gate command inside the scratch copy                   │
│                                                                             │
│  VERDICT EVALUATION:                                                        │
│    • Gate exits NON-ZERO (Fails on reverted code):                          │
│      --> PROVEN FALSIFIABLE ✅ (Evidence recorded in gate-proved event)     │
│      --> Satisfies Invariants A3 and A6 automatically without override!     │
│                                                                             │
│    • Gate exits ZERO (Passes despite missing code):                         │
│      --> NOT FALSIFIABLE ❌ (Gate is hollow or uncalibrated)                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

```bash
bun harness.ts gate:prove --run .capsules/<slug> --task task-slug --actor coordinator-1
```

```text
### Gate Proof: `task-slug`
**PROVEN FALSIFIABLE**: exits 1 once `task-slug`'s write scope is reverted to `HEAD`.
- **Gate**: `bun test tests/slug.test.ts`
- **Write scope**: src/slug.ts
- **Scratch Reversion**: 0 restored, 1 removed
- **Duration**: 248ms
- **Integration**: Recorded as gate-proved event; satisfies A3/A6 invariant checks.
```

---

## 📈 Monotonic Replanning via `plan:replan` ($R_1 \to R_2 \to R_N$)

When defects, test failures, or validator findings require structural changes, the coordinator invokes `plan:replan`:

```bash
bun harness.ts plan:replan --run .capsules/<slug> --actor coordinator \
  --findings-file findings.json --gate "bun test tests/repair.test.ts" --round 2
```

### Invariants Maintained During Replanning

1. **Monotonic Increment**: Graph revision increases by exactly one ($R_{\text{new}} = R_{\text{old}} + 1$).
2. **Immutable Source Obligations**: Original prompt lines and requirement nodes are preserved intact.
3. **Preserved Execution History**: Completed tasks (`done`), validated gates, and past event logs survive the recompile.
4. **Disjoint Repair Partitioning**: Ingested findings are partitioned into disjoint write scopes so repair workers can execute concurrently in parallel wave lanes.
5. **Topology Re-recording**: `state.topology` is freshly calculated and committed for the new revision.

---

## ⚡ Dynamic DAG Expansion & Living Tracer Engine (`dag:trace`)

While `state.graph` remains frozen for each revision, real-time execution generates dynamic branches, sub-tasks, and validator probes. The **Living Tracer Engine** reconstructs the full runtime execution state by replaying the hash-chained `events.jsonl` log via `readCapsuleEvents`:

```bash
bun harness.ts dag:trace --run .capsules/<slug> --max-steps 20
```

```text
### Living Dynamic DAG Step Trace: slugger
- **Events Replayed**: 32 total steps across 4 active agents
- **Dynamic Tasks**: 2 static plan tasks, 2 dynamic branch sub-tasks
- **Timeline**: Seq 1 -> Seq 32 (Duration: 84.2s)

  Seq   Time (+ms)   Actor         Role          Tool     Event & Summary
 ────  ────────────  ────────────  ────────────  ───────  ────────────────────────────────────
    1       +0.00ms  planner       planner       -        ○ plan-compiled (Revision 1, 2 tasks)
    4    +1200.10ms  plan-val-1    plan-val      -        🟣 plan-reviewed (APPROVED)
    8    +2400.50ms  impl-slug     implementer   -        🟢 task-claimed (task-slug)
   12    +4100.20ms  impl-slug     implementer   Bash     ✓ run:exec (bun test tests/slug.test.ts)
   15    +5300.00ms  impl-slug     implementer   -        🟣 task-submitted (task-slug)
   18    +6200.40ms  val-slug      validator     -        🔄 validate-start (val-slug)
   22    +7800.10ms  val-slug      validator     Bash     ✓ task:probe (1 demand recorded)
   26   +11200.00ms  val-slug      validator     -        ✓ task-reviewed (PASS, resolved probe)
   28   +13400.00ms  impl-trunc    implementer   -        🟢 branch-opened (B-1b72a087, 2 sub-tasks)
   30   +18900.00ms  sub-measure   sub-impl      Write    🟢 branch-submitted (S-measure)
   32   +24100.00ms  impl-trunc    implementer   -        ✓ branch-collected (2 files diffed)
```

---

[⬅ Previous: Topological Conflict-Free Batching](./02-topological-conflict-free-batching.md) | [Master Table of Contents](../README.md) | [Next: Chapter 04 — Host-Agnostic Architecture ➡](../04-multi-agent/01-host-agnostic-architecture.md)
