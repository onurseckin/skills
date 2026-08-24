# Architectural Audit: Lease, Lock & Concurrency Mechanics

## Target File(s)
- `platform/run-lock.ts`
- `platform/flock-ffi.ts`
- `workflow/lease/release.ts`

## Things to Look For Count
1. POSIX `flock` Implementation
2. Identity Invariants (`InodeIdentity`)
3. Atomic Run Locking (`withRunLock`)
4. Dynamic Brent Concurrency Scaling

## What's Happening Here
Concurrency is mechanically enforced through POSIX filesystem locks (`flock-ffi.ts`).
1. **Directory Locking:** `withRunLock` opens the capsule directory with `O_RDONLY | O_DIRECTORY`, applying an exclusive POSIX lock to the directory descriptor.
2. **Inode Tracking:** Defends against "run root disappearance" by tracking the `dev` and `ino` numbers. If the directory is swapped or deleted while locked, the operation violently aborts (`PATH_SAFETY`).
3. **Lease Scaling:** Uses Brent's Theorem (`P = W / S`) where agents dynamically partition lanes. Disjoint write scopes prevent collisions, while the directory lock prevents race conditions on the `events.jsonl` ledger.

## LLM Friction Points & Implicit Assumptions
- **Host Dependencies:** Depends on `node:fs` and low-level FFI bindings to the host OS. On environments without `flock` support (e.g. some containerized volumes or network shares), the runner will panic.
- **Blocking Spinlocks:** The `Atomics.wait` implementation on a `SharedArrayBuffer` for polling spins the main thread until the deadline.
- **Strict Inodes:** Moving the `.olt` directory across filesystems breaks inode identity and crashes active agents.

## Concrete Simplification & Improvement Blueprint
1. **Fallback Locking:** Implement an atomic file-based `lockfile` fallback mechanism for environments without POSIX `flock` support.
2. **Asynchronous Yielding:** Replace `Atomics.wait` spinlocks with native asynchronous `Promise` yielding via `setTimeout` to free up the event loop for background metric reporting.
3. **Lease Token Refresh:** Introduce heartbeat lease tokens so dead agents don't block the capsule for the full `timeoutMs` duration before recovery.
