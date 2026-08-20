# 03. Bearer Token Protocol & Dispatch Security

[⬅ Previous: Role Briefs & Task Contracts](./02-immutable-role-packets.md) | [Master Table of Contents](../README.md) | [Next: Chapter 05 — Leases & Heartbeats ➡](../05-task-execution/01-leasing-and-heartbeats.md)

---

## 🔑 Why Bearer Tokens?

In a multi-agent environment, how does the harness prevent **Agent A** from submitting fake reports on behalf of **Agent B**, or prevent an expired worker from clobbering state after its lease has been revoked?

The harness enforces strict access control through a **One-Time Bearer Token Security Protocol**.

```text
[ `task:claim`, `queue:pop`, `task:validate-start`, `critic:start`, `branch:open`, `branch:claim` ]
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
2. **Digest-Only Persistence:** The harness **never** writes plaintext bearer tokens to disk, state files, event logs, git history, or documentation. Only the SHA-256 digest (`token_digest`) is stored — in `state.json`, in `events.jsonl`, and in the submission, review and critic reports under `reports/`, which record `token_digest` and never the token itself.
3. **Capability-Only Lifetime:** The token is valid only for the duration of the active lease attempt.
4. **Mandatory Protected Mutations:** `task:heartbeat`, `task:submit`, `task:release`, `task:probe`, `task:review`, `task:reject`, `critic:review`, `critic:reject`, `branch:open`, `branch:submit`, `branch:collect` and `branch:abandon` all **require** the plaintext `--token` flag. A token whose SHA-256 does not match the recorded digest — or that belongs to a different agent — is refused with `lease identity or token is invalid`.
5. **Three Token Families, Not One:** a _lease_ token proves you hold the write scope; a _validation_ token proves you own the current review; a _critic_ token proves you hold the completion authorisation. They are not interchangeable, and an agent holding one cannot act with another's authority. This is why a validator cannot `branch:open`: it never holds a lease token.

---

## 🚨 What Happens If a Token is Lost or Expires?

If an agent process crashes or loses its in-memory token:

- **No Regeneration:** The harness will **never** guess, recalculate, or reveal the token from its digest.
- **Voluntary Hand-Back:** if the token still exists, `task:release --token <token>` returns the task to `retry_ready` immediately (or `changes_requested` when the released attempt was a repair) instead of waiting out the clock.
- **Deadline Expiration:** otherwise the lease lapses and `recover --actor <you>` reclaims it.
- **Task Re-Queue:** the task transitions to `retry_ready` and holds no lease.
- **New Lease & Token:** a fresh `task:claim --role` issues a new lease and a brand-new token.
- **One Exception:** a `branched` parent is never reaped. Its lease clock is frozen because it is blocked on children, and `task:release` refuses it until the branch is collected or abandoned.

---

## 🛡️ Preventing Late Token Collisions

If an agent with an expired lease attempts to submit a report via `task:submit` after expiration or recovery, the submission is rejected, and its late payload is safely quarantined in `evidence/` without contaminating active task state.

---

[⬅ Previous: Role Briefs & Task Contracts](./02-immutable-role-packets.md) | [Master Table of Contents](../README.md) | [Next: Chapter 05 — Leases & Heartbeats ➡](../05-task-execution/01-leasing-and-heartbeats.md)
