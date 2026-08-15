# 03. Authority Decisions & External Gate Lifecycle

[⬅ Previous: Line Disposition Algorithm](./02-line-disposition-algorithm.md) | [Master Table of Contents](../README.md) | [Next: Chapter 03 — Dependency Graph Theory ➡](../03-graph-scheduler/01-dependency-graph-theory.md)

---

## 🛑 What is a `needs_authority` Requirement?

In real-world engineering, certain user instructions cannot be executed autonomously without human confirmation. Common examples include:

- _"Drop the legacy SQLite tables and migrate to Postgres after my approval."_
- _"Deploy the container to production if all tests pass."_
- _"Delete all orphaned S3 buckets."_

If an AI agent blindly executes destructive or external mutations, it causes catastrophic data loss. If an agent simply ignores the instruction, it fails the prompt.

The harness solves this with **`needs_authority` Requirements**.

---

## 🔄 The Authority Decision Lifecycle

When a requirement is flagged as `needs_authority`, the harness pauses all tasks that depend exclusively on that requirement until an explicit, audited decision is recorded.

```text
                     ┌───────────────────────────┐
                     │ planned: needs_authority  │
                     └─────────────┬─────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │ (User Decision in Terminal) │
                    ▼                             ▼
          ┌───────────────────┐         ┌───────────────────┐
          │  decide: 'grant'  │         │ 'decline'         │
          └─────────┬─────────┘         └─────────┬─────────┘
                    │                             │
                    ▼                             ▼
          ┌───────────────────┐         ┌───────────────────┐
          │    actionable     │         │   out_of_scope    │
          │ (Task is Ready to │         │ (Task is Cleanly  │
          │    be Claimed)    │         │    Cancelled)     │
          └───────────────────┘         └───────────────────┘
```

---

## ⚡ The `decide-authority` CLI Command

The coordinator records the user's decision using the pinned CLI:

```bash
bun orchestrating-long-tasks/scripts/harness.ts decide-authority \
  --run .capsules/<run-id> \
  --requirement R-PUBLISH \
  --decision grant \
  --rationale "User confirmed the production deployment window is open." \
  --actor coordinator
```

### What Happens Internally:

1. An immutable event `authority_decided` is appended to `events.jsonl`.
2. The requirement gains `authority_status: "granted"` (or `"declined"`).
3. The requirement's resulting disposition becomes `actionable` (for `grant`) or `out_of_scope` (for `decline`).
4. An immutable audit record is stored with a SHA-256 digest:
   ```json
   {
     "decision_id": "authority-7f41a8",
     "requirement_id": "R-PUBLISH",
     "decision": "grant",
     "actor": "coordinator",
     "rationale": "User confirmed the production deployment window is open.",
     "decided_at": "2026-08-14T23:17:00.000Z",
     "prior_disposition": "needs_authority",
     "resulting_disposition": "actionable",
     "decision_sha256": "4b68e920c8..."
   }
   ```

---

## 🚫 Handling Declines Cleanly (Without Fabricating Tests)

When a user declines an authority-gated requirement:

- The requirement is marked `out_of_scope`.
- Any task in `graph.json` mapped **solely** to that declined requirement transitions directly to `cancelled`.
- Any mandatory task gates associated solely with the declined requirement are marked **not applicable**.
- **No fake unit tests or simulated proofs are needed.** The run can reach terminal completion cleanly because the decline is an audited, first-class mathematical disposition.

### Mixed Tasks:

If a task covers both an actionable requirement (`R-LOCAL`) and a declined requirement (`R-PUBLISH`), the task remains executable for `R-LOCAL`, and only the gates for `R-PUBLISH` are deactivated.

---

[⬅ Previous: Line Disposition Algorithm](./02-line-disposition-algorithm.md) | [Master Table of Contents](../README.md) | [Next: Chapter 03 — Dependency Graph Theory ➡](../03-graph-scheduler/01-dependency-graph-theory.md)
