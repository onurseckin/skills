# 03. Plan Revision, Replanning & Immutability

[⬅ Previous: Topological Conflict-Free Batching](./02-topological-conflict-free-batching.md) | [Master Table of Contents](../README.md) | [Next: Chapter 04 — Host-Agnostic Architecture ➡](../04-multi-agent/01-host-agnostic-architecture.md)

---

## ❄️ The Structural Freeze Invariant

Once `plan:compile` has run and execution has begun:

> **Structural task contracts, write scopes, produced artifacts, and prerequisite dependencies freeze
> for the duration of the revision.**

Why it has to be this way:

- If an agent could rewrite its own dependencies mid-flight, it could skip a prerequisite.
- If an agent could widen its own write scope, the scheduler's disjointness guarantee — the thing that
  makes parallel lanes safe — would be worthless.

The freeze is enforced by a revision guard: an apply that does not name the revision it expects, or
names a stale one, is refused rather than merged.

---

## 🌿 The Escape Hatch That Is Not a Revision

A working agent that discovers its task splits in two does **not** need a revision. `branch:open`
subdivides work at execution time, inside the scope the agent already holds, and never enters the
plan DAG:

```text
sub-task id S-1 collides with a plan task; a branch never enters the plan DAG
```

A branch cannot renegotiate a contract, because it can only hand down a _proper subset_ of what the
parent already has. That is precisely why it is allowed to happen while the plan is frozen. See
[Chapter 09 §01](../09-branching-and-honesty/01-execution-time-branching.md).

Use a revision when the **contract** must change: a new task, a new dependency, a scope that must
grow. Use a branch when only the **execution** splits.

---

## 🛑 Two Adversaries Around Compilation

A compiled plan faces two independent checks — one that can refuse the **compile itself**, and one
that reviews the plan **after** it compiles and can refuse to let anything be dispatched against it.
Neither is a warning printed to a terminal and forgotten — both are recorded as their own capsule
events.

### C1 — The Plan Audit: Six Structural Invariants (blocks `plan:compile`)

`plan:compile` runs the identical check `plan:audit` runs by hand, against the same planning buffer,
and refuses to seal on any **blocking** finding:

```bash
bun harness.ts plan:audit --run .capsules/<slug> --actor planner
```

| Invariant                  | Severity      | What it catches                                                                                                                                                                                                                  |
| :------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1-granularity**         | blocking      | One task's write scope expands (on disk) to more than 3 files while the plan as a whole touches ≥ 5 — a monolithic task compressing most of the plan.                                                                            |
| **A2-parallelism**         | not evaluated | Always reported under `not_evaluated`, never guessed: there is no grounded, coordinator-declared count of distinct entities the prompt named to compare against, and the harness refuses to fabricate one with an NLP heuristic. |
| **A3-gate-discrimination** | blocking      | Two tasks with disjoint write scopes share byte-identical gate argv — the gate passes whether either task did its work or nothing at all.                                                                                        |
| **A4-false-barrier**       | blocking      | A dependency edge serializes two tasks whose write scopes don't actually overlap — a barrier with no scope reason behind it.                                                                                                     |
| **A5-straggler**           | advisory      | One task's effort estimate is more than 3× the median of its own wave — the rest of the wave idles waiting on it.                                                                                                                |
| **A6-whole-suite-gate**    | blocking      | A task's gate command looks like it runs the whole test suite. The run-wide suite belongs to `--completion-gate`, which runs once; a task gate must prove its own scope.                                                         |

A3 and A6 are not purely static: both check `gate:prove`'s recorded verdicts first, via a
`latestGateProof` lookup keyed on the task's current gate argv — a task whose gate was independently
proven to fail once its own write scope is reverted to a base ref is exempted from the blocking
finding, even if the argv looks identical to a sibling task's. `gate:prove` is a separate, later
command (`gate:prove --run .capsules/<slug> --task <task-id>`); it is never run automatically by
`plan:audit` or `plan:compile`, because at compile time the task's work does not exist yet —
reverting nothing would yield a scratch copy identical to the live tree, and every verdict would
degenerate to "not falsifiable." Full falsifiability mechanics — the scratch-copy revert, the
timeout and symlink handling, what `falsifiable` actually measures — belong to the gates and
completion chapter; what matters here is that a recorded `falsifiable: true` proof over the task's
_current_ declared scope is what lets A3/A6 pass without a coordinator having to type
`--accept-audit`.

A blocking finding can still be overridden, one invariant at a time, with an attributed reason:

