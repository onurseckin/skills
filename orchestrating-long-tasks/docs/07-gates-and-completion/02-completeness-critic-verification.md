# 02. Completeness Critic Verification Protocol

[⬅ Previous: Mandatory Gate Systems](./01-mandatory-gate-systems.md) | [Master Table of Contents](../README.md) | [Next: Mechanical Completion Engine ➡](./03-mechanical-completion-engine.md)

---

## 🎯 What the Critic Is For

Task validators review one scope each. A macro-level risk survives that: every task can pass while the
**request** goes unmet.

- All tasks done, one cross-cutting user requirement forgotten.
- Artifacts declared but absent, empty, or stubbed.
- A prompt line disposed as `context` that was actually an obligation.

The completeness critic is an independent audit of the whole request, run after task validation and
before completion.

---

## 🔐 The Lifecycle

```text
[ critic:start --critic <id> ]
        ├── refuses a critic that planned, implemented, repaired or validated anything in this run
        ├── records a repository inspection and a readiness snapshot
        └── returns the critic token (once, stdout only; digest persisted)
                 │
                 ▼
[ the critic runs its OWN commands: run:exec --actor <critic> ]
                 │
                 ▼
[ critic:review --decision approve|request_changes  |  critic:reject ]
```

```bash
bun harness.ts critic:start --run .capsules/<run-id> --critic critic-1
```

Independence is enforced, not requested:

```text
completeness critic must be independent from implementers, repairers, and validators
```

---

## 🧪 The Critic Must Run Its Own Commands

This is the step most people miss. The critic's evidence is collected automatically from the commands
whose **actor is the critic** — and a command qualifies only if it is **not bound to a task**:

```bash
bun harness.ts run:exec --run .capsules/<run-id> --actor critic-1 -- bun test tests/slug.test.ts
bun harness.ts run:exec --run .capsules/<run-id> --actor critic-1 -- bun test tests/truncate.test.ts
bun harness.ts run:exec --run .capsules/<run-id> --gate gate-run-completion --actor critic-1 -- bun test tests
```

Skip it and the review is refused:

```text
{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"critic checks must be nonempty"}}
```

Cite a task-bound or someone else's command and it is refused too:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"critic independent check is invalid: C-312707c8-…"}}
```

Rerunning the suite under the critic's own actor is the price of a sign-off. That is the whole
mechanism by which "the critic verified it" means something.

---

## 📝 Requirement Proofs Are Mandatory and Unfakeable

An approval must carry one proof per requirement, supplied by `--proofs`, `--proofs-file`, or a
complete `--review` payload:

```json
[
  {
    "requirement_id": "req-slug",
    "status": "satisfied",
    "evidence": [
      {
        "kind": "command",
        "reference": "C-6c9cbf46-fe0b-405d-a060-69176613528f",
        "observation": "the critic ran bun test tests/slug.test.ts itself and it exited 0"
      }
    ]
  }
]
```

- `status` is `satisfied`, `out_of_scope`, or `unproven`.
- **`unproven` is not something a critic can claim.** It is what the harness records for a requirement
  the critic never proved, and it blocks completion.
- A clean verdict with any unproven requirement is refused:
  ```text
  clean completion review leaves requirements unproven: req-truncate
  ```
- Every `kind: "command"` reference must resolve to a critic-run, task-unbound, successful command:
  ```text
  requirement proof command is invalid: C-3e1dbf9d-…
  ```

Nothing auto-generates a `satisfied` proof. A requirement the critic did not look at stays unproven,
and the run does not finish.

---

## ✅ Approving

```bash
bun harness.ts critic:review --run .capsules/<run-id> --critic critic-1 --token <critic-token> \
  --decision approve --proofs-file proofs.json \
  --summary "Both prompt lines are implemented and each is bound to a gate run the harness recorded."
```

```text
### Completeness Critic Sign-Off: APPROVED
- **Critic**: `critic-1`
- **Summary**: Both prompt lines are implemented and each is bound to a gate run the harness recorded.
- **Authorization**: Valid completion certificate issued
- **Next Step**: Seal run via `bun harness.ts run:complete --run .capsules/<run-id> --auth-token …`
```

`--summary` is mandatory and is the critic's own words. `integrity_evidence` is always the harness's
own capsule integrity observation measured at review time — a `--review` file cannot certify its own
capsule, so whatever it declares under that key is replaced.

---

## ❌ Rejecting

```bash
bun harness.ts critic:reject --run .capsules/<run-id> --critic critic-1 --token <critic-token> \
  --summary "Missing error boundary" \
  --findings '[{"id":"F-01","requirement_id":"req-1","severity":"critical","observation":"No error boundary around the render tree","remediation":"Wrap the tree in an error boundary","revalidation":"bun test tests/render"}]'
