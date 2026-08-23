# 03. Authority-Gated Obligations & Their Dispositions

[⬅ Previous: Line Disposition Algorithm](./02-line-disposition-algorithm.md) | [Master Table of Contents](../README.md) | [Next: Chapter 03 — Dependency Graph Theory ➡](../03-graph-scheduler/01-dependency-graph-theory.md)

---

## 🛑 The Problem

Some instructions must not be executed autonomously:

- _"Drop the legacy SQLite tables and migrate to Postgres after my approval."_
- _"Deploy the container to production if all tests pass."_
- _"Delete all orphaned S3 buckets."_

Blind execution causes catastrophic loss. Silent omission fails the prompt. Neither is acceptable, so
the harness models the gap explicitly rather than letting an agent decide in prose.

---

## 🧾 What Exists Today, Precisely

### The vocabulary is real and enforced

| Level                          | Values                                                         | Enforcement                                                                                                                                         |
| :----------------------------- | :------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement `disposition`      | `actionable`, `needs_authority`                                | `plan:compile` validates the enum. `out_of_scope` is **rejected in a plan**: _"disposition cannot be out_of_scope in a plan; use needs_authority"_. |
| Requirement `authority_status` | `granted`, `declined`                                          | Read by the scheduler's execution-state check and by completion.                                                                                    |
| Runtime disposition            | `actionable`, `needs_authority`, `out_of_scope`                | A requirement that is `needs_authority` without a grant makes its tasks non-executable.                                                             |
| Disposition `rationale`        | required whenever a line links a `needs_authority` requirement | `plan:compile` refuses a bare disposition for a gated obligation.                                                                                   |
| Event                          | `requirement-authority-decided`                                | Appended when a decision is recorded.                                                                                                               |

`proposeBatch` will not schedule a task whose requirements are not `executable`, so a gated
requirement genuinely holds its work back. Completion honours a declined requirement as cleanly
disposed rather than demanding a fabricated proof for it.

### The recording path: `authority:decide`

```bash
bun harness.ts authority:decide --run .olt/capsules/<run-id> --requirement req-prod-deploy \
  --actor coordinator --decision grant \
  --rationale "The user approved the production deploy in the review thread."
```

`--decision` is `grant` or `decline`, both terminal: a second call against an already-decided
requirement is refused with `INVALID_STATE`, and an exact retry (same actor, same rationale) is
idempotent rather than re-appending history. `decline` disposes the requirement `out_of_scope` and
cancels every dormant task built on it alone; it refuses instead if that would invalidate an active
or completed task, so a decline can never retroactively unmake finished work.

This command is deliberately outside every agent's role contract — `--actor` records who decided, but
no `commands:` grant names it, because the decision it records is a human one, not an agent's to make
on its own. `plan:compile` version 1 still derives every requirement as `actionable`, so a compiled
plan does not currently produce a `needs_authority` requirement on its own; see the next section for
how to gate one today.

---

## ✅ How To Handle a Gated Obligation Today

1. **Do not declare a task for it.** `plan:add` is what turns a prompt line into work. Leave the
   gated line unclaimed and `plan:compile` disposes it `kind: "context"` — recorded, visible, and not
   scheduled.
2. **Say so in the enhanced plan.** `plan:enhance --open-question "Line 7 asks for a production
deploy; that needs a human decision before it can be planned."` puts the gap in
   `planning/enhanced-plan.md`, digest-bound and reviewable.
3. **Let the critic see it.** The completeness critic reads every disposition. A `context` disposition
   on an obligation-shaped line is exactly the thing it is meant to question, and it can approve with
   an explicit residual risk or reject and force a replan.
4. **If the human grants it later**, add the task with `plan:add --requirement-lines <that line>` and
   raise the revision with `plan:compile`. The grant becomes an ordinary planned obligation with its
   own gate, which is stronger evidence than an authority flag ever was. `authority:decide` settles a
   requirement the compiler already produced as `needs_authority`; it is not a substitute for planning
   the obligation properly once it is approved.