```bash
bun harness.ts plan:compile --run .capsules/<slug> --actor planner \
  --completion-gate "bun test tests/unit" \
  --accept-audit "A3-gate-discrimination:task-a and task-b legitimately share the shared-fixture regression test"
```

There is no blanket override. Every blocking invariant needs its own `--accept-audit
"<id>:<reason>"`; an id the audit did not actually raise as blocking is refused rather than silently
accepted, and an acceptance with no reason after the colon is refused too — a silent override is
exactly the failure mode this gate exists to end.

### C2 — The Plan-Validator: An Adversary for the Plan (blocks dispatch, not compile)

Unlike the audit, the plan-validator is not part of `plan:compile` at all — it reviews an
_already-compiled_ revision, and its refusal blocks `task:claim`, never `plan:compile`.

A monolithic-plan compression, a false dependency barrier, a gate that can't fail — the six audit
invariants catch the _mechanical_ shape of these defects. Whether the decomposition actually matches
what the prompt asked for is a judgment call, and judgment calls are what the **plan-validator** role
exists for: an independent adversary that reads the compiled plan — never the code, because there is
no code yet — and answers, in writing, the same four questions the audit checks structurally:
decomposition, dependencies, gate discrimination, and straggler risk.

```bash
bun harness.ts plan:validate-start --run .capsules/<slug> --validator plan-val-1
# → mints a plan-validation token, scoped to the current graph revision

bun harness.ts plan:review --run .capsules/<slug> --validator plan-val-1 --token <token> \
  --status approved \
  --decomposition-answer "14 tasks match the 14 named topics" \
  --dependency-answer "no dependency edges; every task is an independent root" \
  --gate-answer "each gate runs only that task's own scoped test file" \
  --straggler-answer "every task carries the same one-topic effort estimate" \
  --dependency-edges-reviewed "" --gate-ids-reviewed "gate-1,gate-2,...,gate-14" \
  --summary "Decomposition matches the prompt; gates are scope-narrow"
```

Prose is not the whole floor: `--dependency-edges-reviewed` and `--gate-ids-reviewed` must each name
exactly the dependency edges and per-task gate ids the compiled plan declares, or the review is
refused before it is recorded — the same mechanical check the audit runs, now asked of the verdict
that vouches for it.

The plan-validator is **optional** — `state.plan_validation` is absent on any run that never
dispatches one, and nothing forces a coordinator to. But once dispatched, its verdict is not
advisory:

- The validator must be independent from the coordinator or planner that produced the plan
  (`assertPlanValidatorIndependent` refuses a validator id that also holds a `coordinator` or
  `planner` grant) — the exact failure mode this role exists to close is a coordinator's own plan
  going unreviewed because nothing independent ever looked at it.
- `--status approved` and `--status changes_requested` both **require** written answers to all four
  questions — a pass that never answered them would be a rubber stamp.
- `changes_requested` requires at least one structured finding (id, severity, observation,
  remediation) naming a specific defect; a reflexive rejection with no finding is refused.
- A recorded `changes_requested` against the **live** graph revision is a hard stop `task:claim`
  enforces directly: every implementer and repairer claim against that revision is refused until a
  fresh graph revision carries a passing review. This is not a warning a coordinator can route
  around by dispatching anyway — it is checked inside the same transaction that claims a task.
- One active assignment exists per graph revision, mirroring the completeness critic's shape (the
  plan is a single whole-run artifact, not a per-task lease). A dangling assignment left open against
  a now-superseded revision cannot block a fresh one — the plan it was reviewing no longer exists to
  be reviewed, so a new `plan:validate-start` call against the new revision marks the old one
  `expired` automatically.
- The review is bound to a digest of the exact compiled artifact it judged — `graph_revision`, the
  projected tasks, requirements and gates — built from the same projected `WorkflowState` fields
  `record-plan-review` re-derives at verdict-recording time. If the plan drifted underneath the
  validator (a fresh compile, a replan) between `plan:validate-start` and `plan:review`, the digest no
  longer matches and the verdict is refused rather than recorded against a plan that no longer exists.

**A caveat worth knowing before you rely on this**: unlike a task lease or a validation attempt, a
plan-validation assignment has no automatic staleness sweep and no release command. If a
plan-validator's token is lost or the agent dies before calling `plan:review`, `plan:validate-start`
for the _same graph revision_ refuses with "a plan validation is already active" — verified directly
against `beginPlanValidation`, which only ever marks a prior assignment `expired` when a call for a
**different** (newer) graph revision comes in, never on its own deadline passing. The only way to free
a dead plan-validator up is to raise the graph revision, which today only ever happens through
`plan:replan` (below).

