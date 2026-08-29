# Monotonic Lease Protocol & Bearer Tokens

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 07](./index.md) > 07-01 Monotonic Lease Protocol

---

[⏮️ Previous: Chapter 07: Distributed Leasing & Execution Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 07-02 Heartbeats & Anti-Theft Locking](07-02-heartbeats-and-anti-theft-locking.md)
---

## 1. Task Claim Mechanics (`task:claim`)

A worker cannot begin modifying code without acquiring an exclusive lease from the capsule state mutator.

```mermaid
sequenceDiagram
    participant Worker as Implementer Subagent
    participant Harness as OLT Harness CLI
    participant Mutator as Capsule State Mutator
    participant Lock as POSIX flock (state.json)

    Worker->>Harness: bun harness.ts task:claim --task task-1 --agent implementer_auth_1
    Harness->>Mutator: Acquire Capsule Advisory Lock
    Mutator->>Lock: flock(LOCK_EX, 5000ms)
    Mutator->>Mutator: Verify Task State == ready
    Mutator->>Mutator: Generate Monotonic Lease Token (seq + 1)
    Mutator->>Mutator: Append task-claimed Event to events.jsonl
    Mutator->>Lock: flock(LOCK_UN)
    Mutator-->>Worker: Return LeaseToken & Assigned Scope
```

---

## 2. Monotonic Token Formula

$$\text{LeaseToken} = \text{HMAC}_{\text{secret}}(\text{task\_id} \mathbin{\Vert} \text{agent\_id} \mathbin{\Vert} \text{lease\_seq} \mathbin{\Vert} \text{issued\_at})$$

When the worker submits completed work via `task:submit`, it must present the exact `LeaseToken`. If a watchdog revoked the lease due to inactivity, the submission is rejected with `INVALID_LEASE_TOKEN`.

---

[⏮️ Previous: Chapter 07: Distributed Leasing & Execution Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 07-02 Heartbeats & Anti-Theft Locking](07-02-heartbeats-and-anti-theft-locking.md)
---
