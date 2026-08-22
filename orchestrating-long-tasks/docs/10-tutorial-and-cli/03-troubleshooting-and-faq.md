# 03. Troubleshooting, Common Pitfalls & FAQ

> [!IMPORTANT]
> **HUMAN DEVELOPER REFERENCE ONLY**: This documentation is written for human engineers maintaining and evolving the skill. Autonomous LLM runtime subagents MUST NOT ingest these files directly into context; all operational directives, topology graphs, and task assignments MUST be queried exclusively through the Harness CLI.

[⬅ Previous: CLI Command Reference](./02-cli-command-reference.md) | [Master Table of Contents](../README.md)

---

## 🧯 Refusals You Will Actually Hit

Every message below is verbatim output from a real run. They are refusals, not bugs — each one is the
harness declining to record something it cannot stand behind.

### `.capsules must be gitignored before initializing a run`

`plan:init` will not create a capsule that git would track. Add `.capsules/` to `.gitignore` first.

### `compiled graph failed validation: gates[N].command must perform substantive verification`

A gate has to actually verify something. `bun test` with no target is refused; `bun test tests` is
accepted. This applies to `--completion-gate` as much as to task gates.

### `a plan must be applied before scheduling`

`queue:wave`, `queue:next` and `queue:pop` need a compiled plan. Run `plan:compile`.

### `plan:audit blocks compilation — <invariant>: <message>. Fix the plan, or pass --accept-audit …`

`plan:compile` runs `plan:audit`'s six structural invariants (A1 granularity, A3 gate-discrimination,
A4 false-barrier, A5 straggler, A6 whole-suite-gate — A2 is never evaluated, see the FAQ below) itself,
immediately before sealing, and refuses to proceed on any **blocking** finding. Either fix what the
message names, or accept it explicitly and record why:

```bash
bun harness.ts plan:compile --run .capsules/<run-id> --actor planner --completion-gate "…" \
  --accept-audit "<invariant-id>:<why this is fine>"
```

One `--accept-audit` per blocking invariant — there is no blanket override, and naming an invariant the
audit did not actually raise is refused: `--accept-audit names <id>, which the audit did not raise as
blocking; nothing to accept`.

### `dependency edge(s) without a declared justification: <task> -> <dep>. Pass plan:add --dep-reason …`

Every `--deps` edge needs a one-line reason (C6) or `plan:compile` refuses to seal, independently of
`plan:audit`'s own A4 false-barrier check on the same edge. Fix it at the source — declaring the
dependency again is not possible once it is in the buffer, so get the reason right at `plan:add` time:
`plan:add --deps <id> --dep-reason "<id>:<why this edge exists>"`.

### `plan validator must be independent from the coordinator or planner that produced the plan`

The same independence rule task-level `validator` gets against implementers, applied to the whole plan:
a `plan-validator` agent id cannot be the same id already registered as `coordinator` or `planner`. This
fires at `plan:validate-start`, not at `agent:register` — the grant itself is unconditional.

### `plan validation rejected this graph revision; replan and record a passing plan:review before any implementer or repairer can claim work`

A recorded `changes_requested` plan review against the **live** graph revision is a hard stop
`task:claim` enforces directly, for every implementer and repairer, regardless of who they are. There
is no override flag. Fix it by replanning (`plan:add` / `plan:compile`, which mints a new graph
revision) and dispatching a fresh plan-validator that records a passing `plan:review` against it. No
plan-validator dispatched at all is a different, unpenalized case — this only fires on an actual
recorded rejection.

### `a plan validation is already active for this graph revision` / `this validator already recorded a verdict for this graph revision`

Mirrors task-level validation: only one open plan-validation assignment exists per graph revision, and
a validator who already recorded a verdict against a revision cannot reopen it. A fresh `plan:compile`
or `plan:replan` (a new graph revision) is always reviewable again.

### `run_id must be an identifier, not a path: "<value>" still contains a path separator after stripping one optional ".capsules/" prefix`

`plan:init --run`/`--run-id` accepts a bare run id, or the same `.capsules/<run-id>` value every other
command's `--run` uses (exactly one such prefix is stripped). What it never accepts is a value that
still contains a path separator after that single strip — a run id is an identifier, not a path.

