# 02. POSIX File Locking & Durable Writes (`fdatasync` / `fsyncDirectory`)

[⬅ Previous: Tamper-Proof Hash Chains](./01-tamper-proof-hash-chains.md) | [Master Table of Contents](../README.md) | [Next: Stale Worker & Torn Tail Recovery ➡](./03-stale-worker-and-torn-tail-recovery.md)

---

## 🧭 Diátaxis Overview

| Quadrant         | Purpose in this Chapter                                                                                                                         |
| :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explanation**  | Understand filesystem write hazards, kernel-level POSIX `flock` concurrency control on directory inodes, and the 3-Stage Atomic Write Pipeline. |
| **How-To Guide** | Handling lock timeouts, inspecting external lock holders via `.locks/`, and diagnosing filesystem durability issues.                            |
| **Reference**    | FFI syscall specifications, errno error codes, filesystem permission matrices, and atomic write invariants.                                     |
| **Tutorial**     | Step-by-step trace of an atomic state mutation across kernel locks, physical disk flushes, and directory entry syncs.                           |

---

## 💥 1. Explanation: Filesystem Write Hazards

In high-concurrency multi-agent execution, multiple subagents frequently read and write to the same capsule simultaneously. Modern operating systems buffer disk writes in volatile page caches. Under unhandled process crashes (`SIGKILL`), hardware power cuts, or host resource exhaustion, standard disk I/O introduces severe hazards:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FILESYSTEM CRASH HAZARDS                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Torn JSON Writes                                                        │
│     Process terminates after writing 1,200 bytes of a 2,048-byte JSON       │
│     payload, leaving truncated, unparseable bytes on disk.                  │
│                                                                             │
│  2. Inode / Directory Desynchronization                                     │
│     File data sectors are written to storage blocks, but parent directory   │
│     dentry tables in RAM are not flushed before crash, creating 0-byte or   │
│     orphaned files.                                                         │
│                                                                             │
│  3. Concurrent Race Interleaving                                            │
│     Two subagents append to `events.jsonl` simultaneously, interleaving     │
│     character streams and corrupting cryptographic hash links.              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

To eliminate these failure modes, `olt` implements a **Kernel-Level Advisory Lock Engine** paired with a **3-Stage Synchronous Write Pipeline**.

---

## 🔒 2. Explanation: Kernel-Level Advisory POSIX `flock`

### Why Traditional Lockfiles Fail

Traditional `.lock` files suffer from critical race hazards:

- **Atomicity Gap**: Checking if a lockfile exists and creating it requires multiple steps unless using complex flags.
- **Path Replacement Attack**: A rogue process can unlink and recreate a lockfile path out from under an active holder.
- **Evidence Pollution**: Placing lockfiles inside the capsule clutters immutable audit evidence with transient coordination state.

### The Capsule Inode Lock

`olt` locks the **capsule directory's own filesystem inode**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     KERNEL INODE LOCKING ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Subagent A (PID 1042)                 Subagent B (PID 1043)                │
│       │                                     │                               │
│       ▼                                     ▼                               │
│  openSync(runRoot, O_RDONLY|O_DIRECTORY) openSync(runRoot, O_RDONLY|O_DIR)  │
│       │                                     │                               │
│       ▼                                     ▼                               │
│  flock(fd_A, LOCK_EX | LOCK_NB)        flock(fd_B, LOCK_EX | LOCK_NB)       │
│       │                                     │                               │
│  [ GRANTED: Kernel Lock on Inode ]          │                               │
│       │                                     ▼                               │
│       │                                [ EAGAIN: Lock Contention ]          │
│       │                                     │                               │
│       │                                     ▼                               │
│       │                                [ Backoff & Retry Loop ]             │
│       │                                                                     │
│       ▼ (Mutate State, Append Event, Flush)                                 │
│  flock(fd_A, LOCK_UN) ──────────────────► [ GRANTED to Subagent B ]         │
│  closeSync(fd_A)                                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Direct `bun:ffi` Syscall Integration

Because neither Node.js nor Bun standard libraries expose the raw `flock(2)` syscall, `olt` binds directly to the OS libc via `bun:ffi` (`platform/flock-ffi.ts`):

- **Linux**: Loads `/lib/x86_64-linux-gnu/libc.so.6` or `libc.musl` (discovered dynamically via `/proc/self/maps`).
- **macOS (Darwin)**: Loads `/usr/lib/libSystem.B.dylib`.

### Robust Errno Handling:

- **`EAGAIN` / `EWOULDBLOCK`** (`11` on Linux, `35` on Darwin): Lock is held by another process. Harness sleeps with exponential backoff and retries until `timeoutMs` (default 10s).
- **`EINTR`** (`4`): Syscall was interrupted by an OS signal. Harness retries immediately without counting against timeout.
- **Other Errno**: Unexpected kernel error; throws immediately.

### Inode Safety Check (`assertPathIdentity`)

Before and after mutating state, the harness verifies `fstatSync(fd)` against `statSync(runRoot)`. If the device ID or inode number changed while the lock was held (e.g. directory moved or unlinked), a `PATH_SAFETY` violation is triggered.

---

## 👁️ 3. Explanation: External Lock Observer (`.locks/`)

To provide immediate visibility into who holds a lock without polluting the capsule audit record, `olt` writes an **Observer Record** outside the capsule in `.locks/<run-id>/owner.json`:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL OBSERVER REGISTRY                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Filesystem Layout:                                                         │
│  ├── .capsules/run-402/          ◄── Pure Immutable Audit Evidence          │
│  │   ├── events.jsonl                                                       │
│  │   └── state.json                                                         │
│  │                                                                          │
│  └── .locks/run-402/             ◄── Transient Coordination Directory       │
│      └── owner.json              ◄── Live Holder Forensic Metadata          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### `owner.json` Payload:

```json
{
  "pid": 48102,
  "hostname": "worker-node-04.internal",
  "holder_token": "HLD_8819204",
  "acquired_at": "2026-08-23T03:14:02.100Z"
}
```

When the lock is released, `owner.json` is atomically removed. If a process crashes while holding the lock, `owner.json` survives as forensic proof of which PID and host caused the lock stall.

---

## 💾 4. Explanation: The 3-Stage Atomic Write Pipeline

Whenever the harness writes state files (`state.json`, `metadata.json`, command evidence):

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     3-STAGE ATOMIC WRITE PIPELINE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STAGE 1: WRITE & FLUSH TEMPORARY FILE                                      │
│  ├── Create unique temp path: `.state.json.<uuid>.tmp`                      │
│  ├── openSync with `O_CREAT | O_EXCL | O_WRONLY` at mode 0o600             │
│  ├── Write Canonical JSON buffer                                            │
│  └── Execute `fsyncSync(fd)` (Flushes data blocks & inode metadata to disk) │
│  └── closeSync(fd)                                                          │
│                                   │                                         │
│                                   ▼                                         │
│  STAGE 2: ATOMIC POSIX RENAME                                               │
│  └── Execute `renameSync(tempPath, targetPath)`                             │
│      (Guarantees atomic directory entry swap on POSIX filesystems)          │
│                                   │                                         │
│                                   ▼                                         │
│  STAGE 3: SYNCHRONIZE PARENT DIRECTORY                                      │
│  ├── openSync(parentDir, O_RDONLY | O_DIRECTORY)                            │
│  ├── Execute `fsyncSync(parentDirFd)`                                       │
│  │   (Flushes directory dentry entries to physical platter/SSD)             │
│  └── closeSync(parentDirFd)                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Durability Guarantees:

- **Crash in Stage 1**: Only an isolated `.tmp` file is left. Target `state.json` remains intact.
- **Crash in Stage 2**: POSIX guarantees `renameSync` is atomic—the target file either points to the old version or the new version; it is never half-swapped.
- **Stage 3 Sync**: Guarantees directory index tables survive power cuts without filesystem corruption.

---

## 📐 5. Reference: Filesystem Permission Matrix

Capsules enforce strict POSIX permissions to prevent accidental manual edits:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CAPSULE FILESYSTEM PERMISSION MATRIX                     │
├──────────────────────────┬──────────┬───────────────────────────────────────┤
│ Artifact Path            │ Mode     │ Rationale                             │
├──────────────────────────┼──────────┼───────────────────────────────────────┤
│ `state.json`             │ `0o644`  │ Read/write by harness, readable by UI │
│ `events.jsonl`           │ `0o644`  │ Append-only by lock holder            │
│ `prompt.md`              │ `0o444`  │ Read-only; immutable prompt baseline  │
│ Published Packets        │ `0o444`  │ Read-only; digest-bound brief packets │
│ Capsule Directories      │ `0o755`  │ Executable/Searchable for clean `rm`  │
│ Temporary `.tmp` files   │ `0o600`  │ Owner-only during write stage         │
└──────────────────────────┴──────────┴───────────────────────────────────────┘
```

---

## 📖 6. How-To Guide: Diagnosing Lock Contention

### Checking Current Lock Holder

If a CLI command reports `LOCK_TIMEOUT`:

```bash
cat .locks/<run-id>/owner.json
```

Output:

```json
{
  "pid": 19402,
  "hostname": "macbook-pro.local",
  "holder_token": "HLD_192830",
  "acquired_at": "2026-08-23T03:10:00.000Z"
}
```

### Checking if Holder Process is Alive

```bash
ps -p 19402
```

If the process does not exist, the holder crashed. Run `doctor:repair` to clean stale lock state:

```bash
bun harness.ts doctor:repair --run .capsules/<run-id> --actor coordinator
```

---

## 💻 7. Tutorial: Complete State Mutation Walkthrough

### 1. Harness Initiates Task Claim

Worker `worker-1` attempts to claim `task-auth`.

### 2. Lock Acquisition

1. Harness opens descriptor on `.capsules/run-99` directory.
2. Calls `flock(fd, LOCK_EX | LOCK_NB)` via `bun:ffi`.
3. Writes `.locks/run-99/owner.json` with PID and token.

### 3. Read & Verify Head

1. Reads `events.jsonl`.
2. Verifies cryptographic head matches `state.json` projection.

### 4. Append Event & Sync

1. Appends Event 14 (`task-claimed`) to `events.jsonl`.
2. Calls `fsyncSync` on `events.jsonl` file descriptor.

### 5. 3-Stage Atomic Write of `state.json`

1. Writes `.state.json.f492a81.tmp`.
2. Flushes via `fsyncSync`.
3. Calls `renameSync(".state.json.f492a81.tmp", "state.json")`.
4. Flushes capsule directory descriptor with `fsyncSync`.

### 6. Lock Release

1. Deletes `.locks/run-99/owner.json`.
2. Calls `flock(fd, LOCK_UN)`.
3. Closes directory descriptor.

---

[⬅ Previous: Tamper-Proof Hash Chains](./01-tamper-proof-hash-chains.md) | [Master Table of Contents](../README.md) | [Next: Stale Worker & Torn Tail Recovery ➡](./03-stale-worker-and-torn-tail-recovery.md)
