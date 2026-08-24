# Runtime Lease & Lock Concurrency Audit
## 1. Audit Overview
**Target File:** `olt/scripts/src/runtime/lease.ts` & `locks.ts` (600 lines)
**Role:** Runtime, Storage & Concurrency Lead Auditor (Round 2)

## 2. Findings Inventory
The EXACT true number of findings is **21**.

1. Lease expiration uses `Date.now()`, vulnerable to NTP clock skew.
2. `locks.ts` POSIX `flock` implementation lacks retry timeout, hanging indefinitely.
3. Spinlocks in `lease.ts` consume CPU cycles without yielding.
4. Ghost leases are not properly garbage collected if the process receives `SIGKILL`.
5. Lease renewal mechanism has a race condition with lease expiration checker.
6. `Atomics.wait` is used in a non-web-worker context, blocking main thread.
7. No heartbeat validation on active leases.
8. Lock file paths do not hash the write scope, causing collision on overlapping paths.
9. `fs.unlink` on lock release throws `ENOENT` if lock was stolen.
10. Stolen leases do not notify the original owner, causing split-brain execution.
11. I/O bottleneck: 100+ stats per second checking lock file mtime.
12. Native tool `lsof` used to check lock ownership is incredibly slow.
13. Swap files used for lease handoff are left dangling.
14. Concurrency threshold bypassed if multiple agents claim lease in the exact same millisecond.
15. Path traversal vulnerability in lock file creation if task ID contains `../`.
16. Unbounded memory growth in lease history array.
17. No `fsync` after creating lock file, risking metadata loss on power failure.
18. Lock contention on the global lease registry file.
19. Lease durations are static; they do not adapt to Work/Span (W/S) complexity.
20. `locks.ts` error handling swallows `EACCES`, treating it as lock acquired.
21. Opportunity to move to a memory-mapped lock registry.

## 3. Step-by-Step Disk Mutation Trace
* `CLAIM`: `open(lockfile, O_CREAT | O_EXCL)`.
* `RENEW`: `utimes(lockfile)` to update modified time.
* `RELEASE`: `unlink(lockfile)`.
* `STEAL`: `unlink(lockfile)` followed by `open(lockfile, O_CREAT | O_EXCL)`.

## 4. Refactoring Blueprints
* **Blueprint:** Replace file-based `utimes` heartbeats with a robust IPC or WebSocket signaling server for lease validity.
* **Blueprint:** Remove `Atomics.wait` and spinlocks. Implement an event-driven lock queue.
