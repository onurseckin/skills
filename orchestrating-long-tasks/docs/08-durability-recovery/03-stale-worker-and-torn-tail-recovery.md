# 03. Stale Worker, Crash Forensics & Torn Tail Quarantine

[⬅ Previous: POSIX File Locking & Durable Writes](./02-posix-flock-and-fdatasync.md) | [Master Table of Contents](../README.md) | [Next: Chapter 09 — Execution-Time Branching ➡](../09-branching-and-honesty/01-execution-time-branching.md)

---

## 💥 The Anatomy of Crash Recovery

What happens when an agent subagent crashes mid-execution, a laptop battery dies, or an unhandled exception interrupts a long task?

The harness provides an automated, fail-safe recovery architecture integrated into the CLI state engine:

- All state transitions are idempotent and event-sourced.
- Query commands (`plan:status`, `queue:next`, `run:status`, `doctor`) read the chain and surface torn
  tails and expired leases without mutating anything.
- Reclaiming is an **explicit** command — `recover` — so a reclamation is an event with an actor, not a
  silent side effect of someone running a status query.

---

## ✂️ Forensic Recovery Protocol: Torn Tail Quarantine

If a process was terminated while in the middle of appending bytes to `events.jsonl`, the trailing line may contain partial, unparseable JSON characters.

Instead of crashing or silently deleting bytes, the harness runs the **Quarantine Protocol**:

```text
[ events.jsonl with corrupted trailing bytes ]
  ├── Line 1..82: Valid, canonical, cryptographic event objects
  └── Line 83: `{"sequence": 83, "kind": "command-in...` (TRUNCATED BY CRASH)
                                │
                                ▼ (Harness Event Stream Engine)
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

$$\text{now}() > \text{lease.expires\_at} + \text{grace}$$

```bash
bun harness.ts recover --run .capsules/<run-id> --actor coordinator --grace-seconds 30
```

`recover` does five things, all of them recorded as a `stale-recovery` event:

1. Returns tasks whose lease expired to `retry_ready` — or to `changes_requested` when the reaped
   attempt was a repair, so a dead repairer does not lose the findings it was opened to close.
2. Reopens validations that were interrupted mid-review.
3. Reclaims branch sub-tasks whose sub-agent died, recording who held them and when they expired, so a
   reclaimed sub-task still shows its history.
4. Expires a stale completeness critic.
5. Leaves a **branched parent alone.** Its lease clock is suspended, not running out: it is blocked on
   children, not gone. Reaping it would orphan the very sub-agents it is waiting for.

A fresh agent then claims the task with `task:claim --role`. The zombie's token no longer matches the
recorded digest, so a late write from it is refused rather than clobbering the new lease.

---

## 🤝 The Voluntary Path

An agent that knows it cannot finish should not make the run wait out a 30-minute clock:

```bash
bun harness.ts task:release --run .capsules/<run-id> --task <task-id> \
  --agent <worker-id> --token <bearer-token>
```

Same destination, immediately, and with the agent's own token proving it was really the holder. A
`branched` task refuses release until its branch is collected or abandoned.

---

## 🧟 Orphan Evidence

A dead agent can leave behind command records that belong to no live owner. These are collected as
**orphan evidence** rather than discarded, and completion blocks until each is explicitly disposed.
Deleting them would destroy the record of what the dead agent actually did; ignoring them would let a
run finish with unexplained activity in its own log.

---

[⬅ Previous: POSIX File Locking & Durable Writes](./02-posix-flock-and-fdatasync.md) | [Master Table of Contents](../README.md) | [Next: Chapter 09 — Execution-Time Branching ➡](../09-branching-and-honesty/01-execution-time-branching.md)
