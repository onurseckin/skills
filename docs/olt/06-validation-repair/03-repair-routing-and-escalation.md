# 03. Bounded Repair Routing & Escalation

[⬅ Previous: Structured Finding Schema](./02-structured-finding-schema.md) | [Master Table of Contents](../README.md) | [Next: Chapter 07 — Gate Systems ➡](../07-gates-and-completion/01-mandatory-gate-systems.md)

---

## 🧭 Diátaxis Overview

| Quadrant         | Purpose in this Chapter                                                                                                                      |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explanation**  | Understand the mechanics of bounded repair loops, 1-hop in-lease micro-cycles, reassignment heuristics, and budget-exhaustion freezing.      |
| **How-To Guide** | Claiming repair leases, assigning replacement repairers, configuring budget limits, and dispatching parallel repair waves via `plan:replan`. |
| **Reference**    | State transition table, repair configuration limits, CLI command flags, and escalation error codes.                                          |
| **Tutorial**     | Complete walkthrough of handling a rejected task from repair claim through fresh validation to final pass.                                   |

---

## 🔁 1. Explanation: The Bounded Repair State Machine

When a task fails verification, it enters a deterministic repair cycle. Unlike open-ended agent loops that burn tokens infinitely on unsolvable problems, the `olt` repair loop is strictly bounded and audited:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BOUNDED REPAIR & ESCALATION ENGINE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                        ┌───────────────────────┐                            │
│                        │   changes_requested   │  (repair_round = N)        │
│                        └───────────┬───────────┘                            │
│                                    │ task:claim --role repairer             │
│                                    ▼                                        │
│                        ┌───────────────────────┐                            │
│                        │   repair (round N)    │──► fix, run:exec, submit   │
│                        └───────────┬───────────┘                            │
│                                    │ task:validate-start                    │
│                                    │ (MUST be a FRESH validator)            │
│                                    ▼                                        │
│                        ┌───────────────────────┐                            │
│                        │      validating       │──► task:probe              │
│                        └─────┬───────────┬─────┘                            │
│                              │           │                                  │
│            task:review pass  │           │  task:reject                     │
│            + --resolve every │           │                                  │
│            open finding      ▼           ▼                                  │
│                      ┌───────────┐   ┌───────────────────────┐              │
│                      │ validated │   │  repair (round N+1)   │              │
│                      └───────────┘   └───────────┬───────────┘              │
│                                                  │ repair_round >= 6        │
│                                                  ▼                          │
│                                      ┌───────────────────────┐              │
│                                      │       escalated       │ (FROZEN 🔒)  │
│                                      └───────────────────────┘              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Differences: Probes vs. Rejections

- **Adversarial Probe (`task:probe`)**: Keeps the task in `validating` status. Increments `probe_round`. Does **not** touch `repair_round`. Does not trigger implementer reassignment.
- **Defect Rejection (`task:reject`)**: Transitions the task to `changes_requested`. Increments `repair_round`. Revokes the active lease and triggers the repair lifecycle.

---

## ⚡ 2. Explanation: 1-Hop In-Lease Micro-Cycles vs. Full Repair

To eliminate the overhead of full lease revocation and graph re-dispatch for minor fixes, `task:reject` supports the `--in-lease` flag:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 1-HOP MICRO-CYCLE VS FORMAL REPAIR COMPARISON               │
├────────────────────────────┬────────────────────────────────────────────────┤
│ Feature                    │ 1-Hop Micro-Cycle (`--in-lease`)               │ Formal Repair Loop             │
├────────────────────────────┼────────────────────────────────────────────────┼────────────────────────────────┤
│ Target Scope               │ Minor AST/type fixes, edge-case guard clauses  │ Structural logic rewrites      │
│ Lease Retention            │ Active implementer retains lease               │ Active lease revoked           │
│ Implementer Context        │ Warm conversational memory preserved           │ Fresh worker assigned/onboarded│
│ Max Iteration Limit        │ Max 3 micro-cycles per validation round        │ Max 6 formal repair rounds     │
│ Transition on Limit Hit    │ Auto-escalates to formal repair loop           │ Freezes to `escalated` state   │
│ Validator Identity         │ Current validator stays assigned               │ Fresh validator REQUIRED       │
└────────────────────────────┴────────────────────────────────────────────────┴────────────────────────────────┘
```

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     MICRO-CYCLE CEILING ENFORCEMENT                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Validator emits `task:reject --in-lease`                                   │
│       │                                                                     │
│       ├── task.micro_cycles < 3 ──► task stays leased to implementer        │
│       │                             task.micro_cycles += 1                  │
│       │                                                                     │
│       └── task.micro_cycles >= 3 ─► REJECT --in-lease request               │
│                                     Harness forces full task:reject         │
│                                     task.repair_round += 1                  │
│                                     task status -> changes_requested        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ 3. Explanation: Formal Repair Leasing & Role Contracts

When a task enters `changes_requested`, it must be explicitly claimed by an agent operating under the `repairer` role:

```bash
bun harness.ts task:claim \
  --run .capsules/<run-id> \
  --task <task-id> \
  --agent <worker-id> \
  --role repairer
