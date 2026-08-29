# 12.2 Non-Blocking Message Delivery — POSIX Flock-Protected Channels, Lock-Free Directory Polling, Asynchronous Sentinels & At-Least-Once Delivery Guarantees

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 12: Flock Mailboxes & Live TUI](./index.md) > 12.2 Non-Blocking Message Delivery

---

> **Status**: Authoritative Architecture Specification  
> **Topic**: Advisory File Locking, Non-Blocking `EWOULDBLOCK` Polling, Inotify/Kqueue Sentinel Wakeups, Exponential Backoff with Jitter, and Merkle Deduplication  
> **Target Audience**: Distributed Systems Engineers, Concurrency Engineers, OS & Storage Kernel Specialists

---

[⏮️ Previous: 12-01 Mailbox Directory Protocol](12-01-inter-agent-mailbox-directory-protocol.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 12-03 Audit Logging & Transcripts](12-03-audit-logging-and-transcripts.md)
---

## 1. Executive Summary & Concurrency Problem Statement

In distributed multi-agent execution environments, inter-agent messaging channels face two opposing hazards:

1. **Race Conditions & Split-Brain Execution**: When multiple sub-agents, repair workers, or supervisor threads read from the same message directory concurrently, uncoordinated reads produce duplicate execution of the same mutation task, corrupted intermediate files, and non-deterministic state drift.
2. **Thread Blocking & Deadlock Cascades**: Mandatory synchronization primitives (e.g., blocking mutexes, synchronous RPC waits, blocking `flock(fd, LOCK_EX)`) risk freezing worker threads indefinitely if a lock-holding process terminates abruptly or enters a lengthy LLM generation phase.

The **OLT Non-Blocking Message Delivery Subsystem** eliminates this concurrency dilemma by combining **POSIX advisory file locking (`flock`)**, **lock-free directory scanning**, **asynchronous filesystem sentinels**, and **cryptographic Merkle deduplication**.

```
                   NON-BLOCKING DUAL-PHASE MESSAGE ARBITRATION
  Agent Consumer Thread                                Mailbox Inode & Locks
  ┌───────────────────────────┐                       ┌───────────────────────────┐
  │ 1. Phase 1: Lock-Free     │  POSIX readdir(3)     │ inbox/                    │
  │    Quick Directory Scan   ├──────────────────────►│  ├── 001_P1_msg_a.json    │
  └─────────────┬─────────────┘                       │  └── 002_P2_msg_b.json    │
                │                                     └───────────────────────────┘
          [Files Present]
                │
                ▼
  ┌───────────────────────────┐                       ┌───────────────────────────┐
  │ 2. Phase 2: Non-Blocking  │  flock(LOCK_EX|NB)    │ .lock (Advisory Inode)    │
  │    Advisory Lock Probe    ├──────────────────────►│  Holder: None             │
  └─────────────┬─────────────┘                       └─────────────┬─────────────┘
                │                                                   │
        [Acquired Lock: OK]                                         │
                │                                                   ▼
                ▼                                     ┌───────────────────────────┐
  ┌───────────────────────────┐   POSIX rename(2)     │ processed/                │
  │ 3. Execute & Atomic Claim ├──────────────────────►│  └── 001_P1_msg_a.json    │
  └─────────────┬─────────────┘                       └───────────────────────────┘
                │
                ▼
  ┌───────────────────────────┐
  │ 4. Release Lock & Close Fd│
  └───────────────────────────┘
```

---

## 2. POSIX Advisory `flock` Protocol & Non-Blocking Semantics

### 2.1 Advisory Locking vs Mandatory Locking

OLT relies strictly on POSIX **advisory locking** via `flock(2)` rather than mandatory record locking (`fcntl(2)` with `MS_MANDLOCK`):

- **Advisory Semantics**: Advisory locks are cooperative. Processes that query the lock respect mutual exclusion, while diagnostic read-only inspection tools (e.g., Live TUI dashboards, offline log viewers) can inspect directory structures without blocking or triggering kernel permission faults.
- **Process Termination Cleanup**: The host kernel automatically releases any `flock` held by a process upon file descriptor close or process death (`SIGKILL`, `SIGSEGV`, `exit(3)`). This guarantees zero stale-lock deadlocks following worker crash events.

### 2.2 The Non-Blocking Acquisition Rule

All mailbox locking attempts MUST specify the non-blocking flag `LOCK_NB`:

$$\text{flock}(\text{fd}, \text{LOCK\_EX} \mid \text{LOCK\_NB})$$

If the lock is held by another concurrent process, the kernel immediately returns $-1$ with `errno = EWOULDBLOCK` (or `EAGAIN`). The runtime NEVER blocks or sleeps inside a kernel syscall, preventing worker starvation and unbounded thread pooling.

