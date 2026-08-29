# Chapter 07: Distributed Leasing Execution

---

[Previous: Chapter 06: Topological Scheduler DAGs](../06-topological-scheduler-dags/index.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 07-01 Monotonic Lease Protocol & Tokens](07-01-monotonic-lease-protocol-and-tokens.md)

---

## 1. Chapter Overview & The Distributed Execution Problem

Welcome to **Chapter 07 of the OLT Architecture Book**. In high-concurrency autonomous agent fleets, parallel workers execute distributed tasks across isolated git worktrees. Without rigorous distributed coordination and resource isolation, multi-agent systems suffer from four existential failure modes:

1. **Split-Brain Mutations**: Concurrent workers claim identical task lanes, overwriting each other's code commits.
2. **Zombie Lockups**: Stalled subagents hold exclusive file locks indefinitely, halting entire DAG execution pipelines.
3. **Lease Theft**: Over-eager schedulers prematurely evict active workers during heavy CPU compilations, triggering duplicate execution.
4. **Context Degradation**: Unbounded terminal output dumps and monolithic prompt ingestion flood LLM working memory past 150k tokens, inducing cognitive failure.

Chapter 07 formalizes the **Distributed Task Leasing & Execution Engine** of the OLT architecture. It defines the mathematical and operational mechanics governing cryptographic fencing tokens, non-blocking heartbeat telemetry, automated zombie process reclamation, and Cowan working-memory budget envelopes.