### `task <id> write scope (…) is byte-identical to its content at claim; nothing was written. Submit --no-op --reason "<why>" …`

`task:submit` compares a content digest of the write scope against the one `task:claim` recorded. A
byte-identical submission is refused unless the agent explicitly declares `--no-op --reason "<why this
needed no change>"`. Making a real change is the other fix. `--reason` without `--no-op`, or `--no-op`
without `--reason`, are refused as a caller mistake before the digest is even compared.

### `sub-task S-1 write scope … is not a proper subset of the parent scope …`

A branch must hand down **strictly less** than it holds. A parent scoped to a single file cannot
branch at all; give the task a directory scope if you expect it to subdivide.

### `validator must be independent from implementers`

Three separate causes, all enforced by `task:validate-start`:

1. The validator implemented the task.
2. The validator appears in the task's attempts.
3. **The validator already validated this task once.** A repair round needs a _fresh_ validator.

### `cannot pass <task>: N open finding(s) unanswered: …; answer each with --resolve <finding-id>=<command-id>`

`task:review --status pass` requires every open finding to be answered explicitly — probe demands and
defects alike. Use `finding:get --run <capsule>` to list them.

### `review check command C-… is not successful validator evidence for <task>`

`--checks` must be commands that (a) the validator itself ran, (b) exited 0, (c) are bound to this
task, and (d) match a mandatory gate. A **failing** gate run therefore cannot back a rejection: a red
gate is a repair situation, not a verdict.

### `task <id> has no compiled task-scope gate to prove; run plan:compile first` / `task <id> has no write scope to revert; nothing for gate:prove to falsify`

`gate:prove` needs a task that has actually been through `plan:compile` — it reverts the task's
_compiled_ write scope back to `--base` (default `HEAD`) in a scratch copy and runs the _compiled_
gate against it, so both have to exist first. It never runs at `plan:add` time, on purpose: before
`plan:compile`, the task's work does not exist yet, so reverting it would yield a scratch copy
identical to the current tree and every verdict would degenerate to "not falsifiable".

### `critic checks must be nonempty` / `critic independent check is invalid: C-…`

The completeness critic must run its own commands with `--actor <critic>` and **without** `--task`.
Task-bound commands and other agents' commands are not critic evidence.

### `requirement proof command is invalid: C-…`

Same rule for `--proofs-file` entries: each `kind: "command"` reference must be a command the critic
itself ran, unbound to a task.

### `clean completion review leaves requirements unproven: …`

Every requirement needs a proof entry. A requirement the critic did not prove is recorded `unproven`
and blocks completion; the harness will not mint a proof on the critic's behalf.

### `repository bytes changed after critic authorization`

`critic:start` binds the authorization to the repository bytes it inspected. Anything written to the
worktree afterwards — including a scratch `proofs.json` — invalidates it. Write the proofs payload
outside the repository, or re-run `critic:start`.

### `completed runs are terminal and cannot be mutated`

Release every agent grant **before** `run:complete`.

### `SyntaxError: JSON Parse error` after `--format json`

`--format json` was placed after `--`, so it went to the child process. Put it before the `--`.

---

## ❓ FAQ

### How many adversarial checks must a validator record before a pass?

`min_adversarial_probes = 1`. The mandatory check is a **probe** (`task:probe --demand …`) — a demand
for proof, not an accusation — so satisfying it never requires filing a defect nobody observed. A
probe does not consume the repair budget and does not reassign the implementer.

### How many repair rounds do I get?

`max_repair_rounds = 6` (config `harness.config.json`). On the sixth recorded rejection the task
becomes `escalated` rather than looping.

### What does `plan:audit` actually check, and is it mandatory?