```text
                     ┌─────────────────────────────────┐
                     │ prompt line asks for a gated act│
                     └────────────────┬────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │ human has not decided             │ human granted it
                    ▼                                   ▼
        ┌───────────────────────────┐       ┌───────────────────────────┐
        │ leave it unclaimed        │       │ plan:add --requirement-   │
        │ → disposition "context"   │       │ lines <n> → real task,    │
        │ → plan:enhance records    │       │   real gate, real proof   │
        │   the open question       │       │   at revision N+1         │
        └───────────────────────────┘       └───────────────────────────┘
```

---

## 🚫 What Not To Do

- **Do not fabricate a proof.** A declined or undecided obligation has no test that passes; writing
  one is exactly the assurance inflation the harness exists to prevent.
- **Do not claim the line with a task that does something else.** The requirement's excerpt would
  then quote an obligation the gate never proves, and every mechanical check would still pass.
- **Do not describe the decision only in chat.** Prose is not state. If it is not in
  `planning/enhanced-plan.md` or the graph, the next agent will not see it.

---

## 📌 Mixed Lines

A single line can carry both an actionable and a gated obligation. Bind the actionable half to a task
with `--requirement-lines`; the line is then disposed as a `requirement` naming that task's
requirement, and the gated half belongs in the enhanced plan's open questions until a human settles
it. The line is disposed exactly once either way.

---

## 🚧 A Second, Independent Gate: The Plan-Validator (C2)

Everything above is about a **specific obligation** the plan should not execute without a human's
say-so. This section is about something structurally different but philosophically identical: the
harness modelling a gap explicitly, in a durable record, rather than trusting an agent's prose about
it. Where `needs_authority` gates one requirement a human must decide, the **plan-validator** gates
**the whole compiled plan**, judged by an independent adversarial agent rather than a human, before
any implementer is dispatched against it.

### Why this exists

`plan:compile`'s structural audit (Chapter 02 §02, invariant C1) is mechanical: it can only ever
catch what a static heuristic can see — repeated file counts, identical gate strings, dependency
edges that don't cross a write-scope boundary. It has no way to judge whether a plan's _shape_
actually matches the prompt's real intent: whether "update the ten report generators" that got
compressed into three tasks really should have been ten, or whether a dependency edge that looks
scope-justified is nevertheless serializing work that never needed to wait. That judgment needs
someone who can read the plan the way a skeptical human reviewer would — which is exactly the role
the coordinator itself cannot fill, because grading its own plan is the same conflict of interest
Chapter 06 documents for an implementer grading its own code.

### The commands

```bash
bun harness.ts plan:validate-start --run .olt/capsules/<slug> --validator plan-val-1

bun harness.ts plan:review --run .olt/capsules/<slug> --validator plan-val-1 --token <token> \
  --status approved \
  --decomposition-answer "14 tasks match the 14 named topics" \
  --dependency-answer "no dependency edges; every task is an independent root" \
  --gate-answer "each gate runs only that task's own scoped test file" \
  --straggler-answer "every task carries the same one-topic effort estimate" \
  --dependency-edges-reviewed "" \
  --gate-ids-reviewed "gate-1,gate-2,...,gate-14" \
  --summary "Decomposition matches the prompt; gates are scope-narrow"

bun harness.ts plan:review --run .olt/capsules/<slug> --validator plan-val-1 --token <token> \
  --status changes_requested \
  --decomposition-answer "10 topics compressed into 1 task" --dependency-answer "n/a" \
  --gate-answer "the shared gate cannot fail per-task" --straggler-answer "n/a" \
  --dependency-edges-reviewed "" --gate-ids-reviewed "gate-1" \
  --summary "Compressed decomposition; see findings" \
  --findings '[{"id":"PV-1","invariant":"A2-parallelism","severity":"critical","observation":"10 distinct topics collapsed into task-domains","remediation":"one task per topic, each with its own scoped gate"}]'
```

`plan:validate-start` mirrors `task:validate-start`'s shape: it opens the validator's claim on the
_currently compiled plan_ (revision-bound: one active assignment per graph revision, not per task,
since the plan is a single whole-run artifact), mints a one-time bearer token, and refuses outright
if the named validator is also the coordinator or planner that produced this exact plan
(`assertPlanValidatorIndependent`). `plan:review` records the verdict.