```text
+--------------------------------------------------------------------------------------------------+
|                            CHAPTER 07: DISTRIBUTED LEASING & EXECUTION TOPOLOGY                  |
+--------------------------------------------------------------------------------------------------+
|                                                                                                  |
|   ┌──────────────────────────────────────────────────────────────────────────────────────────┐   |
|   │ 07-01: Monotonic Lease Protocol & Cryptographic Fencing Tokens                           │   |
|   │ * Strictly monotonic sequence progression: f_{k+1} > f_k                                 │   |
|   │ * HMAC SHA-256 cryptographic lease signatures bound to capsule secret key                │   |
|   │ * Fail-closed stale write rejection preventing split-brain overwrites                    │   |
|   └─────────────────────────────┬────────────────────────────────────────────────────────────┘   |
|                                 │                                                                |
|                                 ▼                                                                |
|   ┌──────────────────────────────────────────────────────────────────────────────────────────┐   |
|   │ 07-02: Ephemeral Heartbeats & Anti-Theft Advisory Locking                                │   |
|   │ * Non-blocking private mailbox telemetry writes: mailbox/<agent>/heartbeat.json          │   |
|   │ * Mathematical anti-theft claim predicate: Pi_theft(T_i, A_k) with 300s lease SLA       │   |
|   │ * POSIX advisory lock files: .locks/task-<task_id>.lease                                 │   |
|   └─────────────────────────────┬────────────────────────────────────────────────────────────┘   |
|                                 │                                                                |
|                                 ▼                                                                |
|   ┌──────────────────────────────────────────────────────────────────────────────────────────┐   |
|   │ 07-03: Stale Worker & Zombie Subagent Auto-Recovery                                      │   |
|   │ * Bounded Recovery Time Objective: RTO_zombie <= 318 seconds                             │   |
|   │ * Escalated POSIX signal termination: SIGTERM -> 5s grace -> SIGKILL                     │   |
|   │ * Worktree scrubbing with forensic diff snapshotting: git reset --hard && git clean -fdx │   |
|   └─────────────────────────────┬────────────────────────────────────────────────────────────┘   |
|                                 │                                                                |
|                                 ▼                                                                |
|   ┌──────────────────────────────────────────────────────────────────────────────────────────┐   |
|   │ 07-04: Cowan Working Memory Token Budgeting & Stdout Sanitization                        │   |
|   │ * Strict 150,000 Cowan token working-memory envelope with 50,000 headroom buffer         │   |
|   │ * Deterministic Head-Tail stdout sanitization operator: S_stdout with 500-line cap       │   |
|   │ * Three-Tier Progressive Disclosure slice loading via URL endpoints                      │   |
|   └──────────────────────────────────────────────────────────────────────────────────────────┘   |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Chapter Table of Contents & Learning Path

The following table provides the topic map, architectural classifications, and core technical mechanics established in this chapter:

| Document                                                                                          | Classification          | Core Architectural Mechanics                                                                                                                                                               |
| :------------------------------------------------------------------------------------------------ | :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[07-01 Monotonic Lease Protocol & Tokens](07-01-monotonic-lease-protocol-and-tokens.md)**       | Security & Concurrency  | HMAC SHA-256 token minting, monotonic fencing sequences ($f_{k+1} > f_k$), POSIX advisory locks, split-brain write invalidation.                                                           |
| **[07-02 Heartbeats & Anti-Theft Locking](07-02-heartbeats-and-anti-theft-locking.md)**           | Concurrency & Telemetry | Ephemeral non-blocking mailbox pings ($T_{\text{heartbeat}} = 30\,\text{s}$), anti-theft claim predicate $\Pi_{\text{theft}}$, clock skew guards ($\epsilon_{\text{skew}} = 2\,\text{s}$). |
| **[07-03 Stale Worker & Zombie Auto-Recovery](07-03-stale-worker-and-zombie-auto-recovery.md)**   | Reliability & Recovery  | 4-step atomic recovery operator $\mathcal{R}_{\text{zombie}}$, $\text{RTO} \le 318\,\text{s}$, PID tree signal escalation (`SIGTERM` $\to$ `SIGKILL`), forensic diff capture.              |
| **[07-04 Cowan Token Budgeting & Sanitization](07-04-cowan-token-budgeting-and-sanitization.md)** | Memory & Optimization   | 150k Cowan token ceiling, 7-chunk working memory model, 500-line Head-Tail stdout sanitization ($\mathcal{S}_{\text{stdout}}$), progressive disclosure slices.                             |

---

## 3. Mathematical & Operational Invariants Summary

The distributed leasing engine enforces six mathematical and operational invariants across all worker nodes:

$$ \begin{array}{|l|l|l|}
\hline
\textbf{Mechanism} & \textbf{Formal Definition} & \textbf{Operational Invariant} \\ \hline
\text{HMAC Lease Token} & \mathcal{L}_{\text{token}} = \text{HMAC}_{K}(T_i \mathbin{\Vert} A_j \mathbin{\Vert} f_k \mathbin{\Vert} \tau) & \text{Cryptographic unforgeability across capsules} \\ \hline
\text{Fencing Progression} & f_{k+1} = f_k + 1 & \text{Strictly monotonic sequence; invalidates stale writes} \\ \hline
\text{Heartbeat Window} & \Delta t_{\text{hb}} = \text{Now}() - \tau_{\text{hb}} \le 300\,\text{s} & \text{Guarantees zero premature lease eviction (Anti-Theft)} \\ \hline
\text{Recovery SLA} & \text{RTO}_{\text{zombie}} \le 318\,\text{s} & \text{Bounded time to terminate zombie and re-queue task} \\ \hline
\text{Stdout Sanitizer} & |\mathcal{S}_{\text{stdout}}(O)| \le 500 \text{ lines} & \text{Head-Tail preservation with central omission marker} \\ \hline
\text{Cowan Envelope} & C_{\text{total}} \le 150{,}000 \text{ tokens} & \text{Protects agent reasoning from attention degradation} \\ \hline
\end{array}$$

```mermaid
flowchart TD
    subgraph ExecutionLifecycle ["Chapter 07 Distributed Leasing & Execution Lifecycle"]
        Ready[Task in READY Queue] -->|task:claim| Acquire[Acquire Lease & Mint Fencing Token f_k]
        Acquire --> Active[Worker Executes in Isolated Worktree]

        Active -->|Every 30s| Pulse[Emit Heartbeat to Private Mailbox]
        Pulse --> Active

        Active -->|Complete| Submit[task:submit with Fencing Token]
        Submit --> Gate[Verify Token == f_active]
        Gate -->|Valid| Validate[Transition to VALIDATING Wave]

        Active -->|Stall > 300s| Stale[Watchdog Detects Stale Lease]
        Stale --> Reap[Execute 4-Step Zombie Recovery]
        Reap -->|f_{k+1} Minted & Priority + 10| Ready
    end
