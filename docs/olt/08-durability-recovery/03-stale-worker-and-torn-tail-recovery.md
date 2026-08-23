# 03. Stale Worker, Crash Forensics & Torn Tail Quarantine

[⬅ Previous: POSIX File Locking & Durable Writes](./02-posix-flock-and-fdatasync.md) | [Master Table of Contents](../README.md) | [Next: Chapter 09 — Execution-Time Branching ➡](../09-branching-and-honesty/01-execution-time-branching.md)

---

## 🧭 Diátaxis Overview

| Quadrant         | Purpose in this Chapter                                                                                                                                         |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explanation**  | Understand crash recovery architecture, torn tail forensic quarantine, stale lease reclamation, autonomous supervision classification, and watchdog subsystems. |
| **How-To Guide** | Running stale recovery (`recover`), repairing torn log tails (`doctor:repair`), supervising autonomous runs (`orchestrator:supervise`), and managing watchdogs. |
| **Reference**    | Recovery event catalog, supervisor error classification rules, backoff formulas, and watchdog CLI commands.                                                     |
| **Tutorial**     | Complete walkthrough of diagnosing a mid-write crash, isolating a torn event fragment, and recovering unblocked execution.                                      |

---

## 💥 1. Explanation: Crash Recovery Architecture

When an agent crashes mid-execution, a subagent loses network connectivity, or a host terminates unexpectedly, multi-agent runs can be left in inconsistent states.

`olt` provides a **deterministic, fail-safe recovery architecture**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CRASH RECOVERY ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Idempotent Event Replay                                                 │
│     State is never lost; it is deterministically rebuilt from the log.      │
│                                                                             │
│  2. Separation of Observation and Mutation                                  │
│     `doctor`, `run:status`, and `plan:status` are STRICTLY READ-ONLY.       │
│     They diagnose issues without mutating state.                            │
│                                                                             │
│  3. Explicit Recovery Events                                                │
│     All mutations are explicit CLI actions (`recover`, `doctor:repair`)     │
│     recorded as durable events on the hash chain.                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ✂️ 2. Explanation: Torn Tail Quarantine Protocol (`doctor:repair`)

If a process terminates mid-append while writing to `events.jsonl`, the trailing line on disk contains truncated, invalid JSON bytes.

`doctor:repair` handles this with **Forensic Quarantine**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TORN TAIL FORENSIC QUARANTINE ENGINE                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  events.jsonl (Truncated trailing bytes on disk)                            │
│  ├── Line 1..40: Valid, hash-linked cryptographic events                    │
│  └── Line 41: `{"sequence": 41, "kind": "task-subm...` (TRUNCATED BY CRASH) │
│                                   │                                         │
│                                   ▼ (doctor:repair)                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 1. LOCATE LAST VALID BYTE OFFSET                                      │  │
│  │    Scan events from genesis, verify hashes, record clean byte offset. │  │
│  │                                                                       │  │
│  │ 2. ISOLATE TORN BYTES TO QUARANTINE                                   │  │
│  │    Copy all bytes past clean offset to:                               │  │
│  │    `.olt/capsules/<run-id>/quarantine/recovery-torn-<token>.fragment`     │  │
│  │    (Chmod to 0o400 read-only; preserved for post-mortem forensics)    │  │
│  │                                                                       │  │
│  │ 3. TRUNCATE REAL LOG FILE                                             │  │
│  │    `ftruncateSync(fd, lastValidByteOffset)` + `fsyncSync(fd)`         │  │
│  │                                                                       │  │
│  │ 4. REBUILD & RECORD RECOVERY EVENT                                    │  │
│  │    Re-project `state.json` from clean head and append                 │  │
│  │    `projection-recovered` event to hash chain.                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The corrupted fragment is **never deleted or silently dropped**—it is archived in `quarantine/` for forensic audit.

---

## 🧟 3. Explanation: Stale Worker & Zombie Lease Eviction (`recover`)

When an agent process terminates or hangs, its lease eventually expires:

$$\text{now}() > \text{lease.expires\_at} + \text{grace\_seconds}$$