```mermaid
flowchart TD
    Start([Consumer Mailbox Poll]) --> Scan[Phase 1: Lock-Free readdir inbox/]
    Scan --> HasFiles{Files in inbox/?}

    HasFiles -- No --> WaitSentinel[Wait on .wake Sentinel via inotify/kqueue]
    WaitSentinel --> Scan

    HasFiles -- Yes --> TryLock[Phase 2: flock fd, LOCK_EX | LOCK_NB]
    TryLock --> LockAcquired{Lock Acquired?}

    LockAcquired -- No: EWOULDBLOCK --> CalcBackoff[Compute Exponential Backoff + Jitter]
    CalcBackoff --> BackoffSleep[Async Timer Sleep T_backoff]
    BackoffSleep --> Scan

    LockAcquired -- Yes: 0 --> Peek[Pick Highest Priority Message]
    Peek --> DedupCheck{In Merkle Filter or processed/?}

    DedupCheck -- Duplicate --> Deadletter[Atomic Move to processed/ Deduplicated]
    DedupCheck -- New Message --> Process[Execute Message Mutation]

    Process --> Success{Execution Success?}
    Success -- Yes --> MarkProcessed[Atomic Move to processed/ + fsync]
    Success -- No: Fatal/Max Retries --> MarkDead[Atomic Move to deadletter/ + Log]

    MarkProcessed --> ReleaseLock[flock fd, LOCK_UN + close fd]
    MarkDead --> ReleaseLock
    Deadletter --> ReleaseLock
    ReleaseLock --> Done([Poll Cycle Complete])

    classDef normal fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef branch fill:#334155,stroke:#f59e0b,stroke-width:2px,color:#f8fafc;
    classDef success fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc;
    classDef fail fill:#7f1d1d,stroke:#ef4444,stroke-width:2px,color:#f8fafc;

    class Start,Scan,WaitSentinel,TryLock,Peek,Process,MarkProcessed,ReleaseLock,Done normal;
    class HasFiles,LockAcquired,DedupCheck,Success branch;
    class MarkProcessed success;
    class MarkDead,Deadletter fail;
```

---

## 3. Dual-Phase Lock-Free Polling Algorithm

To maximize throughput and minimize kernel lock contention, consumers execute a **dual-phase polling protocol**:

1. **Phase 1: Lock-Free Probing**: The consumer invokes `readdir(3)` on `inbox/`. If the directory contains zero message entries, the consumer returns immediately without creating or locking any file descriptors.
2. **Phase 2: Advisory Lock Claim**: If one or more candidate messages are discovered, the consumer attempts an atomic advisory lock on `.lock`. If successful, the consumer processes the highest-priority message and migrates it via atomic `rename(2)`.

### 3.1 Consumer Loop Implementation with Backoff & Jitter

```typescript
import { openSync, closeSync, readdirSync, renameSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { flock, LOCK_EX, LOCK_NB, LOCK_UN } from "../logging/lock.ts";
import { HarnessError } from "../core/errors/index.ts";

export interface ConsumerConfig {
  readonly baseBackoffMs: number; // e.g., 50ms
  readonly maxBackoffMs: number; // e.g., 2000ms
  readonly maxRetries: number; // e.g., 5
  readonly jitterFraction: number; // e.g., 0.25
}

export async function pollMailboxNonBlocking(
  capsuleRoot: string,
  agentId: string,
  config: ConsumerConfig,
): Promise<MessageProcessingResult | null> {
  const mailboxRoot = join(capsuleRoot, "mailbox", agentId);
  const inboxDir = join(mailboxRoot, "inbox");
  const processedDir = join(mailboxRoot, "processed");
  const lockPath = join(mailboxRoot, ".lock");

  let attempt = 0;

  while (attempt <= config.maxRetries) {
    // Phase 1: Lock-free probe
    const candidates = readdirSync(inboxDir).filter((f) => f.endsWith(".json"));
    if (candidates.length === 0) {
      return null; // Clean empty mailbox, zero lock contention
    }

    candidates.sort(); // Lexicographical priority ordering
    const targetFileName = candidates[0];
    const sourcePath = join(inboxDir, targetFileName);

    // Phase 2: Non-blocking flock acquisition
    const lockFd = openSync(lockPath, "w+");
    const acquired = flock(lockFd, LOCK_EX | LOCK_NB);

    if (!acquired) {
      closeSync(lockFd);
      attempt++;
      if (attempt > config.maxRetries) {
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `Exceeded maximum lock retry attempts for agent mailbox ${agentId}`,
        );
      }

      // Calculate Full Jitter Exponential Backoff
      const rawBackoff = Math.min(config.maxBackoffMs, config.baseBackoffMs * Math.pow(2, attempt));
      const jitter = Math.random() * (rawBackoff * config.jitterFraction);
      const sleepTime = Math.floor(rawBackoff + jitter);

      await new Promise((resolve) => setTimeout(resolve, sleepTime));
      continue;
    }

    try {
      // Re-verify file presence under lock to handle concurrent dequeue race
      if (!existsSync(sourcePath)) {
        continue; // Handled by a peer worker
      }

      const rawEnvelope = readFileSync(sourcePath, "utf8");
      const message = JSON.parse(rawEnvelope);

      // Execute task action
      const executionResult = await dispatchMessagePayload(message);

      // Atomic transition to processed directory
      const destPath = join(processedDir, targetFileName);
      renameSync(sourcePath, destPath);

      return {
        success: true,
        messageId: message.message_id,
        result: executionResult,
      };
    } finally {
      flock(lockFd, LOCK_UN);
      closeSync(lockFd);
    }
  }

  return null;
}
```