```

---

## 4. Cross-Chapter Dependency & Integration Mesh

The distributed leasing engine interfaces directly with adjacent OLT subsystems:

```text
+--------------------------------------------------------------------------------------------------+
|                            CROSS-CHAPTER ARCHITECTURAL INTEGRATION MESH                          |
+--------------------------------------------------------------------------------------------------+
|                                                                                                  |
|   UPSTREAM SUBSYSTEMS:                                                                           |
|   ├── [Chapter 05: Concurrency & Straggler SLAs](../05-concurrency-straggler-sla/index.md)       |
|   │   └── Provides Brent work-span bounds (P = ceil(W/S)) and 5-minute straggler SLA rules.     |
|   └── [Chapter 06: Topological Scheduler DAGs](../06-topological-scheduler-dags/index.md)        |
|       └── Compiles dependency waves and in-degree tables feeding tasks into READY queues.        |
|                                                                                                  |
|   CORE CHAPTER 07 SUBSYSTEM: DISTRIBUTED LEASING EXECUTION                                       |
|   ├── Coordinates isolated execution lanes, fencing tokens, heartbeats, and reapers.             |
|                                                                                                  |
|   DOWNSTREAM CONSUMERS:                                                                          |
|   ├── [Chapter 08: Adversarial Validation & Repair](../08-adversarial-validation-repair/index.md) |
|   │   └── Consumes submitted tasks for dual-channel validation and monotonic repair cycles.      |
|   ├── [Chapter 10: Durability & Recovery Capsules](../10-durability-recovery-capsules/index.md)  |
|   │   └── Persists lease states, fencing counters, and event ledgers across crashes.            |
|   └── [Chapter 12: Flock, Mailboxes & TUI](../12-flock-mailboxes-and-tui/index.md)              |
|       └── Implements low-level POSIX flock primitives and real-time dashboard telemetry.         |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+
```

---

## 5. Summary & Navigation

Distributed leasing execution forms the operational engine of the OLT architecture. By combining cryptographic fencing tokens, non-blocking mailbox heartbeats, deterministic zombie recovery, and Cowan working-memory budgeting, OLT guarantees that concurrent task execution proceeds with zero split-brain corruption, zero permanent lockups, and zero context window exhaustion.

Begin reading the chapter topics in sequence:

1. **[07-01: Monotonic Lease Protocol & Cryptographic Tokens](07-01-monotonic-lease-protocol-and-tokens.md)**
2. **[07-02: Ephemeral Heartbeats & Anti-Theft Task Locking](07-02-heartbeats-and-anti-theft-locking.md)**
3. **[07-03: Stale Worker & Zombie Subagent Auto-Recovery](07-03-stale-worker-and-zombie-auto-recovery.md)**
4. **[07-04: Cowan Token Budgeting & Stdout Sanitization](07-04-cowan-token-budgeting-and-sanitization.md)**

Alternatively, advance directly to **[Chapter 08: Adversarial Validation & Repair](../08-adversarial-validation-repair/index.md)**.

---

[Previous: Chapter 06: Topological Scheduler DAGs](../06-topological-scheduler-dags/index.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 07-01 Monotonic Lease Protocol & Tokens](07-01-monotonic-lease-protocol-and-tokens.md)

---
$$
