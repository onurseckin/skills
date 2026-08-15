# 01. Leasing, Deadlines & Heartbeat Keepalive

[⬅ Previous: Bearer Token Security](../04-multi-agent/03-bearer-token-security.md) | [Master Table of Contents](../README.md) | [Next: Atomic Filesystem Scopes ➡](./02-atomic-filesystem-scopes.md)

---

## ⏱️ The Finite-Time Lease Contract

When an agent claims a task (`task:claim` or `queue:pop`), the harness does not grant an open-ended lock. Instead, it issues a **Time-Bounded Lease** (default 1800 seconds / 30 minutes, configurable via `harness.config.json` or CLI flags).

A lease defines:

- The assigned `agent_id` and role.
- The exact `write_scope` and `resource_scope`.
- An immutable `issued_at` timestamp.
- A rolling `expires_at` deadline.
- The `token_digest` (SHA-256 of the bearer token).

```text
[ Task Leased: expires_at = T + 1800s ]
                   │
                   ▼ (Agent working...)
     ┌─────────────┴─────────────┐
     │                           │
(Heartbeat called at T + 900s)   (No heartbeat; timer runs out)
     │                           │
     ▼                           ▼
[ Lease extended to T + 2700s ]  [ Lease Expires: Task becomes Stale ]
                                 [ Re-queued automatically as ready ]
```

---

## 💓 Heartbeats & Liveness Keepalive

If a long-running compile or complex test suite takes significant time, the agent must periodically send a **Heartbeat** to prevent its lease from expiring:

```bash
bun harness.ts task:heartbeat \
  --run .capsules/<run-id> \
  --task <task-id> \
  --agent <worker-id> \
  --token <bearer-token>
```

### Heartbeat Rules:

1. **Authenticated:** Must provide the valid bearer token matching `token_digest`.
2. **Cap on Extensions:** Extensions are bounded to prevent infinite zombie leases.
3. **State Logging:** Records `heartbeat_at` in `state.json` and appends an event to `events.jsonl`.

---

## 🔄 Automatic Stale Recovery

If an agent host crashes, runs out of memory, or disconnects without releasing its lease, the harness detects the expired timestamp during state checks:

- The dead worker's lease is revoked.
- The task transitions back to `ready`.
- The attempt count increments ($1 \to 2$).
- The task is made available for a fresh agent to claim via `queue:pop` or `task:claim`.

---

[⬅ Previous: Bearer Token Security](../04-multi-agent/03-bearer-token-security.md) | [Master Table of Contents](../README.md) | [Next: Atomic Filesystem Scopes ➡](./02-atomic-filesystem-scopes.md)