```bash
bun harness.ts recover --run .olt/capsules/<run-id> --actor coordinator --grace-seconds 30
```

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     STALE LEASE RECLAMATION PIPELINE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Unfinished Implementations                                              │
│     Tasks in `leased` with expired leases transition to `retry_ready`.      │
│                                                                             │
│  2. Unfinished Repairs                                                      │
│     Tasks in `repair` with expired leases transition to `changes_requested` │
│     so that recorded findings are preserved for the next repairer.          │
│                                                                             │
│  3. Interrupted Validations                                                 │
│     Validations stalled mid-review are reopened for fresh assignment.       │
│                                                                             │
│  4. Sub-Branch Reclamation                                                  │
│     Dead branch child tasks are reclaimed, recording expired agent lineage. │
│                                                                             │
│  5. Branched Parent Protection                                              │
│     Branched parents (status `branched`) are NEVER reaped. Their lease      │
│     clock is suspended while waiting for children.                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Late Zombie Submissions

If a reclaimed zombie agent wakes up and attempts `task:submit`, its token matches an expired attempt. The harness intercepts the submission, rejects the state transition, and redirects the command receipts into **Orphan Evidence** (`reason: "stale_recovered_lease"`).

---

## 🤖 4. Explanation: Autonomous Supervision (`orchestrator:supervise`)

For unattended, overnight multi-agent execution, `orchestrator:supervise` provides an automated **Reclaim $\to$ Escalate $\to$ Dispatch** loop:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                   AUTONOMOUS SUPERVISORY ENGINE PASS                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. RECLAIM PHASE                                                           │
│     • Runs `recoverStale()` to reclaim expired leases.                      │
│     • Appends `supervisor-dead-agent-reclaimed` events to hash chain.       │
│                                  │                                          │
│                                  ▼                                          │
│  2. CLASSIFY & ESCALATE PHASE                                               │
│     • Inspects trailing failures for each task.                             │
│     • Classifies failures as TRANSIENT vs DETERMINISTIC.                    │
│     • Deterministic failure ──► `escalateTask(..., "retry_budget_exhaust")` │
│                                 (Permanently hands task to human)           │
│                                  │                                          │
│                                  ▼                                          │
│  3. DISPATCH & BACKOFF PHASE                                                │
│     • Calculates available concurrency slots.                               │
│     • Computes full-jitter exponential backoff for transient retries.       │
│     • Dispatches ready tasks to available workers.                          │
│                                  │                                          │
│                                  ▼                                          │
│  4. EMIT MORNING REPORT                                                     │
│     • Generates comprehensive Markdown summary of progress and blockers.    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Failure Classification Rules

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FAILURE CLASSIFICATION & ESCALATION                      │
├─────────────────────────┬───────────────┬───────────────────────────────────┤
│ Failure Signal          │ Class         │ Supervisory Behavior              │
├─────────────────────────┼───────────────┼───────────────────────────────────┤
│ `rate_limit`, `network`,│ Transient     │ Retries with full-jitter backoff; │
│ `provider_5xx`, `timeout`│ (Unbounded)   │ escalates only after max elapsed  │
│                         │               │ time (default: 4 hours).          │
├─────────────────────────┼───────────────┼───────────────────────────────────┤
│ `crash`                 │ Transient     │ Retries up to 3 consecutive       │
│ (Lease expired no sub)  │ (Bounded)     │ repeats, then escalates.          │
├─────────────────────────┼───────────────┼───────────────────────────────────┤
│ `auth`, `gate_failure`, │ Deterministic │ Escalates immediately on first    │
│ `unknown_error`         │ (Immediate)   │ occurrence to avoid burning token │
│                         │               │ budget on unsolvable logic.       │
└─────────────────────────┴───────────────┴───────────────────────────────────┘
```

### Full-Jitter Exponential Backoff Formula:

$$\text{delay} = \left\lfloor \text{random}() \times \min\left(\text{maxDelayMs}, \text{initialDelayMs} \times 2^{(\text{repeatCount} - 1)}\right) \right\rfloor$$

---

## 🐕 5. Reference: Watchdog Supervisory Subsystem

In long-running autonomous runs, monitors and health probes are managed by the **Watchdog Manager Subsystem** (`authority/watchdog-manager.ts`):

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WATCHDOG LIFECYCLE STATE MACHINE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Registration: generation + pulse_id ]                                    │
│       │                                                                     │
│       ▼                                                                     │
│  ┌──────────┐      heartbeat timeout (>15m)       ┌──────────┐              │
│  │  ACTIVE  │ ──────────────────────────────────► │  STALE   │              │
│  └────┬─────┘                                     └────┬─────┘              │
│       │                                                │                    │
│       │ phase rollover / clean termination             │ watchdog:cleanup   │
│       ▼                                                ▼                    │
│  ┌──────────┐                                     ┌──────────┐              │
│  │TERMINATED│                                     │ ORPHANED │              │
│  └──────────┘                                     └──────────┘              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Watchdog Invariants:

1. **Single Active Monitor Invariant**: Exactly $\le 1$ active monitor per generation/pulse strictly enforced.
2. **Phase Rollover Purge**: Transitioning from `planning` to `execution` automatically purges legacy phase monitors via `watchdog:phase-cleanup`.

---

## 📖 6. How-To Guide: Recovery Operations

### Running Stale Lease Recovery

```bash
bun harness.ts recover \
  --run .olt/capsules/<run-id> \
  --actor coordinator \
  --grace-seconds 30
