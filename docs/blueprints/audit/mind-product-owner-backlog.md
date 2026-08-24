# Architectural Audit: Mind Product Owner & Backlog

## Target File(s)
- `olt/scripts/src/mind/smart-task-manager.ts`
- `olt/scripts/src/mind/strategic-purpose.ts`
- `olt/scripts/src/mind/feedback-queue.ts`
- `olt/scripts/src/mind/gates.ts`

## Things to Look For Count
- **Admission Rules:** 3 explicit Mode B intake gates
- **Backlog Manipulations:** 5+ append/read operations on `.olt/backlog.jsonl`
- **File operations:** Read/Write to `.olt/`

## What's Happening Here
The Mind acts as the Infinite Product Owner. In Mode B (External Intake), it evaluates incoming requests, normalizes them, and atomically pushes them to the queue without keeping them paused.
- **What calls what:** External inputs or Mode A self-evolution trigger admission gates. The `smart-task-manager` processes the candidate and appends to `feedback-queue`. 
- **Autonomous Loop Mechanics:** It reconciles paused admitted feedbacks instantly. Zero paused items are allowed to linger.
- **Data Persistence:** Operations are strictly serialized to `.olt/backlog.jsonl` (and `TASK_QUEUE.jsonl`).

## LLM Friction Points & Implicit Assumptions
- **Friction Point:** The LLM might try to hold queue items in its context window rather than treating `.olt/backlog.jsonl` as the singular source of truth.
- **Friction Point:** Batching task dispatch. The LLM may attempt to dispatch 5 tasks in one blob, violating the 1:1 Isolated Task Dispatch rule.
- **Implicit Assumption:** Assuming the Mind has the authority to skip the queue and execute tasks immediately.

## Concrete Simplification & Improvement Blueprint
1. **Strict 1:1 Append:** Force the `smart-task-manager` to emit one structured JSON object per task directly to the `.olt/backlog.jsonl` ledger.
2. **Atomic Dispatch Chaining:** The moment an item clears `gates.ts`, it must be converted and dispatched without holding it in LLM memory.
3. **Zero Context Carryover:** Once written to the queue, the Mind drops it from context and relies entirely on the Orchestrator to read it back.
