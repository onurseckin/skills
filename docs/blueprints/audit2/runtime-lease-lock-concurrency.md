# Runtime Lease and Lock Concurrency

## Overview
Analysis of the memory-level concurrency primitives in `runtime/locks.ts` and `runtime/lease.ts`.

## Unconstrained Finding Count
**Total Findings:** 4

## Concurrency and Lock Queue Mechanics
1. **AsyncLock (`runtime/locks.ts`)**:
   - Implements a simple promise-based lock.
   - Waiters are queued into an array of resolver functions.
   - `acquire()` checks the `locked` boolean. If true, pushes `resolve` to the queue.
   - `release()` shifts the oldest waiter from the queue and resolves it. If empty, unlocks.
2. **LeaseManager (`runtime/lease.ts`)**:
   - Wraps `AsyncLock` to serialize lease operations.
   - Tracks a monotonic `lastHeartbeat` using `performance.now()`.
   - `acquireLease()` respects a hardcoded 10,000ms timeout. If a heartbeat was received within the timeout window, acquisition is denied.
   - `heartbeat()` updates the timestamp under lock.
   - `releaseLease()` resets the heartbeat timestamp to 0.

## Disk Persistence
There is no direct disk persistence inside these memory constructs.

## Assessment
The `AsyncLock` effectively serializes async flow in a single process. `LeaseManager` provides a strict monotonic heartbeat check. However, since this operates purely in-memory via `performance.now()`, it does not govern cross-process lease enforcement out-of-the-box.
