# 03. Bounded Repair Routing & 3-Round Escalation Policy

[⬅ Previous: Structured Finding Schema](./02-structured-finding-schema.md) | [Master Table of Contents](../README.md) | [Next: Chapter 07 — Gate Systems & Provenance ➡](../07-gates-and-completion/01-mandatory-gate-systems.md)

---

## 🔁 The Repair Feedback Loop

When a validator rejects a task, the task enters the `changes_requested` state. The harness routes the task into an automated, bounded **Repair Loop**:

```text
               ┌───────────────────────┐
               │   changes_requested   │
               └───────────┬───────────┘
                           │
                           ▼ (assign-repairer lease)
               ┌───────────────────────┐
               │    repair (Round 1)   │ ──> [ Implementer fixes code & re-submits ]
               └───────────┬───────────┘
                           │
                           ▼ (begin-validation)
               ┌───────────────────────┐
               │      validating       │
               └─────┬───────────┬─────┘
                     │           │
         ┌───────────┘           └───────────┐
         │ (Pass)                            │ (Reject)
         ▼                                   ▼
   ┌───────────┐                       ┌───────────────────────┐
   │ validated │                       │    repair (Round 2)   │
   └───────────┘                       └───────────┬───────────┘
                                                   │
                                                   ▼ (Reject Round 3)
                                       ┌───────────────────────┐
                                       │       escalated       │
                                       └───────────────────────┘
```

---

## 🧭 Step 1: Repairer Assignment (`assign-repairer`)

The coordinator leases the task back to the original implementer (or an assigned repairer agent):

```bash
bun orchestrating-long-tasks/scripts/harness.ts assign-repairer \
  --run .capsules/<run-id> \
  --task task-auth \
  --agent implementer-1 \
  --role repairer
```

### What the Repairer Receives:
The repairer receives the `repairer.md` role packet containing:
1. The leased write scope.
2. The exact list of open findings (`F-001`, `F-002`).
3. The observations, remediations, and `revalidation_command` for each finding.
4. Clean, unopinionated instruction to fix the defects and run the revalidation command.

---

## 🚨 Step 2: The 3-Round Hard Escalation Ceiling

In unbounded agent loops, an agent that cannot solve a problem will burn hundreds of thousands of tokens endlessly retrying the same flawed approach.

To protect time and compute budgets, the harness enforces a **Strict 3-Round Escalation Ceiling**:

$$\text{repair\_round} \le 3$$

- **Round 1:** First repair attempt after initial submission failure.
- **Round 2:** Second repair attempt.
- **Round 3:** Final automated attempt.
- **If Round 3 Fails Validation:** The task immediately transitions to **`escalated`**.

### What Happens in `escalated`:
1. The task is **frozen** and removed from the active scheduling queue.
2. No further automated retries or claims are permitted.
3. The coordinator emits an alert for human operator inspection.
4. The human developer can either:
   - Provide guidance and reset the repair counter via an audited decision, or
   - Update the plan via `plan-apply --expected-revision <N>`, or
   - Cancel the task if the requirement is deemed infeasible.

---

[⬅ Previous: Structured Finding Schema](./02-structured-finding-schema.md) | [Master Table of Contents](../README.md) | [Next: Chapter 07 — Gate Systems & Provenance ➡](../07-gates-and-completion/01-mandatory-gate-systems.md)
