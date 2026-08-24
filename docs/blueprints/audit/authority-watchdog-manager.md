# Authority & Policy Lead Audit Blueprint: Watchdog Manager

## 1. Exact Findings Count
**Total Things to Look For:** 9

## 2. Call Graph & State Transition Trace
- **Entry Points:** `registerWatchdog`, `heartbeatWatchdog`, `terminateWatchdog`, `loadWatchdogStore`, `saveWatchdogStore`.
- **Callers:** Heartbeat ticks, lifecycle events in coordinators and workers.
- **State Transitions:**
  - `registerWatchdog` -> calls `loadWatchdogStore` -> creates default if needed -> returns new state -> calls `saveWatchdogStore`.
  - `heartbeatWatchdog` -> calls `loadWatchdogStore` -> updates `last_heartbeat_at` -> calls `saveWatchdogStore`.
  - `terminateWatchdog` sets watchdog to null, implicitly marking as stale.

## 3. Native Host Tool Interaction
- Synchronous interactions using `node:fs` (`readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync`).
- Implicit interaction with schedules and loops to trigger auto-wake semantics across tiers.

## 4. Edge Cases, Failure Vectors, & LLM Friction Points
- **Race Conditions in State Persistence:** `atomicWriteJson` doesn't prevent read-modify-write race conditions. Concurrent `heartbeatWatchdog` calls from different processes can overwrite each other's state.
- **Weak ID Generation:** `generateWatchdogId` relies on `Math.random().toString(36)` and `Date.now()`, which can collide across concurrent subagent forks.
- **No File Locking:** Accessing `watchdogs.json` lacks IPC locking (`flock`), causing potential corruption on high-concurrency loops.
- **Silent Version Discarding:** If `version === 1` is encountered, it silently discards the entire store state and creates a default store instead of migrating it.
- **JSON Parse Exception Swallowing:** `loadWatchdogStore` catches all JSON parse errors and silently returns a default store, masking disk corruption.
- **Stale process IDs:** Process IDs (`pid`, `ppid`) are recorded at creation but never verified for actual OS-level liveness on heartbeats.
- **Timestamp Parsing Ambiguity:** `parseTimestamp` accepts strings and falls back to `Date.now()` silently if `Date.parse` returns NaN, obfuscating invalid date strings.
- **Lack of Garbage Collection:** `terminateWatchdog` sets `active_watchdog: null` but orphaned/stale records are lost instead of moved to a historical ledger.
- **Synchronous File I/O:** `readFileSync`, `mkdirSync`, `existsSync` block the event loop, which can cause latency spikes in the orchestrator.

## 5. TypeScript Refactoring Blueprints & Simplification Proposals
- **Blueprint A:** Introduce process-level file locking (e.g., `proper-lockfile`) for read-modify-write cycles in `heartbeatWatchdog` to fix race conditions.
- **Blueprint B:** Replace `Math.random()` with `crypto.randomUUID()` for guaranteed collision-free watchdog IDs.
- **Blueprint C:** Implement a migration path for legacy versions instead of silently wiping the store. Move synchronous fs calls to asynchronous equivalents to prevent orchestrator thread blocking.
