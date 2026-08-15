# 01. Leasing, Deadlines & Heartbeat Keepalive

[⬅ Previous: Bearer Token Security](../04-multi-agent/03-bearer-token-security.md) | [Master Table of Contents](../README.md) | [Next: Atomic Filesystem Scopes ➡](./02-atomic-filesystem-scopes.md)

---

## ⏱️ The Finite-Time Lease Contract

When an agent claims a task (`claim`), the harness does not grant an open-ended lock. Instead, it issues a **Time-Bounded Lease** (default 1200 seconds / 20 minutes).

A lease defines:
- The assigned `agent_id` and `role`.
- The exact `write_scope` and `resource_scope`.
- An immutable `issued_at` timestamp.
- A rolling `expires_at` deadline.
- The `token_digest` (SHA-256 of the bearer token).

```text
[ Task Leased: expires_at = T + 1200s ]
                   │
                   ▼ (Agent working...)
     ┌─────────────┴─────────────┐
     │                           │
(Heartbeat called at T + 600s)   (No heartbeat; timer runs out)
     │                           │
     ▼                           ▼
[ Lease extended to T + 1800s ]  [ Lease Expires: Task becomes Stale ]
                                 [ Stale Recovery marks task 'retry_ready' ]
```

---

## 💓 Heartbeats & Liveness Keepalive

If a long-running compile or complex test suite takes significant time, the agent must periodically send a **Heartbeat** to prevent its lease from expiring:

```bash
bun orchestrating-long-tasks/scripts/harness.ts heartbeat \
  --run .capsules/<run-id> \
  --task task-1 \
  --agent implementer-1 \
  --token <bearer-token> \
  --extend-seconds 600
```

### Heartbeat Rules:
1. **Authenticated:** Must provide the valid bearer token matching `token_digest`.
2. **Cap on Extensions:** Extensions are bounded to prevent infinite zombie leases.
3. **State Logging:** Records `heartbeat_at` in `state.json` and logs a keepalive event.

---

## 🔄 Automatic Stale Recovery

If an agent host crashes, runs out of memory, or disconnects without releasing its lease, the coordinator watchdog detects the expired timestamp during `status` or `recover`:
- The dead worker's lease is revoked.
- The task transitions to `retry_ready`.
- The attempt count increments ($1 \to 2$).
- The task is made available for a fresh agent to claim.

---

[⬅ Previous: Bearer Token Security](../04-multi-agent/03-bearer-token-security.md) | [Master Table of Contents](../README.md) | [Next: Atomic Filesystem Scopes ➡](./02-atomic-filesystem-scopes.md)
