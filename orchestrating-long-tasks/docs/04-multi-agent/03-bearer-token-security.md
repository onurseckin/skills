# 03. Bearer Token Protocol & Dispatch Security

[⬅ Previous: Immutable Role Packets](./02-immutable-role-packets.md) | [Master Table of Contents](../README.md) | [Next: Chapter 05 — Leases & Heartbeats ➡](../05-task-execution/01-leasing-and-heartbeats.md)

---

## 🔑 Why Bearer Tokens?

In a multi-agent environment, how does the harness prevent **Agent A** from submitting fake reports on behalf of **Agent B**, or prevent an expired worker from clobbering state after its lease has been revoked?

The harness enforces strict access control through a **One-Time Bearer Token Security Protocol**.

```text
[ Coordinator executes `claim` ]
            │
            ▼
┌────────────────────────────────────────────────────────┐
│  Returns Plaintext Token ONCE to Coordinator Process:  │
│  "B-LkQM_7JYP2KLKXjWz2NRTBJr2RgYiPzoVvC5us6co"        │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
[ Delivered via Host Channel ]     [ Stored in state.json & events.jsonl ]
(To Subagent Memory Only)          (ONLY SHA-256 Digest: "7688e3c79ba...")
```

---

## 🔒 The Token Invariants

1. **Returned Once via Process Stdout:** The plaintext token is generated using cryptographically secure random bytes (`randomBytes(32).toString("base64url")`) and returned exactly once to the coordinator CLI caller.
2. **Digest-Only Persistence:** The harness **never** writes plaintext bearer tokens to disk, state files, event logs, packets, git history, or handoff documents. Only the SHA-256 digest (`token_digest`) is stored.
3. **Capability-Only Lifetime:** The token is valid only for the duration of the leased attempt.
4. **Mandatory Protected Mutations:** The CLI subcommands `heartbeat`, `submit`, `review`, and `release` **require** the plaintext `--token` flag. If the provided token's SHA-256 hash does not match `lease.token_digest`, the mutation is rejected with `UNAUTHORIZED`.

---

## 🚨 What Happens If a Token is Lost?

If an agent process crashes or loses its in-memory token:
- **No Regeneration:** The harness will **never** guess, recalculate, or reveal the token from its digest.
- **Deadline Wait:** The coordinator waits for the lease duration (or validation deadline) to pass.
- **Stale Recovery:** The coordinator runs:
  ```bash
  bun orchestrating-long-tasks/scripts/harness.ts recover --run .capsules/<run-id> --actor coordinator --grace-seconds 0
  ```
- **New Lease & Token:** The task transitions to `retry_ready`, a fresh `claim` is issued to an agent, and a brand-new token is generated!

---

## 🛡️ Preventing Late Token Collisions

If an agent with an expired lease attempts to submit a report after recovery has completed, the submission is rejected, and its late payload is safely quarantined in `evidence/` as **Orphan Evidence** without contaminating active task state.

---

[⬅ Previous: Immutable Role Packets](./02-immutable-role-packets.md) | [Master Table of Contents](../README.md) | [Next: Chapter 05 — Leases & Heartbeats ➡](../05-task-execution/01-leasing-and-heartbeats.md)