```

### The Repairer Contract (`olt/roles/repairer.md`)

The repairer role is strictly bounded:

1. **Focus on Open Findings**: The repairer's sole objective is closing the specific findings recorded in `state.tasks[id].findings`.
2. **Regression Test Mandate**: If the finding reports a behavioral defect, the repairer must first author a failing regression test before modifying application code.
3. **No Scope Expansion**: The repairer cannot touch files outside the task's original `write_scope`.
4. **No Self-Resolution**: The repairer cannot resolve findings in `state.json`. Only a subsequent independent validator can issue `--resolve`.

### Implementer Assignment Policy

1. **First Opportunity**: The task's `original_implementer` is granted the first repair opportunity.
2. **Reassignment Triggers**: If the original implementer fails, a replacement repairer is assigned by the coordinator using `task:assign-repairer` under one of three policies:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       REASSIGNMENT TRIGGER POLICIES                         │
├───────────────────────┬─────────────────────────────────────────────────────┤
│ Policy Reason         │ Precondition Invariant                              │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ `stale`               │ Prior repair attempt's lease expired without        │
│                       │ submission (`now() > lease.expires_at`).            │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ `repeated_failure`    │ At least 2 consecutive repair attempts failed       │
│                       │ validation (`repair_round >= 2`).                   │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ `unavailable`         │ Original implementer released lease voluntarily or  │
│                       │ host process terminated unexpectedly.               │
└───────────────────────┴─────────────────────────────────────────────────────┘
```

---

## 🔒 4. Explanation: Fresh Validator Invariant on Revalidation

When a repaired task is re-submitted, it enters `validating` again. The harness enforces that:

> **The revalidating agent must NEVER be an agent that implemented, repaired, or validated this task in any previous round.**

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      VALIDATOR ROTATION AUDIT MATRIX                        │
├───────────────────────────────────┬─────────────────────────────────────────┤
│ Agent History                     │ Eligibility for Round 2 Validation      │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ Original Implementer (`imp-1`)    │ ❌ Disqualified (Author)                │
│ Round 1 Validator (`val-1`)       │ ❌ Disqualified (Anchoring Bias)        │
│ Round 1 Repairer (`rep-1`)        │ ❌ Disqualified (Modifier)              │
│ Fresh Unrelated Agent (`val-2`)   │ ✅ Eligible                             │
└───────────────────────────────────┴─────────────────────────────────────────┘
```

### Multi-Domain Invalidation (B12.2)

If a task touches multiple domains (`code-quality`, `ui-design`, `system-design`):

- A rejection from any single domain immediately archives **all** open domain validations into `validation_history`.
- In the next round, each applicable domain must be re-validated by a **fresh independent validator**.

---

## 🧊 5. Explanation: Budget Exhaustion & Freezing (`escalated`)

The repair budget is defined in `harness.config.json`:

$$\text{repair\_round} < \text{max\_repair\_rounds} \quad (\text{default: } 6)$$

When `task:reject` is called on a task that has reached `max_repair_rounds`:

1. The harness transitions the task to `status: "escalated"`.
2. The task is **frozen** and removed from scheduling waves.
3. No further automated claims (`task:claim`) are permitted.
4. All command evidence, historical findings, and audit receipts are preserved intact.
5. The issue is surfaced to human operators or coordinators for manual triage:
   - Provide operator guidance and re-plan.
   - Adjust requirements via `plan:apply`.
   - Mark obligation infeasible.

---

## 🧯 6. Explanation: Parallel Repair at Scale (`plan:replan`)

When multiple tasks fail validation or a completeness critic issues a multi-finding rejection, repairing them sequentially creates coordination bottlenecks.

`plan:replan` analyzes all open findings, partitions them into **disjoint write scopes**, and synthesizes a parallel repair wave:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PLAN:REPLAN PARALLEL SYNTHESIS                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Open Findings Stream (findings.json) ]                                   │
│    • Finding 1: src/auth/token.ts  (auth scope)                             │
│    • Finding 2: src/db/schema.ts   (db scope)                               │
│    • Finding 3: src/ui/button.tsx  (ui scope)                               │
│                                  │                                          │
│                                  ▼ (plan:replan)                            │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Disjoint Scope Partitioning Engine                                    │  │
│  │ ├── Wave R-1: [ task-repair-auth ] ──► write_scope: ["src/auth"]      │  │
│  │ ├── Wave R-1: [ task-repair-db ]   ──► write_scope: ["src/db"]        │  │
│  │ └── Wave R-1: [ task-repair-ui ]   ──► write_scope: ["src/ui"]        │  │
│  └───────────────────────────────┬───────────────────────────────────────┘  │
│                                  │                                          │
│                                  ▼                                          │
│  [ Parallel Execution Wave Dispatched Concurrently ]                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Revalidation Gate Inheritance

Every generated repair task requires a verification gate:

- If a finding provides `revalidation` or `revalidation_gate`, it is attached to the generated repair task.
- Otherwise, the gate command is supplied via `--gate` to `plan:replan`.
- Tasks without a valid gate cannot be compiled into a repair wave.

---

## 📖 7. How-To Guide: Managing Repairs & Escalations

### Claiming a Task for Repair

```bash
bun harness.ts task:claim \
  --run .capsules/<run-id> \
  --task <task-id> \
  --agent <agent-id> \
  --role repairer
