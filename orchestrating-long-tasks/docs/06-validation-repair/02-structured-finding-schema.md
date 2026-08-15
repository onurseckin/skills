# 02. Structured Finding Schema & Evidence Requirements

[⬅ Previous: Adversarial Validation Philosophy](./01-adversarial-validation-philosophy.md) | [Master Table of Contents](../README.md) | [Next: Repair Routing & Escalation ➡](./03-repair-routing-and-escalation.md)

---

## 🛑 Why Vague Feedback Fails

When human reviewers or AI reviewers leave vague feedback like _"This code looks buggy, please fix error handling"_, repair workers waste cycles guessing what was wrong:

- Which function failed?
- What input caused the crash?
- What command reproduces the error?
- How will the fix be proven?

In `orchestrating-long-tasks`, a rejection is invalid unless it produces **Structured Findings** conforming to the `harness.finding` schema.

---

## 📋 The Anatomy of a Finding (`F-001`)

Every finding recorded in `.capsules/<run-id>/findings/<finding-id>/finding.json` contains five mandatory sections:

```json
{
  "schema": "harness.finding",
  "version": 1,
  "id": "F-001",
  "task_id": "task-auth",
  "requirement_id": "R-SESSION",
  "validator_id": "validator-1",
  "status": "open",
  "severity": "high",
  "observation": "Session token does not expire after 3600 seconds of inactivity.",
  "evidence": [
    {
      "command_id": "C-9891ea11-cb91-4f3b-845d-c0c615d49ee7",
      "excerpt": "Expected session.isExpired() to be true, received false"
    }
  ],
  "remediation": "Update `src/auth/session.ts` line 42 to calculate expiration against `lastActivity` instead of `createdAt`.",
  "revalidation_command": {
    "argv": ["bun", "test", "tests/auth/timeout.test.ts"],
    "cwd": "."
  },
  "created_at": "2026-08-14T23:25:00.000Z"
}
```

---

## 🔍 The 5 Mandatory Finding Fields Explained

| Field                      | Purpose                                                                          | Schema Requirement                                     |
| :------------------------- | :------------------------------------------------------------------------------- | :----------------------------------------------------- |
| **`observation`**          | Exactly what observed behavior violated which acceptance criterion.              | Non-empty descriptive string.                          |
| **`evidence`**             | Concrete command records (`C-xxx`), logs, or error excerpts proving the failure. | Non-empty array of objects referencing valid commands. |
| **`remediation`**          | Actionable instructions on what code needs to change to resolve the defect.      | Non-empty instructions string.                         |
| **`revalidation_command`** | The exact literal argv command that must succeed to prove resolution.            | Literal argv object (no shell string).                 |
| **`severity`**             | Criticality of defect (`blocker`, `high`, `medium`, `low`).                      | Closed enum.                                           |

---

## 🔒 Finding Invariants

1. **No Phantom Rejections:** A validator cannot issue a `reject` review with an empty findings array. Rejection strictly requires at least one structured finding.
2. **Immutable Traceability:** Findings are permanently recorded in `events.jsonl`.
3. **Mechanical Proof for Resolution:** A finding cannot be marked `resolved` by implementer prose. The repairer must submit a passing command record matching the finding's `revalidation_command`!

---

[⬅ Previous: Adversarial Validation Philosophy](./01-adversarial-validation-philosophy.md) | [Master Table of Contents](../README.md) | [Next: Repair Routing & Escalation ➡](./03-repair-routing-and-escalation.md)