### Four questions, mandatory on every verdict

Both a `changes_requested` and an `approved` verdict require written answers to all four
questions — `--decomposition-answer`, `--dependency-answer`, `--gate-answer`,
`--straggler-answer` — the same four the structural audit checks mechanically (decomposition,
dependency justification, gate discrimination, straggler risk). This is deliberate: a pass that
never answered them would be a rubber stamp, the exact silence this role exists to end. A
`changes_requested` verdict additionally requires at least one structured finding — an `id`, a
`severity`, an `observation`, and a `remediation` naming a specific, real defect in the
decomposition, never a reflexive "round one must be rejected" with nothing concrete behind it; an
`approved` verdict must carry **no** findings at all.

Prose alone was the entire floor until `--dependency-edges-reviewed` and `--gate-ids-reviewed`
closed it: every verdict must also name, exactly, the dependency edges and the per-task gate ids the
compiled plan actually declares (never the run-scoped completion gate, which is not a task gate).
`recordPlanReview` computes the real edge and gate-id sets from the same projected `tasks`/`gates`
the digest is built from and refuses the review — before it is recorded — if the named set omits a
real one or names one that does not exist. A validator can no longer answer "no dependency edges" in
prose while the graph carries one, or approve without having enumerated a single gate.

### Binding to an exact plan, and detecting drift underneath it

The review is bound to a digest of the compiled plan it actually judged — `plan_digest`, built from
the projected `graph_revision`, `tasks`, `requirements` and `gates` (never from the raw graph or
topology documents, which the run's own state projection does not carry forward verbatim).
`plan:review` re-derives this digest at the moment it records the verdict and refuses if it no longer
matches live state: the plan drifted underneath the validator — a fresh compile, a replan — and the
verdict being recorded would no longer describe what is actually live. The same drift check applies
to the graph revision itself.

### The hard stop this creates

A recorded `changes_requested` against the **live** graph revision is not advisory. It is a condition
`workflow/lease/claim.ts`'s `claimTask` checks directly, on every single claim attempt, and refuses
outright — every implementer and every repairer, for every task in the plan — until a fresh
`plan:compile` (which mints a new graph revision) is followed by a fresh `plan:review` that passes.
This is the one asymmetry worth naming explicitly: a task **cannot** be marked done without some
validator having passed it, yet a plan **can** be compiled and executed with no plan-validator ever
having looked at it at all — dispatching one is the coordinator's choice to make, not a precondition
every run is retroactively assumed to have satisfied. `state.json` simply carries no `plan_validation`
key on a run that never used one.

### A note on identity

`plan:validate-start`'s `--validator` and `plan:review`'s `--validator` are read as the **acting**
identity, the same way `--agent` and `--critic` are on every other command — unlike, say,
`agent:register --agent <id>`, where `--agent` names the _subject_ the coordinator is registering,
not the coordinator calling the command. That distinction matters here because it is what lets the
CLI's shared authority check (described in [Chapter 01 §02](../01-foundations/02-capsule-and-storage-model.md),
under "How a Command Actually Runs") confirm that the identity actually invoking `plan:review` is a
registered `plan-validator`, not merely a name the coordinator typed in.

### Seeing it in the exported graph

When a plan-validator was dispatched, `summary:export` renders one node per validation round,
chained forward exactly the way a task's own repair rounds chain: a `changes_requested` round points
at whichever round the coordinator brought back next via the same `pushback` edge kind a task-level
rejection uses, and an `approved` round signs off onto the plan node with the same `signoff` kind the
completeness critic's own clean verdict uses. Its findings live under the node's
`metadata.planFindings`, deliberately not the ordinary `metadata.findings` field — a plan finding has
no repairer to answer it and no command-resolution lifecycle; only a fresh compile that supersedes
the whole round can close it. A run that never dispatched a plan-validator renders none of this at
all: no orphaned node, no empty section, nothing to see.

---

[⬅ Previous: Line Disposition Algorithm](./02-line-disposition-algorithm.md) | [Master Table of Contents](../README.md) | [Next: Chapter 03 — Dependency Graph Theory ➡](../03-graph-scheduler/01-dependency-graph-theory.md)