---

## 4. Asynchronous Wakeup Mechanisms & Sentinel Signaling

While lock-free polling handles message acquisition, continuous spinning consumes CPU cycles. OLT provides **Asynchronous Sentinel Signaling** to awaken sleeping agents with zero CPU waste.

### 4.1 Sentinel Touch Protocol

1. **The Sentinel File (`.wake`)**: Every agent mailbox directory contains a sentinel file `.wake`.
2. **Sender Signal**: Upon successfully enqueuing a message into `recipient/inbox/`, the sender updates the modification time of `recipient/.wake` via `utimes(2)` or creates it via `touch`.
3. **Recipient Kernel Watcher**:
   - On Linux: Recipient threads register an `inotify` watch on `.wake` for `IN_MODIFY | IN_ATTRIB`.
   - On macOS / BSD: Recipient threads register a `kqueue` `EVFILT_VNODE` watch with `NOTE_WRITE | NOTE_ATTRIB`.
   - Fallback: Non-blocking timer tick ($250\text{ms}$ interval) guarantees progress even if OS kernel event notifications are suppressed in constrained container sandboxes.

```
 Sender Agent                                      Receiver Agent
 ┌───────────────────────────┐                    ┌───────────────────────────┐
 │ 1. atomicEnqueue()        │                    │ 1. kqueue / inotify wait  │
 │    writes to inbox/       │                    │    in kernel sleep        │
 └─────────────┬─────────────┘                    └─────────────▲─────────────┘
               │                                                │
               ▼                                                │ Kernel Event
 ┌───────────────────────────┐   utimes(2) touch  ┌─────────────┴─────────────┐
 │ 2. Touch .wake Sentinel   ├───────────────────►│ .wake Inode Attribute Mod │
 └───────────────────────────┘                    └───────────────────────────┘
```

---

## 5. Delivery Guarantees & Merkle-Deduplication Proof

### 5.1 Formal Delivery Guarantee Model

OLT guarantees **At-Least-Once Delivery with Monotonic Idempotent De-duplication**, ensuring exact-once execution semantics at the application boundary:

$$\forall \mathcal{M} \in \text{EnqueuedMessages}, \quad \text{ExecutionCount}(\mathcal{M}) = 1$$

#### Proof Sketch under Arbitrary Process Death (SIGKILL):

1. **Case 1: Sender Dies During Staging (`tmp/` write)**:
   The message is unlinked by garbage collection. The recipient never observes `inbox/` entry. The sender's supervisory runtime detects task non-completion and re-emits. $\implies \text{Executions} = 0 \to 1$.
2. **Case 2: Sender Dies Post-Rename (`rename(2)` completed)**:
   The message is safely sealed in `inbox/`. The recipient awakens and executes. $\implies \text{Executions} = 1$.
3. **Case 3: Recipient Dies Mid-Execution**:
   The message remains in `inbox/` because `rename(2)` to `processed/` occurs _after_ execution. Upon restart, the recovery agent dequeues the message. Because all state mutations adhere to Invariant $C_5$ (monotonic patch operations), idempotent re-execution produces identical final state. $\implies \text{Executions} = 1$.

### 5.2 Merkle Deduplication Filter

Every consuming agent maintains a rolling cryptographic deduplication cache $\mathcal{K}_{\text{dedup}}$ backed by a Bloom filter and a sliding window of recent message hashes:

$$\kappa(m) = \text{HMAC-SHA256}(K_{\text{capsule}}, m.\text{message\_id} \parallel m.\text{correlation\_id} \parallel m.\text{created\_at})$$

