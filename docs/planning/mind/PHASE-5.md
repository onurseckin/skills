# PHASE 5 — audit and economics

## 1. Goal

Make the mind checkable by something it does not control, and make its cost bounded by refusals
rather than by intentions.

Failure mode 6 says: if the plan generates the requirements, "every requirement is covered" proves
nothing. One level up: **if the mind generates its own objectives and grades its own outcomes,
"the system is healthy" proves nothing.** This phase is the answer.

## 2. Preconditions

Phases 0–4 complete, and at least one real objective driven end to end with the four pass-bar
properties recorded in `PHASE-4.md` §5.

## 3. Work items

---

### W5.1 — The `mind-auditor` role

**Files:** `roles/mind-auditor.md`, `contracts/packets.ts` (union + array, per D6),
`references/protocol.md`.

Tier 1, dispatched by the mind but structurally independent — a completeness critic for the
mind, one level up. Contract per `PLAN.md` §12.2:

```yaml
role: mind-auditor
tier: 1
may:
  - Read the pulse ledger, the candidate ledger, every capsule, and the repository
  - Run its own independent commands against the repository
  - Re-run the admission test against candidates that were already admitted
  - Record findings that block, or approve with an explicit residual-risk list
  - Halt the mind
must_not:
  - Read the mind's own narrative, rationale prose, or self-assessment
  - Audit a period in which it acted as orchestrator, coordinator, implementer or validator
  - Approve while any pulse in the window is unaccounted for
  - Edit any repository file, the charter, or any ledger
spawns: []
```

The first `must_not` is the important one. An auditor that reads the mind's own account of itself is
auditing a story. It reads the ledger and the repository, and nothing the mind wrote _about_ what it
did.

**Acceptance:** the role-parity test passes; a test that the auditor contract grants no write
command; a test that an auditor agent that also holds a grant in the audited window is refused.

---

### W5.2 — `mind:audit-start` / `mind:audit-report`

**Files:** `cli/commands/mind-audit.ts` (new).

The questionnaire is **fixed**, and every answer must cite a command id:

1. Does every pulse in the window have exactly one open and one close? Name the gaps.
2. Does every admitted candidate still have a witness whose command output shows the defect?
3. Did any admitted candidate cite a charter goal that does not exist?
4. Is the trailing value series consistent with the work the ledger claims?
5. Did anything change outside a declared write scope?
6. Did any pulse take an action on the never-unattended list?
7. What did the mind _decline_ to do, and does the reason survive re-reading?
8. Did the charter digest change without an owner decision?

`mind:audit-report` refuses any answer lacking a command id. The verdict is consumed by the **next**
pulse, which **cannot proceed past WAKE while an audit finding is open**. A `halt` verdict stops the
mind.

Cadence from the charter, suggested every 24 hours or every 50 pulses, whichever comes first.

**Acceptance:** an answer without a command id is refused; an audit with a gap in question 1 cannot
return `approved`; a `halt` verdict blocks the next `mind:pulse-open`.

---

### W5.3 — Value accounting and the throttle

**Files:** `mind/value.ts`, `mind/interval.ts`.

Value is defined mechanically so it cannot be talked up (`PLAN.md` §11.2):

```
value(pulse) = leases_reclaimed + findings_resolved + gates_flipped_red_to_green
             + tasks_reaching_done + candidates_admitted + proposals_recorded(≤1)
```

Every term is a count **the harness measured**. Explicitly not counted: files touched, commands run,
tokens spent, agents deployed, words written.

The throttle borrows `nextBackoffDelayMs`'s exact shape — exponential, capped, jittered:
`value > 0` resets to base; K consecutive zeroes give `min(max_interval, base × 1.5^K)`; jitter is
mandatory, for the same reason `CronCreate` adds it — many machines choosing the same minute is a
self-inflicted thundering herd.

Report the **trailing value series** in the digest rather than a summary of it:

> A long flat zero is either a healthy repository or a broken mind, and only a human can tell which.

**Acceptance:** a test that no excluded metric appears in the value computation; the backoff table
including cap, reset and jitter bounds; a test that the digest renders the raw series.