Six structural invariants, always in the same order: **A1** granularity (one task quietly carrying
most of the plan's files), **A3** gate-discrimination (two disjoint-scope tasks sharing one gate that
can't tell them apart), **A4** false-barrier (a dependency edge between scope-independent tasks), **A5**
straggler (one task's effort estimate dwarfing the rest of its wave), and **A6** whole-suite-gate (a
task gate that runs the entire suite instead of proving its own scope). **A2** parallelism is declared
and reported `not_evaluated` on every run — the harness has no honest way to count how many distinct
entities a prompt names without guessing. You never call `plan:audit` yourself for it to take effect:
`plan:compile` runs it automatically and refuses to seal on any blocking finding, so it is mandatory in
that sense even though the standalone command is optional and purely informational.

### What is `gate:prove`, and when should I run it?

It answers one question a static heuristic can only guess at: does this task's gate actually fail when
the task's own work is reverted? It copies the repository into a scratch directory, reverts the task's
compiled write scope back to `--base` (default `HEAD`), runs the compiled gate there, and records
whether it exited non-zero (`falsifiable: true`) — all inside the throwaway copy, never touching the
real repository. Run it any time after `plan:compile`, most usefully on a gate `plan:audit`'s A3 or A6
flagged: a recorded falsifiable proof satisfies those two invariants in place of the static heuristic,
letting a legitimately broad or shared gate through without a `--accept-audit` override.

### What is the plan-validator, and do I have to dispatch one?

An independent adversary for the compiled plan itself — not a task's code, the plan's own
decomposition, dependency edges, gate discrimination and straggler risk (the same four questions
`plan:audit`'s findings feed into, now judged by a person or agent rather than a heuristic). It is
optional: most runs never dispatch one, and `task:claim` only ever blocks on an actual recorded
`changes_requested` verdict against the live graph revision, never on the mere absence of a review. If
you do dispatch one, do it before the first implementer claims work — the registry's own guidance is
"get a passing `plan:review` before dispatching any implementer."

### What is the difference between `task:probe` and `task:reject`?

|               | `task:probe`            | `task:reject`                                                         |
| :------------ | :---------------------- | :-------------------------------------------------------------------- |
| Claim         | "Prove X"               | "X is broken"                                                         |
| Finding class | `probe_demand`          | `defect`                                                              |
| Counter       | `probe_round` +1        | `repair_round` +1                                                     |
| Task status   | stays `validating`      | `changes_requested`                                                   |
| Graph edge    | `probe` (info/cyan)     | `pushback` (error)                                                    |
| Requires      | at least one `--demand` | `--severity`, `--remediation`, and the validator's own green gate run |

Both produce findings that must be answered with `--resolve` before a pass.

### My task legitimately needed no code change. How do I submit that honestly?

`task:submit --no-op --reason "<why this needed no change>"`. `task:submit` always compares a content
digest of the write scope against the one `task:claim` recorded, and a byte-identical scope is refused
unless `--no-op` is explicit — an unexplained non-change is indistinguishable from a stamped submission
that never did the work, so the harness never infers "nothing to do" on its own. `--reason` is required
alongside it and is recorded verbatim on the task record (`task.no_op`); an investigation task that
confirms existing code already satisfies its requirement is exactly the case this exists for.

### `queue:pop` or `queue:wave`?

`queue:wave` to see everything claimable right now; `queue:pop` to actually take one. The wave query
is read-only and never a batch to wait on — dispatch each row as an agent frees up, and re-run it the
instant one does. Looping `queue:pop` alone, one task at a time, is what turns a parallel graph into
a waterfall.

### An agent died holding a lease. Now what?

`recover --run <capsule> --actor <you>` returns expired leases to `retry_ready` (or
`changes_requested` after a repair attempt), reopens interrupted validations, reclaims branch
sub-tasks whose sub-agent died, and expires a stale critic. A _branched_ parent is never reaped — its
lease is frozen because it is blocked on children, not gone. For a voluntary hand-back use
`task:release` while the lease is still live.

### Why does the graph say my agent's model is "unknown"?

Because nobody reported one. Per-agent model, tier and thinking level come only from
`agent:register --model/--model-tier/--thinking-level` or `agent:report`. Nothing is inferred from
the machine that ran `summary:export`. Register your agents with the telemetry your host actually
knows, and it will appear.

### Can a validator branch to parallelise verification?

No. `branch:open` requires a live implementation lease and a validator holds a validation token, not
a lease. Dispatch a sub-validator with `agent:register` instead — but note the verdict's `--checks`
must still be the parent validator's own runs.

### Is there a command to grant or decline an authority-gated requirement?

Yes — `authority:decide --requirement <id> --decision grant|decline --rationale "<why>"`. Granting
makes the requirement actionable; declining disposes it `out_of_scope` and cancels every dormant task
that depends on it alone (refusing instead if that would invalidate a task already active or
completed). The decision is permanent: a repeat call with the same actor and rationale is idempotent,
any other call against an already-decided requirement is refused. See
[Chapter 02 §03](../02-requirements/03-authority-decisions-and-dispositions.md) for the full
`needs_authority` vocabulary and how a gated obligation reaches this state in the first place.

---

## ⚠️ Pitfalls

| Pitfall                             | Root cause                                                       | Fix                                                                                |
| :---------------------------------- | :--------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| Serial execution of a parallel plan | Dispatching with `queue:pop` in a loop                           | `queue:wave`, then one `task:claim` per agent                                      |
| `WRITE_SCOPE_VIOLATION` on submit   | Edited a file outside the lease                                  | Check the scope in `run:status`; request a revision instead of taking the path     |
| Task glued to the wrong requirement | `plan:add` without `--requirement-lines`                         | Bind the lines explicitly; the compiler warns when it glues by position            |
| Everything serialises unexpectedly  | Two scopes overlap, e.g. `docs/**` and `docs/concepts/**`        | Scope conflict is glob-aware; make the scopes genuinely disjoint                   |
| A task that can never branch        | Single-file write scope                                          | Give it a directory scope if subdivision is plausible                              |
| Gate marked stale at completion     | Files changed after the gate ran                                 | Re-run it through `run:exec` to capture a fresh `trusted_host_observed_v1` binding |
| Shell string passed as a gate       | `"bun test tests/*.ts"`                                          | Gates are literal argv: `bun harness.ts run:exec … -- bun test tests/foo.test.ts`  |
| Late `agent:release`                | Released after `run:complete`                                    | Close every grant before sealing                                                   |
| Critic authorization invalidated    | A file was written between `critic:start` and `critic:review`    | Keep scratch files out of the repository                                           |
| `plan:compile` refused unexpectedly | A blocking `plan:audit` finding, or an unjustified `--deps` edge | Read the finding; fix the plan, or `--accept-audit <id>:<reason>` / `--dep-reason` |
| Every `task:claim` refused mid-run  | A dispatched plan-validator recorded `changes_requested`         | Replan (new graph revision) and dispatch a fresh plan-validator that passes it     |
| Honest no-op submission refused     | `task:submit` with no real change and no `--no-op`               | Add `--no-op --reason "<why>"`, or make the change the scope actually requires     |

---

## 🧭 Master Navigation Hub

| Section | Chapter                                                                                | Primary topics                                            |
| :------ | :------------------------------------------------------------------------------------- | :-------------------------------------------------------- |
| **01**  | [Foundations & Architecture](../01-foundations/01-why-long-tasks-fail.md)              | Failure modes, run capsule, the lifecycle.                |
| **02**  | [Requirements & Dispositions](../02-requirements/01-prompt-capture-and-integrity.md)   | Prompt integrity, line disposition, authority vocabulary. |
| **03**  | [Graph & Scheduler](../03-graph-scheduler/01-dependency-graph-theory.md)               | DAG theory, `proposeBatch`, recorded topology, revisions. |
| **04**  | [Multi-Agent Deployment](../04-multi-agent/01-host-agnostic-architecture.md)           | Tiers, the ten roles, grants, bearer tokens.              |
| **05**  | [Task Lifecycle & Execution](../05-task-execution/01-leasing-and-heartbeats.md)        | Leases, write scopes, `task:submit`, `run:exec`.          |
| **06**  | [Validation & Repair](../06-validation-repair/01-adversarial-validation-philosophy.md) | Probe vs defect, finding schema, 6-round budget.          |
| **07**  | [Gates & Completion](../07-gates-and-completion/01-mandatory-gate-systems.md)          | Gate contracts, critic protocol, terminal checklist.      |
| **08**  | [Durability & Recovery](../08-durability-recovery/01-tamper-proof-hash-chains.md)      | Hash chains, flock/fdatasync, torn tail quarantine.       |
| **09**  | [Branching & Honesty](../09-branching-and-honesty/01-execution-time-branching.md)      | Branch-and-collect, agent ledger, evidence classes.       |
| **10**  | [Tutorial & CLI Reference](./01-end-to-end-tutorial.md)                                | Executable tutorial, generated manifest, this page.       |

---

[⬅ Previous: CLI Command Reference](./02-cli-command-reference.md) | [Master Table of Contents](../README.md)