---

## 📈 Revisions ($0 \to 1 \to 2$)

Revision 0 is the uncompiled planning buffer; `plan:compile` commits **revision 1**, always — the
graph document is built with the literal revision `1`, never a value the caller supplies. There is
exactly one way to raise it further: **`plan:replan`**.

There is no "add more tasks and recompile" path once a plan is sealed, however natural that sounds.
Two independent refusals close it off: `plan:add` throws `INVALID_STATE: cannot add tasks to compiled
plan` the moment `state.graph` exists, and even if a caller worked around that, `plan:compile` always
attempts to write revision `1` again — `guardPlanRevision` requires a _first_ compile's revision to be
exactly `1`, but a state that already has a graph must see `graph.revision === state.graph.revision +
1`, so a second `plan:compile` call collides with the revision it already sealed and is refused with
"graph revision must increase by exactly one." Retrying `plan:compile` is never how a plan grows.

```bash
bun harness.ts plan:replan --run .capsules/<slug> --actor coordinator \
  --findings-file findings.json --gate "bun run typecheck" --round 2
```

`plan:replan` ingests findings, partitions them into **disjoint write scopes** so the repair wave can
run in parallel, and compiles the next revision by cloning the current graph and only ever _appending_
new nodes, edges and gates — no existing entry is read back out and rewritten, which is what lets the
revision guard see every prior task as byte-identical to before. `--gate` supplies the revalidation
command for generated repair tasks; it may be omitted only when the findings declare their own
`revalidation_gate`, or the task already covering that write scope has a gate to inherit. There is no
default — an unresolved gate is always a refusal, never a guess standing in for one.

Findings come from exactly two places, in this order: an inline `--findings` payload or
`--findings-file`, or — when neither is given — `state.completion_review.findings`, the completeness
critic's own recorded review. **`plan:replan` never reads a plan-validator's `changes_requested`
findings automatically.** Recovering from a plan-validator's rejection today means the coordinator
passes that same review's findings back in by hand via `--findings-file` — the finding shape
(`id`, `severity`, `observation`, `remediation`) is compatible, since `plan:replan`'s own finding
reader accepts exactly those fields. Be aware this path was built around repairing code a validator or
critic already found defective (a finding's `file_paths` drive which scope a repair task gets); a
plan-validator's findings carry no file paths because no code exists yet, so every such finding
partitions into the single whole-tree scope, and `--gate` becomes mandatory since there is no
per-file scope to inherit an existing task's gate from.

Rules every revision obeys:

1. **Monotonic increment.** Exactly one, and the apply names the revision it expects.
2. **Immutable source requirements.** Original prompt requirements are not deleted or re-scoped.
3. **Preserved history.** `done` tasks, satisfied requirements, gate receipts, findings and validation
   history survive the recompile.
4. **Archived predecessors.** Prior graph states are kept in `plan_history` and in the event chain.
5. **Re-recorded topology.** `state.topology` is rewritten for the new revision, so the wave plan and
   the graph never disagree about which revision they describe.

---

## 📊 What Freezes vs. What Evolves

| Property                   | Behaviour                    | Rationale                                                                                                        |
| :------------------------- | :--------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **`prompt.md`**            | Immutable, forever           | SHA-256 bound in `manifest.json` at `plan:init`.                                                                 |
| **Done task contracts**    | Frozen                       | Completed work cannot be mutated or downgraded.                                                                  |
| **Active leased scopes**   | Frozen                       | A lease cannot widen or narrow while it is held.                                                                 |
| **Task status**            | Evolves                      | Driven by the state machine, recorded in `task.history[]`.                                                       |
| **Findings**               | Appended immutably           | Opened by a verdict, answered by `--resolve` with command ids.                                                   |
| **Gate receipts**          | Appended immutably           | `run:exec` records argv, exit, timings, repository binding.                                                      |
| **Branches**               | Appended to `state.branches` | Execution-time only; never a plan node.                                                                          |
| **Agent grants**           | Appended to `state.agents`   | Registered before work, released after.                                                                          |
| **Topology**               | Rewritten per revision       | One authority for waves; no second derivation.                                                                   |
| **New tasks / edges**      | Added via `plan:replan` only | Revision $N+1$ is the only way a contract grows; there is no manual recompile.                                   |
| **Plan-validator verdict** | Bound to one graph revision  | A dangling `changes_requested` cannot block a revision it never reviewed; a fresh revision needs its own review. |

---

## 🚦 When Neither Tool Fits

If a task cannot be completed inside its contract and cannot be branched — a shared file must change,
a dependency was missed — the agent stops and reports. It does not take the path silently. The
coordinator then either raises a revision or escalates. A task that has exhausted `max_repair_rounds`
(6) is `escalated` for the same reason: the loop is bounded so a wrong plan surfaces as a decision
rather than as spend.

---

## ⚡ Dynamic DAG Expansion & Living Tracer Engine

While the **Plan Graph** (`state.graph`) remains structurally frozen for each revision to protect scheduling guarantees, real-world execution produces runtime subgraphs, dynamic sub-tasks, and branches.

The harness bridges this with the **Living Dynamic DAG Expansion Engine** and **Step Tracer** (`dag:trace`, aliased as `trace:dag`, `stream:trace`):

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│               STATIC PLAN DAG vs. LIVING DYNAMIC EXPANSION                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Static Plan Graph: state.graph ]                                         │
│    • Compiled at plan:compile (Revision 1, 2, ...)                          │
│    • Authoritative contract for wave scheduling & conflict detection        │
│    • Contains strictly planned top-level tasks & gates                      │
│                                                                             │
│                                      │                                      │
│                                      ▼ (Replay events.jsonl via readCapsuleEvents)
│                                                                             │
│  [ Living Dynamic DAG State: DynamicDagState ]                              │
│    • Reconstructed dynamically by replaying the hash-chained event stream   │
│      using readCapsuleEvents()                                              │
│    • Captures execution-time branch expansions (branch-opened / collected)  │
│    • Tracks active worker agent assignments and real-time step sequences    │
│    • Visualizes step-by-step progress via vertical chronological trace      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Chronological Step Tracing (`dag:trace`)