```

### Reassigning a Stale Repair Attempt

```bash
bun harness.ts task:assign-repairer \
  --run .capsules/<run-id> \
  --task <task-id> \
  --actor coordinator \
  --repairer <replacement-agent-id> \
  --reason stale \
  --evidence "Prior repair lease expired without submission"
```

### Re-dispatching Validation with a Fresh Validator

```bash
# Release prior validator
bun harness.ts agent:release \
  --run .capsules/<run-id> \
  --agent val-1 \
  --reason "round 1 complete"

# Register fresh validator
bun harness.ts agent:register \
  --run .capsules/<run-id> \
  --agent val-2 \
  --role validator \
  --host localhost \
  --parent-agent coordinator

# Start validation under fresh agent
bun harness.ts task:validate-start \
  --run .capsules/<run-id> \
  --task <task-id> \
  --validator val-2
```

### Synthesizing a Parallel Repair Wave

```bash
bun harness.ts plan:replan \
  --run .capsules/<run-id> \
  --actor coordinator \
  --findings-file open-defects.json \
  --gate "bun test" \
  --round 2
```

---

## 💻 8. Tutorial: End-to-End Repair & Escalation Walkthrough

### Scenario

`task-parser` failed validation in Round 1 due to regex backtracking on large inputs.

### 1. Implementer Re-claims Task as Repairer

```bash
bun harness.ts task:claim \
  --run .capsules/run-88 \
  --task task-parser \
  --agent imp-1 \
  --role repairer
```

### 2. Implementer Adds Regression Test & Fixes Code

Implementer adds a test with a 10MB input file (`tests/parser-perf.test.ts`), refactors `src/parser.ts` to use streaming lexing, runs tests locally, and submits:

```bash
bun harness.ts run:exec --run .capsules/run-88 --actor imp-1 --task task-parser -- \
  bun test tests/parser-perf.test.ts
```

```bash
bun harness.ts task:submit \
  --run .capsules/run-88 \
  --task task-parser \
  --agent imp-1 \
  --token IMP_TOKEN_88
```

### 3. Fresh Validator Assigned

Attempting to use `val-1` fails:

```bash
bun harness.ts task:validate-start \
  --run .capsules/run-88 \
  --task task-parser \
  --validator val-1
```

Output:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"validator must be independent from implementers and prior validators"}}
```

Fresh validator `val-2` is registered and claims validation:

```bash
bun harness.ts task:validate-start \
  --run .capsules/run-88 \
  --task task-parser \
  --validator val-2
```

Validation token `VAL_TOK_2291` is minted.

### 4. Fresh Validator Verifies and Resolves

Validator runs mandatory gate:

```bash
bun harness.ts run:exec --run .capsules/run-88 --actor val-2 --task task-parser -- \
  bun test tests/parser.test.ts
```

Receipt: `C-881920`.

Validator approves and resolves finding:

```bash
bun harness.ts task:review \
  --run .capsules/run-88 \
  --task task-parser \
  --validator val-2 \
  --token VAL_TOK_2291 \
  --status pass \
  --summary "Streaming lexer eliminates catastrophic backtracking. Verified on large inputs." \
  --checks C-881920 \
  --resolve "finding-task-parser-reject=C-881920"
```

The task completes Round 2 with status `validated`.

---

[⬅ Previous: Structured Finding Schema](./02-structured-finding-schema.md) | [Master Table of Contents](../README.md) | [Next: Chapter 07 — Gate Systems ➡](../07-gates-and-completion/01-mandatory-gate-systems.md)
