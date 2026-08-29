# Heartbeats & Anti-Theft Task Locking

---

[Previous: 07-01 Monotonic Lease Protocol](07-01-monotonic-lease-protocol-and-tokens.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 07-03 Stale Worker & Zombie Recovery](07-03-stale-worker-and-zombie-auto-recovery.md)
---

## 1. Executive Summary & The Lease Theft Problem

In concurrent multi-agent systems, balancing rapid failure recovery with worker protection is a critical engineering challenge:

- If a scheduler prematurely assumes an active worker has crashed and re-assigns its task (a "lease theft"), both workers attempt to mutate the same subsystem simultaneously.
- Conversely, if a scheduler waits indefinitely without active health checks, a hung worker stalls the entire execution pipeline.

The **OLT (Orchestrating Long Tasks)** engine implements **Non-Blocking Heartbeats & Anti-Theft Task Locking**. Under this model:

1. **Periodic Non-Blocking Heartbeats**: Active workers emit lightweight heartbeat tokens to their private mailboxes every 30–60 seconds without acquiring global writer locks.
2. **Anti-Theft Lock Invariant**: A leased task whose heartbeat timestamp is fresh ($\text{Now}() - h(T_i) \le 300\text{s}$) is mechanically locked from being claimed, re-assigned, or stolen by any other agent.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 HEARTBEAT & ANTI-THEFT TOPOLOGY                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   ┌──────────────────────┐         ┌──────────────────────┐         ┌──────────────────────┐     │
│   │ Active Worker Agent  │  ───►   │ Private Mailbox Tick │  ───►   │ Anti-Theft Guard     │     │
│   │ (Executing Task T_i) │         │ (heartbeat.json)     │         │ (Reject Concurrent)  │     │
│   └──────────────────────┘         └──────────────────────┘         └──────────────────────┘     │
│              │                                 │                               │                 │
│              ▼                                 ▼                               ▼                 │
│      [Non-Blocking I/O]              [Timestamp Refreshed]          [Lease Stealing BLOCKED]     │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Mathematical Formalization of Anti-Theft Verification

Let $T_i$ be an active task leased to agent $A_j$ with lease record $\mathcal{L}(T_i)$.

Let $h(T_i)$ denote the Unix timestamp of the most recent valid heartbeat record in `.olt/capsules/<slug>/mailbox/<agent_id>/heartbeat.json`.

Let $\Delta t_{\text{stale}} = 300\text{s}$ (the 5-minute SLA ceiling).

When an agent $A_k$ ($k \neq j$) attempts to execute `task:claim` on $T_i$, the leasing engine evaluates the **Anti-Theft Claim Predicate** $\Pi_{\text{theft}}(T_i, A_k)$:

$$\Pi_{\text{theft}}(T_i, A_k) = \begin{cases} \text{REJECT (Lease Active)} & \text{if } \text{Status}(T_i) = \text{LEASED} \land \big(\text{Now}() - h(T_i) \le \Delta t_{\text{stale}}\big) \\ \text{PERMIT (Lease Expired)} & \text{if } \text{Status}(T_i) = \text{READY} \lor \big(\text{Now}() - h(T_i) > \Delta t_{\text{stale}}\big) \end{cases}$$

If $\Pi_{\text{theft}}(T_i, A_k) = \text{REJECT}$, the claim request is rejected with error `TASK_ALREADY_LEASED`.

```mermaid
flowchart TD
    ClaimReq[Agent A_k calls task:claim on T_i] --> CheckStatus{Task Status == LEASED?}

    CheckStatus -->|No: READY| GrantClaim[Mint new Lease Token & Grant Claim to A_k]
    CheckStatus -->|Yes: Currently Leased| ReadHeartbeat[Read heartbeat.json for active holder A_j]

    ReadHeartbeat --> CheckFreshness{Now - h T_i <= 300s?}
    CheckFreshness -->|Yes: Fresh Heartbeat| RejectTheft[TRAP Exit 3: TASK_ALREADY_LEASED]
    CheckFreshness -->|No: Expired Heartbeat| RevokeStale[Revoke stale lease of A_j & Mint seq_{k+1}]

    RevokeStale --> GrantClaim
    GrantClaim --> ClaimApproved([Claim Approved for A_k])
```

---

## 3. Non-Blocking Mailbox Heartbeat Architecture

To prevent lock contention in high-concurrency waves ($P \ge 15$), heartbeats bypass the central `state.json` file. Each subagent writes exclusively to its dedicated mailbox directory:

`.olt/capsules/<slug>/mailbox/<agent_id>/heartbeat.json`

```json
{
  "taskId": "task-core-04",
  "agentId": "implementer_engine_task-core-04",
  "leaseSequence": 3,
  "timestamp": "2026-08-29T03:16:00.000Z",
  "phase": "AST_REFACTORING",
  "linesModified": 142,
  "tokensConsumed": 18450
}
```

Because each agent owns its private file, heartbeat writes complete in $<1\text{ms}$ with zero blocking I/O.

---

## 4. Watchdog Sensor Inspection

The Autonomic Watchdog inspects heartbeat files using non-blocking directory scans:

```typescript
export async function auditHeartbeatFreshness(
  capsuleDir: string,
  activeTasks: TaskRecord[],
): Promise<StaleTaskReport[]> {
  const now = Date.now();
  const staleTasks: StaleTaskReport[] = [];
  for (const task of activeTasks) {
    const hb = await readAgentHeartbeat(capsuleDir, task.leaseHolder);
    if (!hb || now - new Date(hb.timestamp).getTime() > 300_000) {
      staleTasks.push({ taskId: task.taskId, agentId: task.leaseHolder, lastSeen: hb?.timestamp });
    }
  }
  return staleTasks;
}
```

---

## 5. Architectural Invariants Summary

1. **Zero Premature Eviction**: No active worker is evicted or replaced as long as its heartbeats are emitted within 300 seconds.
2. **Lock-Free Emission**: Heartbeat logging is completely decoupled from central writer locks, eliminating global synchronization bottlenecks.
3. **Forensic Auditability**: Heartbeat timestamps provide fine-grained latency profiling across all execution lanes.

---

[Previous: 07-01 Monotonic Lease Protocol](07-01-monotonic-lease-protocol-and-tokens.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 07-03 Stale Worker & Zombie Recovery](07-03-stale-worker-and-zombie-auto-recovery.md)
---
