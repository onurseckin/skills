# Sequential Waves, Dependency Barriers & Multi-Round Repair Model

**Document**: `docs/planning/gvui-execution-graph/09-sequential-waves-and-multi-round-repair-model.md`  
**Date**: 2026-08-15  
**Status**: Authoritative Architectural Specification

---

## 1. The Core Problem: Why Flat Parallelism Breaks Down

A real-world engineering workflow is almost never a flat set of independent tasks. Two critical constraints require strict sequential coordination:

1. **Topological Dependency Barriers**:
   - Task B cannot begin until Task A produces its data contracts or schemas.
   - Forcing Task B to run concurrently with Task A results in compile failures, race conditions, and merge conflicts.
2. **Multi-Round Adversarial Repair Loops (Re-Runs)**:
   - When a validator rejects Task A in Round 1 (`changes_requested`), Task A must execute a **Round 2 repair run**.
   - Downstream dependent tasks (Task B, Task C) must **remain blocked** while Task A is undergoing repair.
   - Once Task A is verified in Round 2, the barrier releases and downstream tasks are unlocked.

---

## 2. The Topological Wave & Barrier State Machine

The harness uses a deterministic DAG topological sort (`plan:compile`) that partitions tasks into sequential **Concurrency Waves** separated by **Validation Barriers**:

```
[ASCII Sequential Waves & Dependency Barriers Flow]

  WAVE 0 (Parallel Execution)        VALIDATION BARRIER 0        WAVE 1 (Blocked until W0 Passes)
 ┌───────────────────────────┐      ┌────────────────────┐      ┌─────────────────────────────┐
 │ Implementer 1 (Task T-01) │◄────►│ Validator 1 (T-01) │      │ Implementer 3 (Task T-03)   │
 │ Scope: Types & Contracts  │      │ Gate: bun test     │      │ Scope: Layout Engine        │
 └───────────────────────────┘      └─────────┬──────────┘      │ Depends On: [T-01, T-02]    │
                                              │                 └──────────────┬──────────────┘
 ┌───────────────────────────┐                │                                │
 │ Implementer 2 (Task T-02) │◄────►┌─────────▼──────────┐                     ▼
 │ Scope: Config & Bounds    │      │ Validator 2 (T-02) │      ┌─────────────────────────────┐
 └───────────────────────────┘      │ Gate: bun test     │      │ Validator 3 (Task T-03)     │
                                    └─────────┬──────────┘      │ Gate: bun test              │
                                              │                 └─────────────────────────────┘
                                              ▼
                                 ┌──────────────────────────┐
                                 │ ALL WAVE 0 TASKS PASSED  │
                                 │ Barrier Released (W0 ──►)│
                                 └──────────────────────────┘
```

---

## 3. How Multi-Round Task Re-Runs Work (The Cyclic Repair State Machine)

When a validator finds a defect during an adversarial audit, the file-based state machine executes a deterministic cyclic repair:

```
[ASCII Multi-Round Re-Run & Repair Cycle]

 ┌───────────────────┐
 │ Implementer Claim │ ──► Round 1 Implementation ──► task:submit (Hash: h1)
 └───────────────────┘                                     │
                                                           ▼
 ┌───────────────────┐                               ┌──────────────────────────┐
 │ Implementer Repair│ ◄── task:reject (Finding F-1) ◄───│ Validator Gate Execution  │
 │ Round 2 Claim     │                               │ Exit: 1 or Invariant Fail│
 └─────────┬─────────┘                               └──────────────────────────┘
           │
           ▼
  Remediates Finding F-1
  Updates code & tests
           │
           ▼
  task:submit (Hash: h2, Round 2)
           │
           ▼
 ┌──────────────────────────┐
 │ Validator Gate Re-Audit  │ ──► Exit: 0 & Invariant Verified ──► task:review --status pass
 └──────────────────────────┘                                            │
                                                                         ▼
                                                            UNBLOCKS DOWNSTREAM TASKS (Wave 1)
```

### Exact File-Based State Transitions:

1. **Initial Submission**:
   - Implementer runs $\to$ executes `task:submit --task-id T-01 --report-file report.json`.
   - `state.json` marks status as `submitted`.
2. **Validator Rejection (Re-Run Trigger)**:
   - Validator runs adversarial audit $\to$ finds defect $\to$ executes:
     `task:reject --task-id T-01 --finding-id F-01 --severity critical --observation "..." --remediation "..."`
   - `state.json` updates `status: "changes_requested"` and increments `repair_rounds: 1`.
   - The file lock on the task is released for re-claim.
3. **Sequential Repair Execution**:
   - Coordinator assigns a repair lease $\to$ Implementer runs `task:claim --task-id T-01 --round 2`.
   - Implementer reads `findings/F-01.json`, applies code fixes, and submits `task:submit --round 2`.
4. **Pass Review & Downstream Release**:
   - Validator re-runs $\to$ executes `task:review --task-id T-01 --status pass --resolution-proof "..."`.
   - `state.json` marks status as `done`.
   - The coordinator checks if all Wave 0 dependencies for Wave 1 tasks are `done`. Once satisfied, Wave 1 tasks are unlocked and leased.

---

## 4. Summary of Guarantees

1. **No Premature Execution**: Dependent tasks in Wave 1 or Wave 2 **never** run while upstream prerequisites are being implemented or repaired.
2. **Deterministic Multi-Round Re-Runs**: Tasks can undergo up to 5 repair rounds (`Rounds 1–5`) with complete cryptographic tracking in `events.jsonl`.
3. **Zero Deadlocks**: If a task fails all repair rounds, the state machine escalates it (`status: "escalated"`), allowing the coordinator to decide whether to pivot, skip, or fail-safe.
4. **Accurate Graph Visualization**:
   - Normal progression renders as forward `sequence` edges (`Step 1 ──► Step 2`).
   - Repair re-runs render as animated reverse `loop` edges (`Step 3 ──► Step 2: Pushback Round 1`).
