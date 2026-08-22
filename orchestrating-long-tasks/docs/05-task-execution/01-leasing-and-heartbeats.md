# 01. Leasing, Deadlines & Heartbeat Keepalive

> [!IMPORTANT]
> **HUMAN DEVELOPER REFERENCE ONLY**: This documentation is written for human engineers maintaining and evolving the skill. Autonomous LLM runtime subagents MUST NOT ingest these files directly into context; all operational directives, topology graphs, and task assignments MUST be queried exclusively through the Harness CLI.

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
2. **Fixed-Duration Renewal:** Every heartbeat moves the deadline forward by the lease's own
   recorded duration — the one set at `task:claim` — and by nothing else. There is no flag to
   request a different renewal length per beat; if the work needs more time per heartbeat, claim
   with a longer `--lease-duration` up front instead.
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

## 🧾 A Rejected Plan Blocks Every Claim

Leasing is not the only gate `task:claim` checks. Before it looks at the task's own status at all, it
checks the run's `plan_review` record — the verdict left by the **plan-validator**, an adversary
scoped to the whole compiled plan rather than to one task (see Chapter 03 for how that role reviews a
plan and records its verdict). If a plan-validator recorded `changes_requested` against the graph
revision the run is **currently** on, `task:claim` refuses outright, for every implementer and every
repairer, regardless of which task is being claimed:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_STATE",
    "message": "plan validation rejected this graph revision; replan and record a passing plan:review before any implementer or repairer can claim work"
  }
}
```

Two things make this check narrow rather than a general-purpose plan gate:

- It only ever fires on an **explicit, recorded `changes_requested` verdict against the exact graph
  revision** a claim would work under. A run that never dispatched a plan-validator at all — which is
  most runs, since the role is optional — sees no block here; that silence is not this check's job to
  police.
- A superseding graph revision lifts the block on its own — nothing needs to be cleared by hand once
  the live `graph_revision` no longer matches the one the rejection named. The only command that
  actually raises `graph_revision` past 1 is `plan:replan` (§03 of this chapter covers it for
  task-level repair waves) — `plan:compile` bakes a hardcoded first-revision number into every graph it
  builds, so a second call to it fails its own revision-must-increase-by-one check rather than
  producing an escape hatch. `plan:replan` does not read a plan-validator's `changes_requested`
  findings automatically, though — recovering from one today means the coordinator passes that
  review's findings back in by hand via `--findings-file`. See
  [Chapter 03 §03](../03-graph-scheduler/03-plan-revision-and-freezing.md) for the full account of the
  plan-validator role and exactly what raising a fresh revision over its rejection requires.

This is a documented asymmetry, not an oversight: a plan can be **compiled** without any validator ever
reviewing it (most runs work this way), but once one _has_ reviewed it and rejected it, no further work
proceeds on that revision. The plan-validator's pushback is a hard stop a coordinator cannot route
around by dispatching a different task.

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
