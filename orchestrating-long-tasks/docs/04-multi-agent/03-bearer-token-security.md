# 03. Bearer Token Protocol & Dispatch Security

[⬅ Previous: Role Briefs & Task Contracts](./02-immutable-role-packets.md) | [Master Table of Contents](../README.md) | [Next: Chapter 05 — Leases & Heartbeats ➡](../05-task-execution/01-leasing-and-heartbeats.md)

---

## 🔑 Why Bearer Tokens?

In a multi-agent environment, how does the harness prevent **Agent A** from submitting fake reports on behalf of **Agent B**, or prevent an expired worker from clobbering state after its lease has been revoked?

The harness enforces strict access control through a **One-Time Bearer Token Security Protocol**.

```text
[ Coordinator executes `task:claim` or `queue:pop` ]
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│  Returns Plaintext Token ONCE to Process Stdout:       │
│  "DL1UOpoktcMRt_AhFJ0gwclQ56FLvxmhZPQV9Zdxa6o"         │
└───────────────────────┬────────────────────────────────┘
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
[ Delivered via Host Channel ]   [ Stored in state.json & events.jsonl ]
(To Subagent Memory Only)        (ONLY SHA-256 Digest: "7688e3c79ba...")
```

---

## 🔒 The Token Invariants

1. **Returned Once via Process Stdout:** The plaintext token is generated using cryptographically secure random bytes (`randomBytes(32).toString("base64url")`) and emitted once in the command markdown brief.
2. **Digest-Only Persistence:** The harness **never** writes plaintext bearer tokens to disk, state files, event logs, git history, or documentation. Only the SHA-256 digest (`token_digest`) is stored.
3. **Capability-Only Lifetime:** The token is valid only for the duration of the active lease attempt.
4. **Mandatory Protected Mutations:** The CLI subcommands `task:heartbeat`, `task:submit`, `task:review`, `task:reject`, and `critic:review` **require** the plaintext `--token` flag. If the provided token's SHA-256 hash does not match `lease.token_digest`, the mutation is rejected with `UNAUTHORIZED`.

---

## 🚨 What Happens If a Token is Lost or Expires?

If an agent process crashes or loses its in-memory token:

- **No Regeneration:** The harness will **never** guess, recalculate, or reveal the token from its digest.
- **Deadline Expiration:** The coordinator waits for the lease duration to lapse.
- **Task Re-Queue:** Once expired, the task transitions back to `ready` (or `retry_ready`).
- **New Lease & Token:** A new claim via `queue:pop` or `task:claim` issues a fresh lease and brand-new token.

---

## 🛡️ Preventing Late Token Collisions

If an agent with an expired lease attempts to submit a report via `task:submit` after expiration or recovery, the submission is rejected, and its late payload is safely quarantined in `evidence/` without contaminating active task state.

---

[⬅ Previous: Role Briefs & Task Contracts](./02-immutable-role-packets.md) | [Master Table of Contents](../README.md) | [Next: Chapter 05 — Leases & Heartbeats ➡](../05-task-execution/01-leasing-and-heartbeats.md)
