# Delegation audit — does a verifier delegate, or does it hand its report upward?

Read-only audit, 2026-08-21, against `main` at `154b5cb`. Nothing here was changed; every verdict
below was reached by opening the cited file or running the cited command, and the output is quoted.

The owner's report, restated as the thing being tested:

> The final verification phase completes, writes a report, and submits it **to the main thread**.
> The main thread — which knows nothing about the run's interior — absorbs the verifier's findings
> and starts implementing them itself. Expected: verifiers wake the **coordinator**, never do the
> work, never terminate before delegating, and always report through the CLI. An agent that dies
> without reporting should trip a system failure and be re-woken with a corrective instruction.
> The main thread should deploy an orchestrator and stay empty.

**Headline: the observed failure is real and unfixed.** Six of the seven guarantees are absent or
documented-only. One (G6) is genuinely enforced and was proven at runtime.

---

## Verdicts

| #      | Guarantee                                            | Verdict                             | What settles it                                                                          |
| :----- | :--------------------------------------------------- | :---------------------------------- | :--------------------------------------------------------------------------------------- |
| **G1** | Main thread deploys an orchestrator, does no work    | **absent**                          | No `orchestrator` role exists; `orchestrate`'s own brief tells the caller to do the work |
| **G2** | Validator/critic may not implement, only delegate    | **enforced (partial)**              | `commands:` grant refuses it — but only for a _registered_ agent                         |
| **G3** | Findings become new work via `plan:replan`           | **absent on the path that matters** | Two independent refusals block critic → replan                                           |
| **G4** | An agent that terminates without reporting is caught | **absent**                          | Detection is 100% deadline-lapse; validators/critics produce no event even then          |
| **G5** | A dead agent is re-woken with a corrective           | **absent**                          | `triggerAutoWake` emits an event and returns; no dispatch, no corrective                 |
| **G6** | Completion cannot happen with open findings          | **enforced**                        | Proven at runtime; quoted below                                                          |
| **G7** | Every role reports through the CLI                   | **absent**                          | An unregistered agent leased a task against an empty ledger                              |

---

## G1 — The main thread deploys an orchestrator and does no work itself

**Verdict: absent, and the primary entry point actively contradicts it.**

There is no orchestrator role. `contracts/packets.ts:15-26` enumerates ten roles and `orchestrator`
is not among them. Proven:

```
$ agent:register --role orchestrator
REFUSED: --role must be one of completeness-critic, coordinator, implementer, plan-validator,
planner, repairer, sub-implementer, sub-investigator, sub-validator, validator
```

`roles/` holds fifteen contracts and none is `orchestrator.md`. `agents/orchestrator.yaml:6-7`
declares `role: "coordinator"`, `tier: 1`, and `role_contract: "roles/coordinator.md"` — so the
"meta-orchestrator" is a coordinator persona that sits **at** tier 1 rather than being spawned by it.

The documented ladder is two-tier and names a coordinator, not an orchestrator, as the single child:

- `references/host-adapters.md:33-35` — "Tier 1 (Main Interactive Thread): … Spawns **exactly one**
  background coordinator agent. Never directly executes implementer tool loops or polls state."
- `references/protocol.md:306-307` — "Main Thread Isolation: Tier 1 is dedicated to user dialogue and
  milestone notifications. It never runs worker tools, edits files, or polls background tasks, and
  spawns exactly one child."

Both are prose. The only test that touches them, `tests/unit/contracts/host-adapters.test.ts:17`,
asserts `expect(content).toContain("Tier 1: Main Interactive Chat Session")` — it checks the sentence
exists in the file, not that any code enforces it.

Worse, the skill's declared primary entry point tells the main thread to do the planning itself.
`cli/formatters/orchestrate-formatter.ts:22-30` is what `orchestrate` prints:

```
**Next, in order — nothing here is optional and nothing is done for you:**
1. Read the repository yourself, then record what you found with `plan:enhance` …
2. Register each task with `plan:add` …
3. `plan:compile --completion-gate …`
4. `queue:wave` to see what is claimable, then register and dispatch an implementer …
```