```

### Quarantining and Repairing a Torn Tail

```bash
# Check status (Read-only)
bun harness.ts doctor --run .olt/capsules/<run-id>

# Execute repair and quarantine
bun harness.ts doctor:repair \
  --run .olt/capsules/<run-id> \
  --actor coordinator
```

### Running Autonomous Supervision

```bash
bun harness.ts orchestrator:supervise \
  --run .olt/capsules/<run-id> \
  --actor coordinator
```

### Verifying Watchdog Registry

```bash
bun harness.ts watchdog:verify --generation 1
```

---

## 💻 7. Tutorial: Crash Forensics & Recovery Walkthrough

### Scenario

Host machine crashed while worker `worker-slug` was submitting Event 42. `events.jsonl` contains truncated trailing JSON.

### Step 1: Run Doctor (Read-Only)

```bash
bun harness.ts doctor --run .olt/capsules/run-402
```

Output:

```text
### Capsule Doctor: `.olt/capsules/run-402`
- **Healthy**: no ❌
- **Issues**:
  1. Torn tail detected in events.jsonl at line 42 (JSON parse error: Unexpected EOF)
  2. State projection out of sync with event head
```

### Step 2: Execute Forensic Repair

```bash
bun harness.ts doctor:repair --run .olt/capsules/run-402 --actor coordinator
```

Output:

```text
### Doctor Repair: `.olt/capsules/run-402`
- **Quarantined Fragment**: `.olt/capsules/run-402/quarantine/recovery-torn-91a8f2.fragment` (412 bytes)
- **Clean Event Head**: Sequence 41 (Hash: `9a810284...`)
- **Action**: Truncated events.jsonl to 18,402 bytes. Rebuilt state.json.
- **Event Appended**: `projection-recovered` (Sequence 42)
```

### Step 3: Reclaim Stale Leases

```bash
bun harness.ts recover --run .olt/capsules/run-402 --actor coordinator
```

Output:

```text
### Stale Recovery: `.olt/capsules/run-402`
- **Reclaimed Tasks**: `task-slug` returned to `retry_ready` (Prior attempt by `worker-slug` expired).
```

### Step 4: Resume Execution Cleanly

Worker `worker-slug-2` claims `task-slug` and completes execution without state corruption.

---

[⬅ Previous: POSIX File Locking & Durable Writes](./02-posix-flock-and-fdatasync.md) | [Master Table of Contents](../README.md) | [Next: Chapter 09 — Execution-Time Branching ➡](../09-branching-and-honesty/01-execution-time-branching.md)
