# 03. Stale Worker, Crash Forensics & Torn Tail Quarantine

[⬅ Previous: POSIX File Locking & Durable Writes](./02-posix-flock-and-fdatasync.md) | [Master Table of Contents](../README.md) | [Next: Chapter 09 — End-to-End Tutorial & CLI Reference ➡](../09-tutorial-and-cli/01-end-to-end-tutorial.md)

---

## 💥 The Anatomy of Crash Recovery

What happens when an agent subagent crashes mid-execution, a laptop battery dies, or an unhandled exception interrupts a long task?

The harness provides an automated, fail-safe **Recovery Engine** (`harness.ts recover`):

```bash
bun orchestrating-long-tasks/scripts/harness.ts recover \
  --run .capsules/<run-id> \
  --actor coordinator \
  --grace-seconds 0
```

---

## ✂️ Forensic Recovery Protocol: Torn Tail Quarantine

If a process was terminated while in the middle of appending bytes to `events.jsonl`, the trailing line may contain partial, unparseable JSON characters.

Instead of crashing or silently deleting bytes, the harness runs the **Quarantine Protocol**:

```text
[ events.jsonl with corrupted trailing bytes ]
  ├── Line 1..82: Valid, canonical, cryptographic event objects
  └── Line 83: `{"sequence": 83, "kind": "command-in...` (TRUNCATED BY CRASH)
                                │
                                ▼ (harness recover / event validator)
┌────────────────────────────────────────────────────────┐
│  QUARANTINE ACTION:                                    │
│  1. Identify exact offset of last valid byte           │
│  2. Copy corrupted fragment to:                        │
│     `.capsules/<run-id>/evidence/recovery-torn-<id>.fragment`
│  3. `ftruncateSync(fd, lastValidByteOffset)`           │
│  4. `fsyncSync(fd)`                                    │
│  5. Re-evaluate hash chain head cleanly                │
└────────────────────────────────────────────────────────┘
```

---

## 🧟 Stale Worker & Zombie Lease Reclamation

When an agent crashes or loses network connectivity, its task lease eventually expires:

$$\text{now}() > \text{lease.expires\_at}$$

During recovery:
1. The coordinator scans all active task leases.
2. Expired leases are identified and marked as stale.
3. If an associated OS process is still running, the watchdog emits `SIGTERM` followed by `SIGKILL` (Strong Absence Verification).
4. The task status transitions back from `leased` to `ready` (or `changes_requested` if in validation).
5. A new implementer can safely claim the task without conflicting with a zombie process!

---

[⬅ Previous: POSIX File Locking & Durable Writes](./02-posix-flock-and-fdatasync.md) | [Master Table of Contents](../README.md) | [Next: Chapter 09 — End-to-End Tutorial & CLI Reference ➡](../09-tutorial-and-cli/01-end-to-end-tutorial.md)