```

Structured findings are **mandatory**:

```text
--decision request_changes requires --findings or --findings-file; a rejection must name the defects it found
```

Each finding carries `id`, `requirement_id`, `severity`, `observation`, `remediation` and
`revalidation`. A critic that wants to reject but has nothing concrete to say **fails** rather than
producing a finding the harness wrote for it. Rejected findings feed `plan:replan`, which partitions
them into a disjoint repair wave.

---

## 🔧 Closing the Loop: `critic:remediate`

`plan:replan` schedules the repair work; it does not, by itself, satisfy completion. Every review ever
recorded with `status: "findings"` stays in the run's history and blocks completion until it carries a
remediation naming exactly its own finding ids, each proven by a task-unbound, successful command:

```bash
bun harness.ts critic:remediate --run .capsules/<run-id> --actor coordinator \
  --resolve CF-1=<fix-command-id> --resolution-method CF-1="focused repair and verification"
```

`--resolve` is repeatable as `<finding-id>=<command-id>[,<command-id>]`; every finding the review
opened must be answered exactly, no more and no fewer. `--review-sha256` defaults to the currently
recorded review. This does **not** clear the review's own `unresolved_finding_ids` or make it
`clean` — only a fresh, independent critic pass does that. What it does is record that the defects
were closed, so completion's history check stops demanding a remediation that was never made.

---

## 🛡️ The Critic's Own Rules

1. **Token digest verification.** The critic token must match the digest recorded at `critic:start`.
2. **Independence.** No prior role in this run, ever.
3. **No implementer prose.** The critic consumes the prompt, the dispositions, the whole-repository
   diff, and the authoritative command, gate and finding records — not self-grading narratives.
4. **Readiness binding.** Any drift from the packet's readiness digest or repository binding is a
   rejection, not a note.
5. **Explicit residual risk.** An approval may carry risks; it may not carry silence about them.

---

## 🪞 The Mirror-Image Adversary: Plan-Validator Pre-Flight Review

Everything above is an adversary for the _finished work_ — dispatched after every task validator has
already passed, reviewing the whole diff against the whole prompt. The **plan-validator** role is the
same adversarial pattern turned around to face the _other_ end of the run: dispatched once per compiled
graph revision, **before any implementer is dispatched at all**, reviewing the compiled plan itself —
the graph, the projected tasks, the topology's own stated reasoning for where each task landed — never
any code, because at this point no code exists yet to review.

Coordinators have never had a dedicated adversary for this before. A task validator catches a bad
_implementation_; nothing has ever told a coordinator its _decomposition_ was wrong before workers
started burning wall-clock time executing it. A real forensics run recorded exactly this gap: a user
had to be the plan's refusal mechanism by hand, four separate times, because nothing in the harness
would say "no" to a plan on its own.

### The lifecycle

```text
[ plan:validate-start --validator <id> ]
        ├── refuses a validator who is the coordinator or planner that produced this plan
        ├── one active assignment per graph revision (mirrors task:validate-start)
        └── returns the validation token, bound to a packet carrying the compiled graph,
            the projected requirements/tasks, and the recorded topology
                 │
                 ▼
[ the validator reviews the compiled document — may run read-only run:exec checks to test
  a specific claim, but most of the review is reading the graph and topology as compiled ]
                 │
                 ▼
[ plan:review --status approved | changes_requested ]
```

```bash
bun harness.ts plan:validate-start --run .capsules/<run-id> --validator plan-val-1
```

Independence is enforced identically to the critic's, just against a different pair of roles: a
plan-validator that is also the coordinator or planner who authored the plan is refused outright —
grading your own homework is exactly the failure this role exists to close.

### Four mandatory questions, on every verdict — pass or reject

`plan:review` requires a written answer to all four, every time, whether the verdict is
`approved` or `changes_requested`. A pass that never answered them is a rubber stamp, and the harness
refuses it structurally rather than trusting a coordinator's dispatch prompt to demand it:

1. **Decomposition** — does the task count and shape match the entity count the prompt actually names?
   Ten or more distinct topics compiled into fewer than five independent tasks is a compression, not a
   simplification.
2. **Dependencies** — for every edge in the graph, is there a real read/write relationship between the
   two tasks it connects? An edge that exists only to serialize otherwise-parallel work is a false
   barrier.
3. **Gate discrimination** — could each task's mandatory gate command actually fail if that task did
   nothing? (This is exactly Chapter 07 §01's falsifiability question, asked here as a reading exercise
   against the compiled plan rather than measured with `gate:prove`.)
4. **Straggler risk** — is any task's scope or declared effort large enough, relative to the rest of its
   wave, that the wave will sit idle waiting on it?

```bash
bun harness.ts plan:review --run .capsules/<run-id> --validator plan-val-1 --token <token> \
  --status changes_requested \
  --decomposition-answer "10 topics compressed into 1 task" \
  --dependency-answer "n/a" \
  --gate-answer "the shared gate cannot fail per-task" \
  --straggler-answer "n/a" \
  --dependency-edges-reviewed "" --gate-ids-reviewed "gate-1" \
  --summary "Compressed decomposition; see findings" \
  --findings '[{"id":"PV-1","invariant":"A2-parallelism","severity":"critical","observation":"10 distinct topics collapsed into task-domains","remediation":"one task per topic, each with its own scoped gate"}]'
