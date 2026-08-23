# 02. POSIX File Locking & Durable Writes (`fdatasync` / `fsyncDirectory`)

[⬅ Previous: Tamper-Proof Hash Chains](./01-tamper-proof-hash-chains.md) | [Master Table of Contents](../README.md) | [Next: Stale Worker & Torn Tail Recovery ➡](./03-stale-worker-and-torn-tail-recovery.md)

---

## 💥 The Reality of Power Cuts & OS Crashes

Operating systems buffer file writes in memory before flushing them to physical disk sectors. If power is interrupted or an agent process is killed via `SIGKILL`, buffered writes can:

- Be lost completely.
- Leave half-written, torn JSON fragments on disk.
- Corrupt filesystem directory entry tables.

To achieve enterprise-grade durability, `olt` implements the **Durable Storage Engine** using POSIX advisory locks and synchronous directory flushing.

---

## 🔒 Concurrency Control: Advisory POSIX File Locks (`flock`)

Multiple subagents running concurrently on the same host machine must never write to `.capsules/<run-id>/events.jsonl` simultaneously.

Every state transition acquires an exclusive advisory lock on the capsule directory's own inode.
There is no lock file inside the capsule: the directory is the thing opened, so a rogue process
cannot displace the lock by replacing a path, and a reader browsing the capsule never has to tell
coordination state apart from evidence.

**There is no `flock` in `node:fs`.** Neither Node nor Bun exposes the `flock(2)` syscall as a
JavaScript API, so the harness calls it directly, via `bun:ffi`, against whichever libc the host
actually has loaded (`platform/flock-ffi.ts`): a fixed candidate list of `libc.so.6` /
`libc.musl-<arch>.so.1` paths on Linux (read off `/proc/self/maps` first, in case the running process
already has a specific one loaded), and `/usr/lib/libSystem.B.dylib` on macOS. Getting the errno right
matters as much as calling `flock` itself: `EAGAIN`/`EWOULDBLOCK` (`11` on Linux, `35` on Darwin) means
another process holds it, so the harness retries; `EINTR` means the call was merely interrupted by a
signal, so it retries the exact same call rather than treating it as a failure; anything else is a real
error and throws. The actual acquire/release pair (`platform/run-lock.ts`):

```typescript
const descriptor = openSync(
  runRoot,
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
);
// tryExclusiveFlock loops on EINTR, returns false on EAGAIN/EWOULDBLOCK (caller retries with backoff),
// and throws on any other errno — it is the harness's own FFI wrapper around flock(fd, LOCK_EX|LOCK_NB).
while (!tryExclusiveFlock(descriptor)) {
  /* sleep briefly, then retry, until options.timeoutMs (default 10s) is exhausted */
}
try {
  // 1. Read latest events.jsonl
  // 2. Validate hash chain head
  // 3. Append new event with fsyncSync
  // 4. Update state.json projection atomically
} finally {
  releaseFlock(descriptor); // flock(fd, LOCK_UN)
  closeSync(descriptor);
}
```

Before and after the operation runs, `withRunLock` also re-checks that `runRoot` still resolves to the
**same device and inode** it opened (`assertPathIdentity`) — a directory that got deleted, replaced, or
swapped out from under the lock while it was held is treated as a `PATH_SAFETY` failure, not silently
tolerated. A timed-out acquisition (the lock is still held by someone else after `timeoutMs`) is its own
distinct error code, `LOCK_TIMEOUT`.

### Who is holding the lock right now

Advisory locking tells a second process it must wait; it does not, on its own, tell a human staring at
a stuck run _who_ is holding it or from what machine. Every successful acquisition also publishes a
small **observer record** — deliberately outside the capsule, in a sibling `.locks/<run-id>/owner.json`
(`platform/observer.ts`, `LOCKS_DIRECTORY = ".locks"`) — naming the PID, hostname, and a random token
for the current holder, written the same atomic-write-then-`fsync` way as everything else in this
chapter. This is coordination metadata, not run state: a reader browsing `.capsules/<run-id>/` should
never have to distinguish "who currently has the lock" from "what the run actually recorded", which is
exactly why it lives beside the capsule directory rather than inside it. `owner.json` is removed the
moment the operation finishes (matched against its own token, so a stale write from an unrelated
process can never delete someone else's live record) — its presence is therefore itself a live signal:
if it is still there and its PID is dead, that is forensic evidence of exactly which process crashed
while holding the run lock.

---

## 💾 Atomic Multi-Stage Write Pipeline

When writing any persistent artifact (manifest, state projection, command record):

```text
[ Stage 1: Write Temporary File ]
  ├── Create `.state.json.<uuid>.tmp` (leading dot, real filename kept in the
  │   middle) via O_CREAT|O_EXCL — a second, concurrent writer targeting the
  │   same path can never collide with this one, since each gets its own uuid
  ├── openSync(..., 0o600) at creation, then chmodSync to the caller's real
  │   target mode once the bytes are written — `state.json` itself lands at
  │   0o644; the read-only capsule artifacts (`prompt.md`, published packets)
  │   are written with an explicit 0o444 instead, and never rewritten after
  ├── Write the canonical JSON buffer
  └── Call `fsyncSync(fd)` (flushes data & inode metadata to physical storage)

[ Stage 2: Atomic POSIX Rename ]
  └── Call `renameSync(tempPath, targetPath)` (atomic replacement on POSIX filesystems)

[ Stage 3: Synchronize Parent Directory ]
  └── Call `fsyncDirectory(parentDir)` (flushes directory inode entries to prevent orphan files)
```

A crash between Stage 1 and Stage 2 leaves nothing but an orphaned `.tmp` file behind — the real
`state.json` (or `prompt.md`, or a packet bundle) is never in a half-written state, because nothing
ever renames a file over it until the replacement is completely written and durably flushed. If the
write itself fails partway through, the same helper (`atomicWriteBytes` in `core/durable-write.ts`)
closes the descriptor and deletes the temp file in its `catch` — a failed write does not even leave the
`.tmp` fragment behind for a human to clean up.

A published packet bundle (`packets/packet-bundle.ts`) shows why a **directory's own** permission
matters independently of the files inside it: `packet.md` and `metadata.json` are written 0o444
(read-only, digest-bound — a published packet can never be silently edited afterward), but the
directory that holds them is `chmodSync`'d to 0o755 once it's complete. Without that, a later ordinary
recursive delete of the whole capsule would need its own repair step just to remove read-only files
first; with it, the capsule can be torn down through nothing more than a plain recursive `rm`, exactly
as any other directory would be.

---

[⬅ Previous: Tamper-Proof Hash Chains](./01-tamper-proof-hash-chains.md) | [Master Table of Contents](../README.md) | [Next: Stale Worker & Torn Tail Recovery ➡](./03-stale-worker-and-torn-tail-recovery.md)