There is no "first, spawn a coordinator" step anywhere in `SKILL.md`, in
`references/run-playbook.md` (Phase 1 opens straight into `plan:init`/`plan:enhance` with
`--actor coordinator`), or in the `orchestrate` handler. The reader is assumed to _be_ the
coordinator.

---

## G2 — A validator or completeness critic may not implement

**Verdict: enforced for a registered agent, by the `commands:` grant — not by `must_not`.**

`must_not` is decorative. The harness's own health tool says so, at
`health/unenforced.ts:185`:

> "Only the `commands:` grant of a role contract is checked for coverage. `may` and `must_not` are
> prose and no mechanical check can confirm the code enforces them."

`packets/role-contract.ts` parses `must_not` (line 190) and never consults it again; a whole-tree
grep finds only the parser, the type, and that health limitation string.

What _is_ enforced is the command allowlist. `packets/command-authority.ts:55-63`
(`assertRoleMayInvoke`) refuses any invocation absent from the contract's `commands:` list, and it is
wired into the single CLI entry path at `cli/execute.ts:29`. Proven at runtime:

```
$ agent:register --agent val-1 --role validator …
$ task:claim --task task-sec --agent val-1 --role implementer
REFUSED: role validator may not invoke task:claim: agent val-1 holds a validator grant, and the
contract at …/roles/validator.md grants only task:validate-start, run:exec, task:probe, task:reject,
task:review
```

`roles/validator.md` and `roles/completeness-critic.md` both omit every mutating task command, so
implementation commands are genuinely out of reach. `workflow/lease/claim.ts:43-44` adds a second,
independent refusal: `(repair && role !== "repairer") || (!repair && role !== "implementer")` →
`INVALID_ARGUMENT: lease role does not match the task state`.

**The hole:** `assertGrantedCommand` (`command-authority.ts:65-75`) returns silently at line 73 when
the acting agent is not in the ledger. See G7 — an unregistered agent bypasses all of this.

**Second hole:** `SUBJECT_FLAGS` (`command-authority.ts:14-20`) excludes `--agent` from acting-agent
resolution for `agent:register`/`agent:report`/`agent:release`/`queue:pop`/`critic:start`. With no
`--actor`, no authority check runs at all. Proven: a registered `completeness-critic` released its own
grant even though `agent:release` is **not** in its `commands:` list.

Neither refusal stops a validator from simply editing files with its host tools. The harness cannot
see that, and no check compares a validator's actor id against the repository diff.

---

## G3 — Findings become new work, not a report handed upward

**Verdict: the shadow-table bug is fixed, but the critic → replan path is blocked by two independent
refusals, and one of them is codified in a test as intended behaviour.**

The mechanism now writes to the real graph. `cli/commands/plan-replan.ts:134-151` pushes task nodes
into `newGraph.nodes` and line 176 calls `projectPlan(...)`, which projects them into `draft.tasks`.
A replan-created task does reach the scheduler — proven:

```
BEFORE replan, queue:next task = task-core
REPLAN new_tasks = [ "repair-R1-tests-unit-core" ]
AFTER replan, queue:list partitions = {"ready":["repair-R1-tests-unit-core","task-core"], …}
```

(`queue:wave` correctly withheld the repair task in that snapshot because its write scope collides
with the still-ready `task-core`; that is conflict-free batching working, not a defect.)

**But that only worked because `task-core` was still `ready`.** In the real scenario — the completeness
critic rejects after every task is `done` — both of these fire:

**(a) The revalidation command the critic is _required_ to supply is discarded.**
`workflow/completion/review-input.ts:54` requires `finding.revalidation` on every critic finding.
`cli/commands/plan-replan-findings.ts:60` reads `record.revalidation_gate` — a field the critic
pipeline never writes. Result, on a real `critic:reject` → `plan:replan`:

```
replan REFUSED: repair task repair-R1-src-new has no revalidation gate: no finding declared
revalidation_gate and no planned task writing src/new has a recorded gate to inherit; pass --gate
```

**(b) Supplying `--gate` by hand still fails.** `graph/plan-contract.ts:52-71` (`taskGates`) selects a
task's gates by requirement-id overlap, and `graph/constants.ts:43` makes `done` a non-plannable —
i.e. _active_ — status. A repair task inheriting the finding's requirement adds a gate bound to that
requirement, which changes the finished task's gate set:

```
$ plan:replan --gate "bun gate-t1.ts"
HarnessError: plan revision cannot change active task task-1 gates
  at guardPlanRevision (graph/revision-guard.ts:135)
```

`tests/unit/cli/critic-start-review.test.ts:245-247` asserts exactly this refusal and its comment
calls it "the same rail holds reached through the real `critic:reject` → `plan:replan` CLI path a
coordinator actually drives." So the blocked path is currently the _specified_ behaviour.

**Do critic findings route there at all?** Only indirectly. `collectReplanFindings`
(`plan-replan-findings.ts:97-99`) reads `state.completion_review` — the critic's recorded rejection —
so the data is there. But the critic cannot act on it: `plan:replan` is absent from
`roles/completeness-critic.md`'s `commands:`, proven at runtime:

```
critic plan:replan -> role completeness-critic may not invoke plan:replan: agent critic-x holds a
completeness-critic grant …
```

**Validator findings never route to replan at all.** `task:reject` records findings on the task and
moves it to `changes_requested` for the repair loop; `collectReplanFindings` reads only
`state.completion_review`, never `task.findings`.

**And this is precisely the observed failure.** `cli/formatters/run-formatter.ts:73-74` — the markdown
`critic:reject` prints, i.e. the critic's terminal output — reads:

> `- **Protocol Action**: Read-Only Auditor Invariant enforced. Yielding to Coordinator.`
> `- **Next Step**: Coordinator runs \`plan:replan\` to partition scopes and inject repair tasks …`

That instruction is prose in the critic's return value. Whoever spawned the critic receives it. If the
main thread spawned the critic — which G1 shows is the documented and encouraged arrangement — the
main thread receives an instruction to run `plan:replan`, with no coordinator anywhere in the loop.
That is the owner's bug, verbatim, produced by design rather than by accident.

---

## G4 — An agent that terminates without reporting is detected

**Verdict: absent for clean termination. Detection is 100% deadline-lapse, and validators and critics
produce no dead-agent event even then.**

`orchestrator/dead-agent-detector.ts:13` types the only reason code the system has:
`reason: "expired_lease_no_submission"`. Everything downstream keys off wall-clock expiry:

- `workflow/lease/recover-stale.ts:29` — `Date.parse(task.lease.expires_at) + graceSeconds*1000 <= now`
- `recover-stale.ts:52` — a validation survives while `Date.parse(entry.deadline_at) > now`
- `recover-stale.ts:69` — the critic expires on `Date.parse(critic.deadline_at) + grace <= now`

Nothing anywhere observes a subagent process. A grep for agent liveness across
`workflow/agents/**` and `orchestrator/**` returns nothing, and `contracts/agents.ts:19` gives grants
exactly two states: `export type AgentGrantStatus = "active" | "released";` — there is no "died",
"unreported" or "reclaimed". An agent that finishes its turn cleanly at minute 2 without calling the
CLI is indistinguishable from one still working until its lease lapses at minute 20.

**Worse: a validator or critic that dies produces no event at all.** `reclaimDeadAgents`
(`dead-agent-detector.ts:55-74`) builds its event list from `leasedTaskAgents` (tasks holding a
`lease`) and `leasedSubTaskIds` (branch sub-leases). Validations and the critic are reset silently
inside `recoverStale` and are never named. Proven — a task in `validating` whose validator started and
never returned a verdict, two hours past its deadline:

```
dead-agent events for a validator that never reported: []
task status after: submitted
validations after: null
supervision tick reclaimed: []
supervision tick escalatedNow: []
supervision tick changesRequested: []
```

The validator that vanished is never named, never counted, never escalated. `runSupervisionTick`
(`orchestrator/supervision-tick.ts:124-153`) reports it as a completely healthy pass.

**What does exist:** `orchestrator:supervise --watch` is a real, registered command
(`cli/registry/orchestrator.ts:40-113`) driving `supervision-watch.ts:98-114`'s tick loop into
`runSupervisionTick` → `reclaimDeadAgents` → `recoverStale`. That is a genuine timer-driven heartbeat
and it is wired. It is also (a) opt-in — nothing starts it, and `SUPERVISION.md:57-61` records that it
"has never been exercised on a real run"; (b) blind to everything except an expired implementer lease.