```

Prose is not the whole floor: `--dependency-edges-reviewed` and `--gate-ids-reviewed` must each name
exactly the dependency edges and per-task gate ids the compiled plan declares — no fewer (a skipped
one) and no more (a fabricated one) — or the review is refused before it is recorded.

`changes_requested` requires at least one structured finding (`id`, `severity`, `observation`,
`remediation`, and an optional `invariant` naming which of the four questions — or one of `plan:audit`'s
own invariant ids — it answers); `approved` may carry none. The review is also digest-bound: it embeds
the exact compiled-plan digest (`currentPlanDigest`, built from the projected graph revision, tasks,
requirements and gates — never the raw graph document) the validator was actually shown, and
`plan:review` refuses to record a verdict if that digest no longer matches the live plan. A plan that
moved underneath the validator between `plan:validate-start` and `plan:review` — a fresh compile, a
replan — cannot be signed off as if nothing had changed.

### The pushback: what `changes_requested` actually blocks

This is not advisory. `task:claim` reads `state.plan_review` directly: whenever a recorded review's
`graph_revision` still matches the run's **live** graph revision and its `status` is
`changes_requested`, **every** `--role implementer` and `--role repairer` claim is refused outright —

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"plan validation rejected this graph revision; replan and record a passing plan:review before any implementer or repairer can claim work"}}
```

— a hard stop enforced at the one place work actually starts, not a warning a coordinator can route
around by dispatching anyway. The only way out is a **new** graph revision followed by a **new**,
passing `plan:review` against it; a stale rejection against a superseded revision no longer blocks
anything.

> **What "a new graph revision" honestly requires today.** The natural-sounding path — call `plan:add`
> to fix the buffer, then `plan:compile` again — does not work: `plan:add` refuses outright once
> `state.graph` exists (`"cannot add tasks to compiled plan"`), and that condition never reverts, for
> the rest of the run's life, once the _first_ `plan:compile` has ever succeeded. The verified working
> path is the **planner role's** own route: `plan:claim` (which hands back a packet bound to
> `planning/requirements.json` and `planning/graph.json`) followed by `plan:apply
--expected-revision <current>`, with the freshly authored `graph.json` declaring
> `"revision": <current + 1>` — `--expected-revision` only checks that the run hasn't moved since the
> packet was issued; the submitted graph's own `revision` field is what actually has to be exactly one
> more than the live one, or `plan:apply` refuses it. This is the real way a graph revision advances
> after the first compile. `plan:replan` is a different tool entirely: it only
> ever _appends_ a disjoint repair wave driven by findings that name concrete file paths, and by default
> reads its findings from `state.completion_review` (the completeness critic's review), not
> `state.plan_review` — it cannot revise an existing task's scope, remove a false dependency edge, or
> fix a bad decomposition, which is exactly what a plan-validator's rejection is usually about.

### What it is not

- It never touches repository files — the packet carries the compiled plan, not a write scope.
- It is not part of the 9-point terminal completion checklist in Chapter 07 §03; it gates the _start_
  of implementation, not the _end_ of the run.
- `recover` does not reclaim a stale plan-validation assignment the way it reclaims a stale
  completeness critic — see [Chapter 08 §03](../08-durability-recovery/03-stale-worker-and-torn-tail-recovery.md)
  for exactly what that means if the validator's agent dies mid-review.

---

[⬅ Previous: Mandatory Gate Systems](./01-mandatory-gate-systems.md) | [Master Table of Contents](../README.md) | [Next: Mechanical Completion Engine ➡](./03-mechanical-completion-engine.md)
