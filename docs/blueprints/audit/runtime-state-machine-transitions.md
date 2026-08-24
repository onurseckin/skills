# Architectural Audit: Runtime State Machine Transitions

## Target File(s)
- `engine/store/state.ts`
- `workflow/task-state.ts`
- `workflow/authority/execution-state.ts`

## Things to Look For Count
1. Initialization -> Planned
2. Planned -> Running -> Reviewing
3. Terminal States (Done / Errored)
4. Disk Persistence Synchronization

## What's Happening Here
The state machine manages the progression of tasks within an active capsule. The canonical lifecycle strictly follows: `INIT -> PLANNED -> RUNNING -> REVIEWING -> TERMINAL`.
- **Transitions:** State patches (`ProjectionPatchOp`) are continuously appended to the `state.json` Ledger using append-only `events.jsonl` architecture.
- **Authority:** Subagents claim transition scopes by appending an execution state signature (e.g. `workflow/authority/execution-state.ts`).
- **Review Interlock:** Once `RUNNING` completes, tasks hit `REVIEWING`. The cognitive validator blocks advancement unless a 1-hop micro-cycle resolves correctly.

## LLM Friction Points & Implicit Assumptions
- **JSON Ledger Only:** No SQL or in-memory mutation is trusted. If the JSON format gets corrupted by LLMs trying to manually patch `state.json`, the machine hard faults.
- **Linearity:** Tasks must progress linearly. Attempting to force a `PLANNED` task directly into `TERMINAL` state without generating execution receipts causes a `FALSE_SERIALIZATION` or anomaly trace.
- **Append-Only Complexity:** Reconstructing state requires re-playing `events.jsonl`, which is a CPU intensive fold operation for deep long-running capsules.

## Concrete Simplification & Improvement Blueprint
1. **Snapshot Checkpointing:** Emit materialized snapshots natively into `state.json` every $N$ events, rather than enforcing total reconstruction on every boot.
2. **Macro Transitions:** Allow composite state-transition helper functions that bundle `PLANNED -> RUNNING -> DONE` for trivial / mechanic tasks that do not need review.
3. **Deduplicate Validation Tokens:** Simplify the execution-state ledger tokens to remove redundant actor IDs if they are implicitly defined in the transaction lease.
