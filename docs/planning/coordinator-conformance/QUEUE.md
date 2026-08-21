# Queue: what is running, what is next, and the standing rules

Live working state for the coordinator-conformance arc. `FORENSICS.md` holds the evidence,
`DESIGN.md`/`RAILS.md`/`CHANNEL.md` hold the specifications. This file holds the order of work and the
rules that apply to every wave.

## Standing rules

1. **Docs are the last stage of every loop.** No phase is finished until the documentation reflects
   what the code now does. Owner's words: _"after each process docs should be always up to date"_.
2. **Every sub-phase must land committable and pushable** — unit lane green, typecheck clean, lint
   clean, format clean. Never a suppression, a skip, a weakened assertion or a rule change to get
   there. Fix the problem.
3. **Never assume; verify.** Open the file, run the command, read the output. A claim that was not
   executed is not a result.
4. **Findings become queue items.** Anything discovered mid-wave that is out of that wave's scope is
   appended here rather than fixed opportunistically or forgotten.
5. **Comments are relocated, not deleted.** Contract knowledge in a comment moves into the docs before
   the comment is removed; a comment marking unfinished work is removed only after the work is done.

## Ranked backlog

Ordering reasoning: nothing else is observable until the installed runtime matches the source, so C11
precedes everything. C3b then does triple duty — gate discrimination, the validation evidentiary
floor, and partial write-scope truthfulness — using code that already exists and is already correct.

| #   | Item                                                                    | Status | Why here                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **C11 — installed-runtime freshness**                                   | queued | All five live capsules show `plan-audited=0`, `gate-proved=0`. Both trees report `RUNTIME_VERSION "0.1.0"` so nothing can detect drift. `installer/installation-status.ts` + `identity.ts:48` already digest the source tree; call them from `orchestrate`/`plan:init`, not only from `doctor`. Installing the current build also delivers the 429/backoff handling and the dual-channel UI refusal, both of which already exist and neither of which is installed. |
| 2   | **C3b — `gate:prove` at `task:review`**, `base` = sha recorded at claim | queued | At compile there is no work to revert, so the proof is incoherent there. At review all three inputs exist: a sealed gate, real work, a baseline. Make a `falsifiable: true` proof a precondition beside `assertProbeSatisfied`. Closes gate discrimination, the validation gap, and — because reverting a _declared_ scope leaves out-of-scope work standing — partially enforces scope truthfulness.                                                               |
| 3   | **C10 — out-of-band edit detection**                                    | queued | `write_scope` is declared, never enforced: `build-report.ts:34-38` discards the harness's own observation when the agent declares a list. `packets/round-repository-delta.ts:62-70` already runs the exact `git diff`; add `--name-only`, subtract the union of scopes, surface the remainder. ~40 lines on existing machinery.                                                                                                                                     |
| 4   | **The heartbeat**                                                       | queued | `recoverStale` is correct and deliberately re-entrant, but the only `setInterval` in the tree is the watchdog and it never touches a lease. `supervisor.ts:255-257` returns `single_tick` without a dispatcher. **No role contract grants `orchestrator:run` or `orchestrator:supervise`.** Without this, nothing recovers while the operator is away.                                                                                                              |
| 5   | **R1/R2 — role output contracts and the empty-evidence refusal**        | queued | Per-role required output shape, checked at the CLI boundary. A UI validator needs screenshots _regardless of verdict_. Where substance cannot be judged, require an artifact (a command record, a file with non-zero bytes, a hash) rather than a sentence.                                                                                                                                                                                                         |
| 6   | **R4 — the coordinator → validator pushback edge**                      | queued | All pushback today flows validator → implementer. The edge that would have caught the UI failure does not exist. Needs its own edge kind in `graph.json`. Two causes must be expressible: substantive (the work is wrong) and procedural (it was not registered, or registered wrongly).                                                                                                                                                                            |
| 7   | **Make `plan:apply` reachable**                                         | queued | The frozen-goal growth path is the best-designed code in the subsystem (`revision-guard.ts:75-83` refuses a requirement-contract change while leaving task addition unrestricted) and it is unreachable: `packets/planner-packet.ts:32,40,57` hardcodes revision 0, and `plan:apply` is absent from `roles/coordinator.md`.                                                                                                                                         |
| 8   | **A2 — replace the permanent stub**                                     | queued | `auditPlan` always emits A2 as `not_evaluated`, so a one-task plan whose scope names a not-yet-existing directory compiles with zero findings — the exact forensics shape. Its stated excuse (no entity count available) is refuted by `requirements/compiler.ts:44-49`, which already computes `nonBlankLineIndices` from the immutable prompt.                                                                                                                    |
| 9   | **A3 — compare gate structure, not bytes**                              | queued | `plan-audit.ts:129` is exact string equality, so appending `--scope=t0` manufactures fake discrimination. Compare `(executable, subcommand, target set)`.                                                                                                                                                                                                                                                                                                           |
| 10  | **`plan:review` evidentiary floor**                                     | queued | `approved` legally carries zero commands by design, so an entire compiled plan is approvable on four free-text sentences — materially weaker than `task:review`.                                                                                                                                                                                                                                                                                                    |
| 11  | **Data-model unification**                                              | queued | `screenshots` is a lossy projection of `screenshot_records` (`reporting/command-evidence.ts:21-22`). `inspection-formatter.ts:61` reads `status ?? verdict ?? decision ?? "unknown"` — three names for one concept plus a fabricated literal. The alias is banned; delete it.                                                                                                                                                                                       |
| 12  | **Audit the 16 integration tests**                                      | queued | Nothing currently gates on `tests/integration`, so their correctness is unverified.                                                                                                                                                                                                                                                                                                                                                                                 |

