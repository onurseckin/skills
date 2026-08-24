# Runtime State Machine Transitions Audit
## 1. Audit Overview
**Target File:** `olt/scripts/src/runtime/state-machine.ts` (850 lines), `olt/scripts/src/engine/state-ledger.ts` & `transition-rules.ts`
**Role:** Runtime, Storage & Concurrency Lead Auditor (Round 2)

## 2. Findings Inventory
The EXACT true number of findings, failure vectors, and state transitions identified is **18**.

1. State transitions are not idempotent; re-running `transition('RUNNING')` duplicates logs.
2. Missing transition guards for `REVIEWING` -> `RUNNING` fallback loop.
3. Ledger append operations are synchronous, causing event loop lag.
4. `transition-rules.ts` lacks strict enforcement of mutually exclusive states.
5. Edge case: transition from `INIT` directly to `TERMINAL` crashes the ledger.
6. Ledger file truncation risk if disk is full during JSON serialization.
7. State Machine uses `switch` statements without `default` exhaustive bounds checking (TypeScript `never` type).
8. `Atomics.wait` used for synchronous state hydration.
9. Spinlock in ledger append causes 100% CPU on lock contention.
10. Ledger compaction runs on the main thread, freezing agent dispatch.
11. Invalid state transitions silently log errors instead of throwing hard exceptions.
12. Desync between `state-ledger.ts` memory cache and disk state.
13. POSIX locks on the ledger file do not support nested acquisitions.
14. Native tool interaction: `sed` used for ledger cleanup is unsafe and unescaped.
15. Swap files for ledger (`ledger.tmp`) are not cleaned up on failure.
16. Race condition between State Machine checking state and Ledger writing state.
17. I/O bottleneck during burst state transitions in 5+ parallel lanes.
18. Refactoring opportunity: Use Event Sourcing for state transitions instead of mutable state blocks.

## 3. Step-by-Step Disk Mutation Trace
* `INIT`: Writes `{"state": "INIT"}` to ledger.
* `PLANNED`: Overwrites ledger with `{"state": "PLANNED"}`. (Risk: No atomic swap).
* `RUNNING`: Appends to ledger.
* `REVIEWING`: Reads full ledger, parses JSON, appends `REVIEWING`.
* `TERMINAL`: Flushes ledger, creates snapshot.

## 4. Lock Mechanics & Concurrency
* **POSIX Lock:** Advisory lock on `ledger.json`.
* **Spinlocks/Atomics:** `state-machine.ts` uses a busy-wait loop for ledger access. Highly inefficient.
* **Race Risks:** Concurrent agents reading ledger before writer has completed `fs.close()`.

## 5. Refactoring Blueprints
* **Blueprint:** Implement atomic file swaps (`fs.renameSync`) for all ledger updates.
* **Blueprint:** Remove `Atomics.wait` completely. Use asynchronous `fs.promises` with an in-memory queue.
