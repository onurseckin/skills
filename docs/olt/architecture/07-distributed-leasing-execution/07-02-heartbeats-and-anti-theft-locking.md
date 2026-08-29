# Heartbeats & Anti-Theft Locking

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 07](./index.md) > 07-02 Heartbeats & Anti-Theft

---

[⏮️ Previous: 07-01 Monotonic Lease Protocol & Tokens](07-01-monotonic-lease-protocol-and-tokens.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 07-03 Stale Worker & Zombie Auto-Recovery](07-03-stale-worker-and-zombie-auto-recovery.md)
---

## 1. Heartbeat Protocol ($T_{\text{hb}} = 30\text{s}$, $T_{\text{ttl}} = 90\text{s}$)

Active workers must refresh their heartbeat timestamp in the capsule state store every 30 seconds:

```bash
bun olt/scripts/harness.ts task:heartbeat --run <slug> --task <task_id> --lease-token <token>
```

$$\text{IsLeaseValid}(T_j) \iff (\text{CurrentTime} - \text{LastHeartbeat}(T_j)) \le 90\text{s}$$

---

## 2. Anti-Theft Fencing Tokens

To prevent a rogue or delayed agent from overwriting work after its lease expired, the state mutator verifies the **Fencing Monotonic Counter**:

$$\text{FencingToken}(T_j) = \text{seq}_{\text{current}}$$

Any write operation presenting an older sequence $\text{seq} < \text{seq}_{\text{current}}$ is discarded immediately.

---

[⏮️ Previous: 07-01 Monotonic Lease Protocol & Tokens](07-01-monotonic-lease-protocol-and-tokens.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 07-03 Stale Worker & Zombie Auto-Recovery](07-03-stale-worker-and-zombie-auto-recovery.md)
---
