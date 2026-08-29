# The 5-Minute Straggler SLA Rule & Decomposition

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 05](./index.md) > 05-03 Straggler SLA Rule

---

[⏮️ Previous: 05-02 Coffman-Graham Width Bounds](05-02-coffman-graham-width-bounds.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 05-04 Dynamic Load Throttling](05-04-dynamic-load-throttling.md)
---

## 1. The Straggler Problem in Autonomous Systems

In multi-agent execution waves, overall wave completion is bounded by the slowest worker ($T_{\text{wave}} = \max_{i} T(A_i)$). An agent that enters a reasoning loop, encounters an ambiguous prompt, or gets stuck in a massive file edit acts as a **Straggler**, freezing all downstream waves.

OLT establishes the **5-Minute Straggler SLA Rule**:

$$T_{\text{active}}(T_j) > 300\text{s} \implies \text{TriggerSLA}(\text{Preempt} \lor \text{Decompose})$$

```text
                        STRAGGLER DETECTION TIMELINE
 0s                  60s                 180s                300s (SLA BREACH)
 ├─── Normal ────────┼─── Heartbeat ─────┼─── Slow Warning ──┼─── PREEMPTION ───►
 Active Execution    Heartbeat Refresh   Health Check        Revoke Lease
                                                             Split into Subtasks
```

---

## 2. Automated Task Preemption & Decomposition

```mermaid
flowchart TD
    Watchdog[Watchdog Heartbeat Monitor] --> CheckTimer{Task Time > 300s?}
    CheckTimer -->|No| Continue[Healthy Worker]
    CheckTimer -->|Yes| SLAEvent[Emit Event: STRAGGLER_SLA_BREACH]
    SLAEvent --> CheckProgress{Has Intermediate Progress?}
    CheckProgress -->|Git Staged Diffs Exist| SaveSprout[Save Progress to Sprout Branch]
    CheckProgress -->|0 Diffs / Loop Stuck| KillWorker[Kill Subagent & Revoke Lease]
    SaveSprout --> Decompose[Split Task: T_j -> {T_j.1, T_j.2}]
    KillWorker --> Requeue[Reset Task State: retry_ready]
    Decompose --> WaveRecompile[Recompile Wave DAG]
```

1. **Watchdog Interception**: The watchdog manager checks task runtimes every 15 seconds.
2. **Intermediate Checkpoint Extraction**: If the worker has staged git modifications (`git status`), the partial progress is preserved on a quarantined branch.
3. **Atomic Decomposition**: The remaining unfulfilled requirements are split into two parallel subtasks ($T_{j.1}, T_{j.2}$), each bounded by 150s budgets.

---

[⏮️ Previous: 05-02 Coffman-Graham Width Bounds](05-02-coffman-graham-width-bounds.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 05-04 Dynamic Load Throttling](05-04-dynamic-load-throttling.md)
---