The Living Tracer inspects the immutable event log (replayed via `readCapsuleEvents`) and formats a real-time chronological timeline and timeline rendering of all agent operations:

```bash
bun harness.ts dag:trace --run .capsules/<slug> --max-steps 20
```

```text
### Living Dynamic DAG Step Trace: slugger
- **Events Replayed**: 48 total steps across 3 active agents
- **Dynamic Tasks**: 2 static tasks, 2 dynamic branch sub-tasks
- **Timeline Window**: Seq 1 -> Seq 48 (Duration: 124.5s)

  Seq   Time (+ms)   Actor         Role          Tool     Event & Summary
 ────  ────────────  ────────────  ────────────  ───────  ────────────────────────────────────
    1       +0.00ms  coordinator   coordinator   -        ○ plan-compiled (Revision 1, 2 tasks)
   12    +1240.20ms  impl-slug     implementer   -        🟢 task-claimed (task-slug)
   18    +3420.10ms  impl-slug     implementer   Bash     ✓ run:exec (bun test tests/slug.test.ts)
   22    +5120.00ms  impl-slug     implementer   -        🟣 task-submitted (task-slug)
   25    +5890.30ms  val-slug      validator     -        🔄 validate-start (val-slug on task-slug)
   28    +7100.00ms  val-slug      validator     Bash     ✓ task:probe (1 demand recorded)
   34   +10200.00ms  val-slug      validator     -        ✓ task-reviewed (PASS, resolved finding-1)
   38   +12100.50ms  impl-trunc    implementer   -        🟢 branch-opened (B-1b72a087, 2 sub-tasks)
   42   +18400.00ms  sub-measure   sub-impl      Write    🟢 branch-submitted (S-measure)
   48   +24500.00ms  impl-trunc    implementer   -        ✓ branch-collected (2 files diffed)
```

---

## 🔍 Why a Finished Task's Gate Set Is Not Frozen

A revision may add a gate that lands on a task already `done`, and that is correct rather than a violation.

`taskGates()` selects gates by **requirement-id overlap, not task identity**. So when a repair task legitimately inherits a done task's requirement, the new task-scoped gate it brings is attributed to the done task as well. That growth is how a critic's or validator's finding becomes a claimable repair task — it is not a retroactive change to what the done task was verified against.

Its own gate _results_ are already recorded and cannot be revisited. Only tasks still in flight need their gate set frozen against revision, which is what `gateContractActive` expresses: execution-active and not `done`. The task's _contract_ — write scope, dependencies, produces — stays frozen for a done task, so its definition still cannot be silently rewritten.

---

[⬅ Previous: Topological Conflict-Free Batching](./02-topological-conflict-free-batching.md) | [Master Table of Contents](../README.md) | [Next: Chapter 04 — Host-Agnostic Architecture ➡](../04-multi-agent/01-host-agnostic-architecture.md)
