# 02. POSIX File Locking & Durable Writes (`fdatasync` / `fsyncDirectory`)

[⬅ Previous: Tamper-Proof Hash Chains](./01-tamper-proof-hash-chains.md) | [Master Table of Contents](../README.md) | [Next: Stale Worker & Torn Tail Recovery ➡](./03-stale-worker-and-torn-tail-recovery.md)

---

## 💥 The Reality of Power Cuts & OS Crashes

Operating systems buffer file writes in memory before flushing them to physical disk sectors. If power is interrupted or an agent process is killed via `SIGKILL`, buffered writes can:
- Be lost completely.
- Leave half-written, torn JSON fragments on disk.
- Corrupt filesystem directory entry tables.

To achieve enterprise-grade durability, `orchestrating-long-tasks` implements the **Durable Storage Engine** using POSIX advisory locks and synchronous directory flushing.

---

## 🔒 Concurrency Control: Advisory POSIX File Locks (`flock`)

Multiple subagents running concurrently on the same host machine must never write to `.harness/<run-id>/events.jsonl` simultaneously.

Every state transition acquires an exclusive advisory file lock on `.harness/<run-id>/state.lock`:

```typescript
// scripts/src/store/event-stream.ts
const lockFd = openSync(lockPath, constants.O_CREAT | constants.O_RDWR, 0o600);
flockSync(lockFd, constants.LOCK_EX);
try {
  // 1. Read latest events.jsonl
  // 2. Validate hash chain head
  // 3. Append new event with fdatasync
  // 4. Update state.json projection atomically
} finally {
  flockSync(lockFd, constants.LOCK_UN);
  closeSync(lockFd);
}
```

---

## 💾 Atomic Multi-Stage Write Pipeline

When writing any persistent artifact (manifest, state projection, command record):

```text
[ Stage 1: Write Temporary File ]
  ├── Create `.state.json.<uuid>.tmp` with permission 0600
  ├── Write canonical JSON buffer
  └── Call `fsyncSync(fd)` (Flushes data & inode metadata to physical platter/NVMe)

[ Stage 2: Atomic POSIX Rename ]
  └── Call `renameSync(tempPath, targetPath)` (Atomic replacement on POSIX filesystems)

[ Stage 3: Synchronize Parent Directory ]
  └── Call `fsyncDirectory(parentDir)` (Flushes directory inode entries to prevent orphan files)
```

---

[⬅ Previous: Tamper-Proof Hash Chains](./01-tamper-proof-hash-chains.md) | [Master Table of Contents](../README.md) | [Next: Stale Worker & Torn Tail Recovery ➡](./03-stale-worker-and-torn-tail-recovery.md)