---

### W5.4 — Budget refusals

**Files:** `mind/budget.ts`.

Every key in `CONTRACTS.md` §1.3's budget block is enforced as a **refusal**, not a warning.

> A budget that logs a warning and proceeds is not a budget.

**Acceptance:** one negative test per budget key, asserting the refusal, the outcome it prescribes
(`deferred`, `paused`) and an unchanged `event_sequence`.

---

### W5.5 — The owner digest

**Files:** `mind/digest.ts`.

Periodic, human-readable, built on `formatMorningReportMarkdown`'s existing shape. It must contain
the section nothing else contains:

> **"What I would have done without asking"** — every declined candidate and every open proposal,
> with its reason.

That section is where a human notices the mind drifting, long before any metric does.

**Acceptance:** a golden-file test; a test that the section is present and explicitly says so when
empty; a test that every claim in the digest carries a command id.

---

### W5.6 — The counterfactual re-admission test

**Files:** `mind/counterfactual.ts` (new).

Cheap and unusually effective: periodically take a **previously admitted** candidate and re-run the
admission test with a fresh agent that has no memory of the adoption. If it would not be admitted
now, that is a finding — either the defect was already fixed, or it was never real.

This directly attacks the failure where a system rationalises work it has already started.

**Acceptance:** a fixture whose defect has since been fixed produces a finding; one whose defect
persists does not; the re-admitting agent receives no context from the original admission.

---

## 4. Check and balance

### 4.1 The planted-ledger suite — this phase's main deliverable

Run the auditor against a **deliberately falsified** ledger and require it to catch every plant:

- a pulse with an open and no close
- an admitted candidate whose witness command exits 0
- a candidate citing a goal that is not in the charter
- a value series claiming work the ledger does not contain
- a file changed outside every declared write scope
- a charter digest changed with no owner decision

**An auditor that has never caught a planted defect has not been tested.** This is `gate:prove`'s
logic applied to the auditor itself, and it is non-negotiable.

### 4.2 Independence — the strictest rule in the plan

**The auditor's tests are written by a different agent than the one that wrote the auditor**
(`PLAN.md` §13.7). The auditor is the check on the checker; if the same agent writes both sides, the
top-level check is self-certified and the whole tower rests on nothing.

The risk this guards against has a precedent in this repository: 29 of 29 validations passed on a run
where nothing had been built. A rubber stamp is not a rare pathology; it is the default outcome of an
unchecked checker.

### 4.3 What is deliberately not a validation

- The mind's own summary of its night — `agent_reported`, and it is the thing being checked.
- Pulse count, agents deployed, commands run, tokens spent — activity is not value.
- "All gates green" from one lane — the charter's `stability` block must name every lane that
  matters, because the unit lane once passed while the integration lane sat at 45 failures.

## 5. Exit criteria

```sh
bun run typecheck && bun run test && bun run test:coverage      # 0
bun run test:unit tests/unit/mind/audit-planted.test.ts         # 0, every plant caught
```

Plus: one real audit ran against a real window and its verdict was consumed by the next pulse; the
digest was read by the owner, who could name one thing the mind declined and say whether the reason
held.

## 6. Failure modes

| Likely mistake                                                | The tell                                            |
| :------------------------------------------------------------ | :-------------------------------------------------- |
| The auditor reads the mind's own narrative                    | It approves everything, fluently                    |
| The auditor's tests written by the auditor's author           | Every plant is caught; no plant was surprising      |
| Value computed from tokens, files or commands                 | Busywork becomes the rational strategy              |
| A budget that warns and proceeds                              | The night costs whatever it costs                   |
| The digest summarising the value series instead of showing it | A long flat zero becomes invisible                  |
| An audit finding that does not block the next pulse           | The audit is advisory, which means it is decorative |

## 7. Rollback

Auditing and economics are additive. Reverting leaves a Phase 4 mind that still works and is simply
unchecked and unbounded — which is precisely why this phase should not be deferred indefinitely once
Phase 4 is running unattended.