---

## G5 — A detected dead agent is re-woken with the same instructions plus a corrective

**Verdict: absent.**

`OrchestratorWatchdog.triggerAutoWake` (`orchestrator/watchdog.ts:180-235`) increments a counter,
emits an `auto_wake` event whose `details` is a string, and returns
`{ actionTaken, attempt, succeeded: true, message }`. It dispatches nothing and injects nothing. Its
only production caller is its own `setInterval` at `watchdog.ts:276`, inside `loop-runner.ts` — which
backs `orchestrator:run`, a command that by its own registry description "fails with INVALID_STATE"
unless the host injects a round executor. Outside that, `triggerAutoWake` appears only in tests.

`references/host-adapters.md:164` claims "The runtime safely revokes the expired token, transitions
the task back to `ready`, and re-dispatches it without human intervention." The first two clauses are
true (`recover-stale.ts:47-48`). The third is false and cannot be true: the harness never dispatches
an agent (Hard rule 6, `SKILL.md`). It transitions the task to `retry_ready` and waits for a
coordinator to notice.

There is no corrective-injection mechanism for a dead agent. The one thing in the tree that resembles
it is scoped elsewhere and does work: `packets/validation-round.ts:131` carries
`prove_these_hold: priorRoundDemands(input.task)` into the next validator packet, wired through
`packets/role-grant.ts:105-113`, so unanswered probe demands survive into the next round. That is
per-round evidence carry-forward for validators, not "you died without reporting; do it properly this
time."

---

## G6 — Completion cannot happen with open findings

**Verdict: enforced. This is the one that works.**

The blocking checks:

- `workflow/completion/review-issues.ts:97` — `if (review.status !== "clean") issues.push("completeness critic is not clean")`
- `review-issues.ts:98-99` — `for (const id of review.unresolved_finding_ids) issues.push(\`completeness critic has unresolved finding ${id}\`)`
- `workflow/completion/completion-state.ts:154-155` — `for (const finding of task.findings ?? []) if (finding.status === "open") issues.push(\`task ${task.id} has open finding ${finding.id}\`)`
- `completion-state.ts:152-153` — an unfinished validation blocks: `issues.push(\`task ${task.id} has an active validation\`)`

They are reached on the real path: `completeRun` (`workflow/completion/complete-run.ts:31-35`) runs
`completionIssues` as a preflight _before_ the auth-token check and throws
`INVALID_STATE: run is incomplete: …`. Proven at runtime — a run whose critic rejected with one open
finding, then `run:complete`:

```
run:complete REFUSED:
 run is incomplete: completion requirement is unproven: req-1; completeness critic is not clean;
 completeness critic has unresolved finding F-OPEN; completion findings review 1 lacks exact
 remediation; completion findings review 1 lacks re-review
```

---

## G7 — Every role reports through the CLI, positive or negative

**Verdict: absent. There are several states where an agent legitimately finishes having recorded
nothing, and the whole enforcement layer is opt-in.**

**The load-bearing hole: registration is optional, and skipping it disables every role check.**
`command-authority.ts:72-73` looks the acting agent up in the ledger and returns silently if it is not
there. Proven — an agent that never registered took a lease:

```
UNREGISTERED agent claimed task-core: leased
agent ledger after claim: []
```

`CHANNEL.md` states "Registration is non-negotiable"; no code enforces it. An agent that skips
`agent:register` is unbound by its role contract, invisible to the ledger, invisible to the
dead-agent detector, and invisible to the summary.

**Release records nothing.** `workflow/agents/grants.ts:328-364` (`releaseAgentGrant`) requires only
a non-blank `--reason`. Nothing checks that the agent produced a verdict, a finding, a command record
or an artifact. Proven:

```
validator released having recorded nothing: "released" done
```

