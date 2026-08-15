# 03. Bounded Repair Routing & Configurable Repair Limits

[⬅ Previous: Structured Finding Schema](./02-structured-finding-schema.md) | [Master Table of Contents](../README.md) | [Next: Chapter 07 — Gate Systems & Provenance ➡](../07-gates-and-completion/01-mandatory-gate-systems.md)

---

## 🔁 The Repair Feedback Loop

When a validator rejects a task via `task:reject`, the task enters the `changes_requested` state. The harness routes the task into an automated, bounded **Repair Loop**:

```text
               ┌───────────────────────┐
               │   changes_requested   │
               └───────────┬───────────┘
                           │
                           ▼ (task:claim repair lease)
               ┌───────────────────────┐
               │    repair (Round 1)   │ ──> [ Implementer fixes code & task:submit ]
               └───────────┬───────────┘
                           │
                           ▼ (task:validate-start)
               ┌───────────────────────┐
               │      validating       │
               └─────┬───────────┬─────┘
                     │           │
         ┌───────────┘           └───────────┐
         │ (task:review pass)                │ (task:reject)
         ▼                                   ▼
   ┌───────────┐                       ┌───────────────────────┐
   │ validated │                       │    repair (Round 2)   │
   └───────────┘                       └───────────┬───────────┘
                                                   │
                                                   ▼ (Exceeds max_repair_rounds)
                                       ┌───────────────────────┐
                                       │       escalated       │
                                       └───────────────────────┘
```

---

## 🧭 Step 1: Repair Lease & Re-Submission

The coordinator leases the task back to the implementer via `task:claim`:

```bash
bun harness.ts task:claim \
  --run .capsules/<run-id> \
  --task <task-id> \
  --agent <worker-id>
```

### What the Repairer Receives:

The repair brief highlights:

1. The leased write scope.
2. The exact list of open findings and validator remediation instructions.
3. Instructions to implement the fix, verify locally, and execute `task:submit`.

---

## 🚨 Step 2: Configurable Repair Limits (`harness.config.json`)

In unbounded agent loops, an agent that cannot solve a problem will burn hundreds of thousands of tokens endlessly retrying the same flawed approach.

To protect time and compute budgets, the harness enforces a **Configurable Repair Limit** (default `5` rounds, defined in `harness.config.json`):

```json
{
  "max_repair_rounds": 5,
  "max_output_bytes": 10485760,
  "default_lease_seconds": 1800,
  "default_max_parallel": 4,
  "strict_validation": true
}
```

$$\text{repair\_round} \le \text{max\_repair\_rounds}$$

- **Rounds 1–5:** Automated repair attempts.
- **If Maximum Rounds are Exceeded:** The task immediately transitions to **`escalated`**.

### What Happens in `escalated`:

1. The task is **frozen** and removed from the active scheduling queue.
2. No further automated retries or claims are permitted.
3. The coordinator emits an escalation alert for human operator inspection.
4. The human developer can either:
   - Provide guidance and reset the repair counter, or
   - Update the plan via `plan:add` and `plan:compile`, or
   - Cancel the task if the requirement is deemed infeasible.

---

[⬅ Previous: Structured Finding Schema](./02-structured-finding-schema.md) | [Master Table of Contents](../README.md) | [Next: Chapter 07 — Gate Systems & Provenance ➡](../07-gates-and-completion/01-mandatory-gate-systems.md)
