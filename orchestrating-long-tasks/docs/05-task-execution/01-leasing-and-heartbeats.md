# 01. Leasing, Deadlines & Heartbeat Keepalive

[⬅ Previous: Bearer Token Security](../04-multi-agent/03-bearer-token-security.md) | [Master Table of Contents](../README.md) | [Next: Atomic Filesystem Scopes ➡](./02-atomic-filesystem-scopes.md)

---

## ⏱️ The Finite-Time Lease Contract

When an agent claims a task (`task:claim` or `queue:pop`), the harness does not grant an open-ended lock. Instead, it issues a **Time-Bounded Lease**. `task:claim` defaults to **1200 seconds / 20 minutes** and takes `--lease-seconds` (or `--lease-duration`) to override it, bounded to 5–86400 seconds. `branch:claim` is the one command that reads `default_lease_seconds` from `harness.config.json` (1800 seconds); a task lease does not, so setting that key does not lengthen a `task:claim` lease.

A lease defines:

- The assigned `agent_id` and role.
- The exact `write_scope` and `resource_scope`.
- An immutable `issued_at` timestamp.
- A rolling `expires_at` deadline.
- The `token_digest` (SHA-256 of the bearer token).

```text
[ Task Leased: expires_at = T + 1200s ]
                   │
                   ▼ (agent working...)
     ┌─────────────┼─────────────────────────────┬──────────────────────────┐
     │             │                             │                          │
(task:heartbeat)  (branch:open)            (task:release)          (no heartbeat)
     │             │                             │                          │
     ▼             ▼                             ▼                          ▼
[ deadline    [ clock SUSPENDED,          [ lease returned,        [ lease expires;
  moves        status = branched;          status = retry_ready      recover reclaims it ]
  forward ]    never reaped as stale ]     immediately ]
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
2. **Bounded Extension:** `--extend` is range-checked (60–86400 seconds), and the renewal the lease
   actually receives is its own recorded duration. The brief reports what was granted, never what was
   asked for.
3. **State Logging:** Records `heartbeat_at` in `state.json` and appends a `lease-heartbeat` event.

---

## ⏸️ Suspension: The Lease That Should Not Tick

A parent blocked on branch children stops heartbeating, which is indistinguishable from death to a
reaper. `branch:open` therefore **suspends** the lease: the expiry stops advancing and the task moves
to `branched`. A suspended lease still authenticates — that is how the parent proves ownership at
`branch:collect` — and `recover` never reaps it. See
[Chapter 09 §01](../09-branching-and-honesty/01-execution-time-branching.md).

---

## 🤝 Voluntary Release

```bash
bun harness.ts task:release \
  --run .capsules/<run-id> \
  --task <task-id> \
  --agent <worker-id> \
  --token <bearer-token>
```

The counterpart to recovery, for an agent that knows it cannot finish. The task returns to
`retry_ready` — or to `changes_requested` when the released attempt was a repair, so a repair lease
handed back does not lose the findings it was opened to close. A `branched` task cannot be released;
collect or abandon the branch first.

---

## 🔄 Automatic Stale Recovery

If an agent host crashes, runs out of memory, or disconnects without releasing its lease, recovery is
an explicit command rather than a silent side effect:

```bash
bun harness.ts recover --run .capsules/<run-id> --actor coordinator --grace-seconds 30
```

- Expired leases are revoked; the task returns to `retry_ready`, or `changes_requested` after a repair
  attempt.
- Interrupted validations are reopened.
- Branch sub-tasks whose sub-agent died are reclaimed.
- A stale completeness critic is expired.
- A **branched parent is never reaped** — its frozen lease means blocked on children, not gone.
- The attempt count increments, and the task is claimable again with `task:claim --role`.

---

[⬅ Previous: Bearer Token Security](../04-multi-agent/03-bearer-token-security.md) | [Master Table of Contents](../README.md) | [Next: Atomic Filesystem Scopes ➡](./02-atomic-filesystem-scopes.md)