## In flight

- **test-lane** — clear the last 10 unit failures, then classify every slow test by nature (not speed)
  and rewrite or move accordingly, under a deterministic isolation contract.
- **hygiene-and-docs** — root cleanup, comment audit across all 20 source directories, docs rewrite.

## Settled, do not re-litigate

- Dispatch is continuous per-task readiness. There is **no wave barrier** —
  `scheduler/propose-batch.ts:66-72` filters each task against its own `depends_on`;
  `ready-set.ts:11-13` states the recorded topology is a display annotation only.
- The frozen goal **is** enforced (`revision-guard.ts:75-83`).
- `assertValidatorCommands(requireAllGates=true)` genuinely prevents a validator rubber-stamping
  without running every mandatory gate under its own actor id.
- PASS is the most heavily guarded transition in the codebase, not the least.
- The `converged_success` fabrication came from the harness's own `defaultExecuteRound`, not from an
  agent. The source tree has already deleted that path; the installed build has not.

---

## R7–R10: the context-burn defect (added 2026-08-20)

### The observation

A live trace of a small model starting a run on another repository:

```
harness.ts --help                          ← correct
harness.ts help                            ← correct
Read harness.ts                            ← defect
Read src/cli/execute.ts                    ← defect
Read SKILL.md  (from ~/.gemini/...)
Read agents/coordinator.yaml
harness.ts plan:init --run capture-nextgen-expansion
Read src/cli/commands/plan.ts              ← defect (after plan:add failed)
harness.ts plan:add ...                    ← failed
Read src/cli/commands/plan.ts              ← defect (again)
harness.ts plan:add --run .capsules/...    ← succeeded, having learned the form from source
harness.ts plan:compile                    ← failed
Read graph/compiler.ts                     ← defect
Read graph/validate-graph.ts               ← defect
Read graph/validate-gates.ts               ← defect
Read graph/gate-command-policy.ts   (×2)   ← defect
Read graph/gate-runtime-grammar.ts  (×2)   ← defect
```

Roughly 100k tokens of harness source consumed before any task work began, and the cost scales with
the size of the skill rather than the size of the user's job.

### The mechanism, and why the model is not at fault

The pattern is exact: **the model reads source only after a command fails.** It runs the command, gets
an error, cannot act on the error, and goes to the source to derive what the harness wanted. Reading
`plan.ts` is how it discovered that `--run` takes the `.capsules/<id>` form; reading the four gate
files is how it tried to discover what gate command would be accepted.

This is the same root cause `RAILS.md` already identified for a different symptom:

> A refusal without a prescribed repair is a defect. A weak model refused with no path forward does
> not re-plan.

There it went *around* the harness by editing files directly. Here it goes *into* the harness by
reading its source. One cause, two symptoms.

Note what is NOT the problem: `harness.ts help plan:add` already emits a complete, excellent contract —
every flag, type, requirement, default, mutual exclusion, and worked examples. Better help would not
have prevented this, because the model already ran `help` twice at the start. The gap is entirely in
what happens when a command is *refused*.

Verified: grepping the source for any error carrying a suggested next command returns essentially
nothing. Errors state what was rejected; none state what to run instead.

### R7 — Errors prescribe, they never merely diagnose

Every refusal carries three parts, and the third is currently missing everywhere:

| part | today | required |
|---|---|---|
| **what** was rejected | yes | yes |
| **why** — the rule violated | partly | yes |
| **fix** — the literal argv to run instead, fully formed with real ids | **no** | **yes** |

Where the harness can compute the fix it must. A gate rejection is the clearest case: `discoverGatePaths`
(`graph/gate-breadth.ts`) already enumerates real on-disk paths for a write scope and is already used
to suggest them elsewhere. A scope-gate refusal should end with the exact `plan:add` line that would
be accepted, not a description of the rule it broke.

### R8 — State the prohibition where it is read, and give the alternative

`SKILL.md` already carries a "Never read" column, but the running agent loaded a 395-line SKILL.md from
a stale install that predates it. So the prohibition must also live where a failing agent is
guaranteed to look: **in the error itself**. Every error footer carries one line — never read the
harness source; run `harness.ts help <command>` or `harness.ts explain <code>`.

### R9 — `harness.ts explain <error-code>`

A command that expands any error code into its full rule, its rationale, and its remedy. This gives a
refused model a *command to run* in place of a *file to read*, which is the substitution the whole
item exists to make.

### R10 — Runtime freshness must cover every install root

Three install roots exist on this machine, all dated 2026-08-19, all carrying the superseded 395-line
SKILL.md:

```
~/.agents/skills/orchestrating-long-tasks          395L SKILL.md, 327 .ts
~/.gemini/config/skills/orchestrating-long-tasks   395L SKILL.md,   0 .ts
~/.claude/skills/orchestrating-long-tasks          395L SKILL.md,   0 .ts
repo                                               148L SKILL.md, 510 .ts
```

Two of them ship documentation with no scripts, which is how the trace ended up reading `SKILL.md`
from `.gemini` while executing `harness.ts` from `.agents` — **two different roots, independently
stale, with nothing able to notice.** C11 must digest and report every root it can find, not one.
