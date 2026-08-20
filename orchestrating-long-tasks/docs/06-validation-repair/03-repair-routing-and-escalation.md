# 03. Bounded Repair Routing & Escalation

[⬅ Previous: Structured Finding Schema](./02-structured-finding-schema.md) | [Master Table of Contents](../README.md) | [Next: Chapter 07 — Gate Systems ➡](../07-gates-and-completion/01-mandatory-gate-systems.md)

---

## 🔁 The Repair Loop

A **rejection** — not a probe — moves the task to `changes_requested` and starts a bounded repair
round. A probe leaves the task `validating` and never enters this loop at all.

```text
               ┌───────────────────────┐
               │   changes_requested   │  repair_round = N
               └───────────┬───────────┘
                           │ task:claim --role repairer  (the recorded repair assignee)
                           ▼
               ┌───────────────────────┐
               │   repair (round N)    │──> fix, run:exec, task:submit
               └───────────┬───────────┘
                           │ task:validate-start  ← MUST be a FRESH validator
                           ▼
               ┌───────────────────────┐
               │      validating       │──> task:probe (probe_round +1, budget untouched)
               └─────┬───────────┬─────┘
                     │           │
   task:review pass  │           │  task:reject
   + --resolve every │           │
   open finding      ▼           ▼
             ┌───────────┐   ┌───────────────────────┐
             │ validated │   │  repair (round N+1)   │
             └───────────┘   └───────────┬───────────┘
                                         │ repair_round reaches max_repair_rounds (6)
                                         ▼
                             ┌───────────────────────┐
                             │       escalated       │
                             └───────────────────────┘
```

---

## 🧭 Step 1: The Repair Lease

```bash
bun harness.ts task:claim \
  --run .capsules/<run-id> \
  --task <task-id> \
  --agent <worker-id> \
  --role repairer
```

`--role repairer` is not decoration. It binds the agent to
`orchestrating-long-tasks/roles/repairer.md`, whose contract is narrower than an implementer's: close
the open findings, add a failing regression test first where the finding is behavioural, do not
redesign unrelated code, do not widen the scope, and do not mark anything resolved — only a fresh
independent validator can do that.

**The original implementer gets the first repair opportunity.** A replacement is assigned only through
the recorded stale / unavailable / repeated-failure policy, and that assignment is the harness's
decision, recorded with its reason, not an agent's choice:

```bash
bun harness.ts task:assign-repairer --run .capsules/<run-id> --task <task-id> --actor coordinator \
  --repairer <replacement-agent-id> --reason unavailable \
  --evidence "worker-1 released without claiming the repair lease"
```

`--reason stale` requires the prior repair attempt's own lease to have gone stale; `repeated_failure`
requires at least two recorded repair rounds; `unavailable` carries no precondition beyond the task
already awaiting its original repairer. The replacement can never equal the original implementer.

---

## 🔎 Step 2: Revalidation Needs a New Validator

This trips people. `task:validate-start` refuses a validator that already validated this task, so a
round-two review requires a different agent id:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"validator must be independent from implementers"}}
```

```bash
bun harness.ts agent:release  --run .capsules/<run-id> --agent val-1 --reason "round 1 verdict recorded"
bun harness.ts agent:register --run .capsules/<run-id> --agent val-2 --role validator \
  --host <host> --parent-agent coordinator-1 --parent-task <task-id>
bun harness.ts task:validate-start --run .capsules/<run-id> --task <task-id> --validator val-2
```

The new validator still owes the mandatory probe, and the pass still has to `--resolve` **every** open
finding — including the defect finding the previous round opened.

---

## 🚨 Step 3: The Bounded Budget

```json
{
  "min_adversarial_probes": 1,
  "max_repair_rounds": 6,
  "max_branch_depth": 5,
  "max_agents": 100,
  "max_output_bytes": 10485760,
  "default_lease_seconds": 1800,
  "default_max_parallel": 4
}
```

$$\text{repair\_round} < \text{max\_repair\_rounds}$$

- **`repair_round`** counts recorded rejections. It starts at 0 and increments on `task:reject`.
- **`probe_round`** is a separate counter. A probe never touches the repair budget and never triggers a
  replacement repairer.
- On the round where `repair_round` reaches `max_repair_rounds` (default **6**), the rejection
  transitions the task to `escalated` instead of `changes_requested`.

An unbounded loop is how an agent that cannot solve a problem burns hundreds of thousands of tokens
retrying the same flawed approach. The bound turns that into a decision.

---

## 🧊 What `escalated` Means

1. The task is frozen and no longer scheduled — `escalated` is excluded from active ownership, so it
   neither occupies its write scope nor appears in a wave.
2. No further automated claims are permitted.
3. All findings, validation history and command evidence are preserved intact. Escalation loses
   nothing; that is the point of stopping rather than retrying.
4. A human decides: give guidance and re-plan, raise a revision with `plan:add` + `plan:compile`, or
   drop the obligation as infeasible.

---

## 🧯 Repair at Scale: `plan:replan`

When a validator or critic returns many findings at once, repairing them one task at a time is the
same waterfall `queue:pop` creates. `plan:replan` ingests the findings, partitions them into
**disjoint write scopes**, and compiles the next revision so the repair wave itself runs in parallel:

```bash
bun harness.ts plan:replan --run .capsules/<run-id> --actor coordinator \
  --findings-file findings.json --gate "bun run typecheck" --round 2
```

`--gate` supplies the revalidation command for the generated repair tasks. It may be omitted only when
the findings declare their own `revalidation_gate`, or when the planned task covering that scope has a
gate to inherit. There is no default, because a repair task without a gate cannot be proved.

---

[⬅ Previous: Structured Finding Schema](./02-structured-finding-schema.md) | [Master Table of Contents](../README.md) | [Next: Chapter 07 — Gate Systems ➡](../07-gates-and-completion/01-mandatory-gate-systems.md)