```
                    MERKLE SLIDING WINDOW DEDUPLICATION
  Inbound Message (m)
          │
          ▼
  ┌───────────────┐
  │ Compute κ(m)  │
  └───────┬───────┘
          │
          ▼
  ┌───────────────┐    Match Found
  │ Bloom Filter  ├──────────────────► [DISCARD AS DUPLICATE] ──► Log to audit
  └───────┬───────┘
          │ No Match
          ▼
  ┌───────────────┐    Exists
  │ Check Disk    ├──────────────────► [DISCARD AS DUPLICATE] ──► Move to processed/
  │ processed/    │
  └───────┬───────┘
          │ Absent
          ▼
  [EXECUTE MESSAGE MUTATION] ──► Insert κ(m) into Rolling Window Buffer
```

---

## 6. Mathematical Formulations of Contention & Backoff

### 6.1 Lock Contention Probability

Let $N$ be the number of active concurrent agents attempting to dequeue from shared mailbox lanes, and let $\lambda$ be the arrival rate of dequeue requests per agent with critical section duration $\tau_{\text{crit}}$:

$$P(\text{Contention}) = 1 - \exp\left( - (N - 1) \cdot \lambda \cdot \tau_{\text{crit}} \right)$$

For OLT with non-overlapping mailbox assignment ($N = 1$ per directory domain):

$$P(\text{Contention}) = 1 - e^0 = 0$$

For shared coordinator arbitration queues ($N = 8, \lambda = 0.5\,\text{ops/s}, \tau_{\text{crit}} = 0.005\,\text{s}$):

$$P(\text{Contention}) = 1 - \exp(-7 \times 0.5 \times 0.005) = 1 - e^{-0.0175} \approx 1.73\%$$

### 6.2 Full-Jitter Exponential Backoff Expectation

Under contention, the sleep duration for attempt $k$ follows the uniform distribution:

$$T_{\text{sleep}}(k) \sim \mathcal{U}\left(0, \, \min(T_{\max}, \, T_{\text{base}} \cdot 2^k)\right)$$

The expected delay $\mathbb{E}[T(k)]$ is:

$$\mathbb{E}[T(k)] = \frac{\min(T_{\max}, \, T_{\text{base}} \cdot 2^k)}{2}$$

This distribution prevents synchronous resonance (the "thundering herd" effect) across parallel implementer swarms.

---

## 7. Edge Cases & Error Handling

```
┌──────────────────────────────────────┬──────────────────────────────┬────────────────────────────────────────┐
│ Concurrency Edge Case                │ Failure Signature            │ OLT Runtime Resolution Mechanism       │
├──────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────┤
│ **Stale Lock Inode Orphan**          │ Host reboot leaves `.lock`   │ POSIX `flock` is kernel-backed; closing│
│                                      │ file on disk.                │ fd or OS reboot clears all locks.      │
├──────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────┤
│ **Concurrent Dequeue Race**          │ Two workers see file, one    │ Loser receives `ENOENT` on rename(2);  │
│                                      │ successfully acquires lock.  │ gracefully skips to next message file. │
├──────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────┤
│ **Poison Message Loop**              │ Message causes worker crash  │ Retry counter exceeds 3; moved to      │
│                                      │ on every execution attempt.  │ `deadletter/` with forensic snapshot.  │
├──────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────┤
│ **Kernel Sentinel Event Drop**       │ OS inotify queue overflow    │ Automatic $250\text{ms}$ periodic tick │
│                                      │ during high-burst waves.     │ forces directory rescan fallback.      │
└──────────────────────────────────────┴──────────────────────────────┴────────────────────────────────────────┘
```

---

## 8. Summary Takeaways

- **Deadlock-Free Concurrency**: Utilizing non-blocking POSIX `flock` (`LOCK_EX | LOCK_NB`) guarantees that worker agents never freeze indefinitely on kernel lock primitives.
- **Dual-Phase Efficiency**: Lock-free probing eliminates kernel lock overhead for idle mailboxes, preserving compute bandwidth for active cognitive tasks.
- **Idempotent Exact-Once Semantics**: The combination of post-execution atomic `rename(2)` and Merkle deduplication ensures that unannounced agent crashes never cause duplicate state mutations.
- **Kernel-Native Wakeups**: Sentinel `.wake` event watches via `kqueue`/`inotify` awaken sleeping agents instantaneously with zero CPU spin polling.

---

[⏮️ Previous: 12-01 Mailbox Directory Protocol](12-01-inter-agent-mailbox-directory-protocol.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 12-03 Audit Logging & Transcripts](12-03-audit-logging-and-transcripts.md)
---