**An unreleased grant blocks nothing.** `workflow/completion/transition-summary-issues.ts:34-42`
(`grantSummaryIssues`) only flags a _mismatch_ between `status` and `release_reason`. A grant left
`active` forever — the exact fingerprint of an agent that died — is not an issue, and
`transitionSummaryIssues` is called from `readiness-issues.ts:116` (critic:start's gate) but not from
`completion-state.ts`'s `completionIssues`, so it does not gate `run:complete` either.

**Four roles cannot register or release themselves at all.** From the `commands:` blocks:
`completeness-critic`, `repairer`, `sub-implementer`, `sub-validator` and `sub-investigator` have
`agent:report` but no `agent:register`/`agent:release`; `planner` has neither. Their lifecycle
depends entirely on a coordinator remembering to record it.

**There is no messaging channel at all.** A whole-tree grep for `inbox|mailbox|notify|notification|
SendMessage|milestone` across `scripts/src/` returns exactly one hit — `SendMessage` as a string in
`health/external-identifiers.ts:2`, a vendor-name exclusion list. Every handoff in this system is
pull-based: an agent learns something only by running a command. Nothing in the harness can wake
anybody, which is why the critic's "Yielding to Coordinator" is prose in a return value rather than a
transition.

**What is enforced on the positive path**, and is real:

- `cli/commands/task-review.ts:148` — `assertRoleArtifactPresent` refuses **either** verdict on a
  UI-classified task carrying no screenshot/DOM artifact.
- `workflow/review/pass-preconditions.ts:88-95` — `assertProbeSatisfied`, called at
  `record-review.ts:96`, refuses a pass with fewer than `MIN_ADVERSARIAL_PROBES` (default 1,
  `config/constants.ts:8`) recorded probe rounds.

So a validator that passes _must_ have recorded at least one probe. A validator that never starts, or
that starts and vanishes, owes nothing to anybody.

---

## Ranked: what the owner still needs, worst absence first

**1. Detect a clean termination, not just a lapsed deadline (G4).** This is the observed failure. The
harness cannot tell "working" from "died forty minutes ago", and for validators and critics it cannot
tell even after the deadline, because they generate no dead-agent event. Everything else on this list
is survivable if this one fires; nothing else on this list helps if it does not. Cheapest honest
first step: give `reclaimDeadAgents` events for expired validations and expired critics, so the
supervisor at least _names_ the agent that vanished.

**2. Make registration a precondition, not a courtesy (G7).** One `if` in
`command-authority.ts:65-75` — refuse a mutating command from an agent absent from the ledger —
converts G2 from "enforced if the agent cooperates" into "enforced". Without it every other rail in
this audit is opt-out. Pair it with a third grant status so a reclaimed agent is distinguishable from
a live one and from a clean release.

**3. Unblock findings → new work on the path that actually runs (G3).** Two small, independent fixes:
read `revalidation` (not `revalidation_gate`) in `plan-replan-findings.ts:60`, and decide what
`revision-guard.ts:134-138` should do when a repair task legitimately inherits a finished task's
requirement. Until then a completeness critic's findings are _structurally incapable_ of becoming
tasks, which is exactly why they end up as a report someone reads.

**4. Give the main thread something to hand off to (G1).** Either add a real `orchestrator` role to
`AGENT_ROLES` with its own contract, or — cheaper and truer to what exists — change
`orchestrate-formatter.ts:22-30` so step 1 is "spawn and register a coordinator; do none of the
following yourself", and make `roles/coordinator.md` the document the main thread is routed to.
Today the entry point instructs the main thread to do the work, so it does.

**5. Make the corrective real (G5).** `triggerAutoWake` returning `succeeded: true` for an action it
did not take is worse than not having it. Either delete it or make the re-issued packet carry the
prior attempt's abandonment reason the way `priorRoundDemands` already carries unanswered probes.

**6. Machine-check what `must_not` can carry (G2).** The commands grant already covers the important
half. The residue — "modify repository files to make a check pass" — is checkable against the diff
and the actor id, and nothing else in `must_not` is.

**7. G6 needs nothing.** It works; leave it alone.

---

## One correction to a sibling row

`QUEUE.md`'s item **#6** closes with a caveat owing work to `tests/integration/cli-plan-validate.test.ts`.
That file no longer exists — `tests/integration` was deleted in its entirety at `db6a07b`. The caveat
is obsolete and #6 is unqualified `RESOLVED`. Not edited here; it belongs to that item's owner.
