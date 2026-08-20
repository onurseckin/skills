# 03. Troubleshooting, Common Pitfalls & FAQ

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

### `queue:pop` or `queue:wave`?

`queue:wave` unless you have a reason. It returns the whole conflict-free wave so N agents can be
dispatched in one batch; `queue:pop` hands out one task and is what turns a parallel graph into a
waterfall. `queue:wave` is read-only — each dispatched agent still claims its own task.

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

Not today. The vocabulary exists in state (`needs_authority`, `granted`/`declined`, `out_of_scope`)
and completion honours it, but no CLI command records a decision, and `plan:compile` version 1 emits
only `requirement` and `context` dispositions. See
[Chapter 02 §03](../02-requirements/03-authority-decisions-and-dispositions.md) for how to keep an
authority-gated obligation out of the compiled plan honestly.

---

## ⚠️ Pitfalls

| Pitfall                             | Root cause                                                    | Fix                                                                                |
| :---------------------------------- | :------------------------------------------------------------ | :--------------------------------------------------------------------------------- |
| Serial execution of a parallel plan | Dispatching with `queue:pop` in a loop                        | `queue:wave`, then one `task:claim` per agent                                      |
| `WRITE_SCOPE_VIOLATION` on submit   | Edited a file outside the lease                               | Check the scope in `run:status`; request a revision instead of taking the path     |
| Task glued to the wrong requirement | `plan:add` without `--requirement-lines`                      | Bind the lines explicitly; the compiler warns when it glues by position            |
| Everything serialises unexpectedly  | Two scopes overlap, e.g. `docs/**` and `docs/concepts/**`     | Scope conflict is glob-aware; make the scopes genuinely disjoint                   |
| A task that can never branch        | Single-file write scope                                       | Give it a directory scope if subdivision is plausible                              |
| Gate marked stale at completion     | Files changed after the gate ran                              | Re-run it through `run:exec` to capture a fresh `trusted_host_observed_v1` binding |
| Shell string passed as a gate       | `"bun test tests/*.ts"`                                       | Gates are literal argv: `bun harness.ts run:exec … -- bun test tests/foo.test.ts`  |
| Late `agent:release`                | Released after `run:complete`                                 | Close every grant before sealing                                                   |
| Critic authorization invalidated    | A file was written between `critic:start` and `critic:review` | Keep scratch files out of the repository                                           |

---

## 🧭 Master Navigation Hub

| Section | Chapter                                                                                | Primary topics                                            |
| :------ | :------------------------------------------------------------------------------------- | :-------------------------------------------------------- |
| **01**  | [Foundations & Architecture](../01-foundations/01-why-long-tasks-fail.md)              | Failure modes, run capsule, the lifecycle.                |
| **02**  | [Requirements & Dispositions](../02-requirements/01-prompt-capture-and-integrity.md)   | Prompt integrity, line disposition, authority vocabulary. |
| **03**  | [Graph & Scheduler](../03-graph-scheduler/01-dependency-graph-theory.md)               | DAG theory, `proposeBatch`, recorded topology, revisions. |
| **04**  | [Multi-Agent Deployment](../04-multi-agent/01-host-agnostic-architecture.md)           | Tiers, the nine roles, grants, bearer tokens.             |
| **05**  | [Task Lifecycle & Execution](../05-task-execution/01-leasing-and-heartbeats.md)        | Leases, write scopes, `task:submit`, `run:exec`.          |
| **06**  | [Validation & Repair](../06-validation-repair/01-adversarial-validation-philosophy.md) | Probe vs defect, finding schema, 6-round budget.          |
| **07**  | [Gates & Completion](../07-gates-and-completion/01-mandatory-gate-systems.md)          | Gate contracts, critic protocol, terminal checklist.      |
| **08**  | [Durability & Recovery](../08-durability-recovery/01-tamper-proof-hash-chains.md)      | Hash chains, flock/fdatasync, torn tail quarantine.       |
| **09**  | [Branching & Honesty](../09-branching-and-honesty/01-execution-time-branching.md)      | Branch-and-collect, agent ledger, evidence classes.       |
| **10**  | [Tutorial & CLI Reference](./01-end-to-end-tutorial.md)                                | Executable tutorial, generated manifest, this page.       |

---

[⬅ Previous: CLI Command Reference](./02-cli-command-reference.md) | [Master Table of Contents](../README.md)
