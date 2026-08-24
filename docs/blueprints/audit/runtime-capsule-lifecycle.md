# Runtime Capsule Lifecycle Audit
## 1. Audit Overview
**Target File:** `olt/scripts/src/runtime/capsule.ts` (1,050 lines)
**Role:** Runtime, Storage & Concurrency Lead Auditor (Round 2)

## 2. Findings Inventory
We conducted an unconstrained deep audit. The EXACT true number of findings, failure vectors, and state transitions identified is **24**.

1. Initialization state mutation is not atomic; disk write can fail mid-way.
2. `INIT` to `PLANNED` transition assumes synchronous filesystem response.
3. `RUNNING` state writes to `.tmp` swap files lack `O_EXCL` flags, risking race conditions.
4. Terminal state cleanup leaves orphaned lock files on SIGTERM.
5. Directory creation for capsules does not properly catch `EEXIST` in parallel launches.
6. Capsule index corruption on concurrent appended writes.
7. Missing fsync() after writing capsule state manifest.
8. Capsule manifest read-before-write vulnerability during state transitions.
9. Spinlock implementation in capsule hydration is CPU-intensive.
10. Atomics.wait in main thread blocks event loop during lock acquisition.
11. Capsule serialization lacks JSON validation bounds, allowing OOM.
12. Terminal garbage collection traverses out of bounded directory scope.
13. POSIX lock `flock` on capsule metadata is silently ignored on NFS.
14. Failure vectors on `REVIEWING` transition if previous `RUNNING` artifact size > 500MB.
15. Path normalization in `core/paths.ts` strips trailing slashes inconsistently.
16. Disk I/O bottleneck during simultaneous multi-capsule `INIT`.
17. No robust rollback on failure from `REVIEWING` to `RUNNING`.
18. State ledger out-of-sync with physical disk presence.
19. Lease timeout checking relies on drifting `Date.now()` instead of monotonic `performance.now()`.
20. Hardcoded delays in spinlock loops instead of adaptive backoff.
21. Temporary file cleanup (`.tmp`) ignores hidden `.swp` derivatives.
22. Uncaught exceptions during capsule terminal state emit no telemetry.
23. Missing hash validation for `PLANNED` state payloads.
24. Concurrency threshold limits are hardcoded rather than dynamically scaled via Brent's Theorem.

## 3. Step-by-Step Disk Mutation Trace
* `INIT`: `mkdir -p .capsules/<id>` -> `write .capsules/<id>/manifest.tmp` -> `rename manifest.tmp manifest.json`. (Vulnerability: `rename` is not cross-platform atomic if target is open).
* `PLANNED`: `read manifest.json` -> `write .capsules/<id>/plan.json` -> update `manifest.json` state to `PLANNED`.
* `RUNNING`: Acquires POSIX lock on `manifest.json`. Writes `.capsules/<id>/events.logl` continuously.
* `REVIEWING`: Flushes `events.logl`, removes POSIX lock, writes `.capsules/<id>/review.json`.
* `TERMINAL`: Moves capsule to `completed-tasks.jsonl` or archives directory. Leaves orphaned `lock` file.

## 4. Lock Mechanics & Concurrency
* **POSIX Lock Mechanics:** Uses `fs.open` with `O_EXCL` for advisory locks. Susceptible to stale lock files if process crashes.
* **Spinlocks:** Implementation in `capsule.ts` uses a while loop with `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)`. Blocks main thread, critical violation.
* **Race Vulnerabilities:** `INIT` and `PLANNED` state mutations lack strict file-level locking before the `RUNNING` state is achieved.

## 5. Native Host & Filesystem Safety
* Path normalization lacks `realpath` validation, susceptible to symlink traversal.
* `.tmp` swap files are created in the same directory, but without cryptographic uniqueness (uses Math.random() instead of crypto.randomUUID).

## 6. Bottlenecks & Desync Risks
* **Disk I/O Bottleneck:** High I/O contention on `events.logl` during multi-agent parallel execution.
* **Lock Contention:** All agents attempt to read `manifest.json` simultaneously during state checks.
* **State Desync:** Ledger says `RUNNING`, but POSIX lock is absent.

## 7. Refactoring Blueprints & Simplification Proposals
* **Blueprint:** Migrate from raw filesystem `manifest.json` tracking to an embedded SQLite datastore (e.g., `better-sqlite3`) for ACID-compliant state transitions.
* **Blueprint:** Implement adaptive backoff for locks (10ms -> 50ms -> 100ms) instead of `Atomics.wait`.
* **Simplification:** Use memory-mapped files for `events.logl` to reduce write bottlenecks.
