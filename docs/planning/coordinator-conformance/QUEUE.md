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
| 1   | **C11 — installed-runtime freshness**                                   | **in flight** | All five live capsules show `plan-audited=0`, `gate-proved=0`. Both trees report `RUNTIME_VERSION "0.1.0"` so nothing can detect drift. `installer/installation-status.ts` + `identity.ts:48` already digest the source tree; call them from `orchestrate`/`plan:init`, not only from `doctor`. Installing the current build also delivers the 429/backoff handling and the dual-channel UI refusal, both of which already exist and neither of which is installed. |
| 2   | **C3b — `gate:prove` at `task:review`**, `base` = sha recorded at claim | **in flight** | At compile there is no work to revert, so the proof is incoherent there. At review all three inputs exist: a sealed gate, real work, a baseline. Make a `falsifiable: true` proof a precondition beside `assertProbeSatisfied`. Closes gate discrimination, the validation gap, and — because reverting a _declared_ scope leaves out-of-scope work standing — partially enforces scope truthfulness.                                                               |
| 3   | **C10 — out-of-band edit detection**                                    | **in flight** | `write_scope` is declared, never enforced: `build-report.ts:34-38` discards the harness's own observation when the agent declares a list. `packets/round-repository-delta.ts:62-70` already runs the exact `git diff`; add `--name-only`, subtract the union of scopes, surface the remainder. ~40 lines on existing machinery.                                                                                                                                     |
| 4   | **The heartbeat**                                                       | **in flight** | `recoverStale` is correct and deliberately re-entrant, but the only `setInterval` in the tree is the watchdog and it never touches a lease. `supervisor.ts:255-257` returns `single_tick` without a dispatcher. **No role contract grants `orchestrator:run` or `orchestrator:supervise`.** Without this, nothing recovers while the operator is away.                                                                                                              |
| 5   | **R1/R2 — role output contracts and the empty-evidence refusal**        | queued | Per-role required output shape, checked at the CLI boundary. A UI validator needs screenshots _regardless of verdict_. Where substance cannot be judged, require an artifact (a command record, a file with non-zero bytes, a hash) rather than a sentence.                                                                                                                                                                                                         |
| 6   | **R4 — the coordinator → validator pushback edge**                      | queued | All pushback today flows validator → implementer. The edge that would have caught the UI failure does not exist. Needs its own edge kind in `graph.json`. Two causes must be expressible: substantive (the work is wrong) and procedural (it was not registered, or registered wrongly).                                                                                                                                                                            |
| 7   | **Make `plan:apply` reachable**                                         | **in flight** | The frozen-goal growth path is the best-designed code in the subsystem (`revision-guard.ts:75-83` refuses a requirement-contract change while leaving task addition unrestricted) and it is unreachable: `packets/planner-packet.ts:32,40,57` hardcodes revision 0, and `plan:apply` is absent from `roles/coordinator.md`.                                                                                                                                         |
| 8   | **A2 — replace the permanent stub**                                     | **in flight** | `auditPlan` always emits A2 as `not_evaluated`, so a one-task plan whose scope names a not-yet-existing directory compiles with zero findings — the exact forensics shape. Its stated excuse (no entity count available) is refuted by `requirements/compiler.ts:44-49`, which already computes `nonBlankLineIndices` from the immutable prompt.                                                                                                                    |
| 9   | **A3 — compare gate structure, not bytes**                              | **in flight** | `plan-audit.ts:129` is exact string equality, so appending `--scope=t0` manufactures fake discrimination. Compare `(executable, subcommand, target set)`.                                                                                                                                                                                                                                                                                                           |
| 10  | **`plan:review` evidentiary floor**                                     | queued | `approved` legally carries zero commands by design, so an entire compiled plan is approvable on four free-text sentences — materially weaker than `task:review`.                                                                                                                                                                                                                                                                                                    |
| 11  | **Data-model unification**                                              | **in flight** | `screenshots` is a lossy projection of `screenshot_records` (`reporting/command-evidence.ts:21-22`). `inspection-formatter.ts:61` reads `status ?? verdict ?? decision ?? "unknown"` — three names for one concept plus a fabricated literal. The alias is banned; delete it.                                                                                                                                                                                       |
| 12  | **Audit the 16 integration tests**                                      | queued | Nothing currently gates on `tests/integration`, so their correctness is unverified.                                                                                                                                                                                                                                                                                                                                                                                 |
| 13  | **R7 — errors prescribe, never merely diagnose**                        | **in flight** | Four attempts to run `plan:init`; a small model burned ~100k tokens reading source because refusals name the condition, not the repair. |
| 14  | **R8 — never-read-source footer on every error**                        | **in flight** | The prohibition must live where a failing agent looks. |
| 15  | **R9 — `harness.ts explain <code>`**                                    | **in flight** | Gives a refused model a command to run instead of a file to read. |
| 16  | **R10 — freshness across every install root**                           | **in flight** | Three roots exist; two ship docs with zero scripts. |
| 17  | **R11 — semantic file equality, formatting is never a difference**      | queued | A formatter run must not read as a changed file. Already broke digests and the generated manifest today. Load-bearing for C4 and C10, which hash bytes. See the R11 section below. |

## Reconciliation protocol (added 2026-08-20)

**Before working any queued item, first establish that it is still real.** Open the files it cites,
run the commands it cites, and decide: still real / already fixed / obsolete. Delete the obsolete
ones from this file rather than leaving them tagged.

Run reconciliation as its own pass, after a wave lands and the repo is stable — never interleaved
with implementation, because a tree mid-edit cannot answer "is this still true".

This exists because stale entries cause rework. `BACKLOG.md`'s own B37 records the same failure:
*"items verified genuinely done stay marked `queued` forever, causing rework and stale blocker
claims."* As of today, 19 of that file's 41 items are tagged `queued` and an unknown number are
already satisfied.

**Next reconciliation is owed against:** the uncovered items below (5, 6, 10, 12, 17) and all 19
`queued` items in `../orchestration-overhaul/BACKLOG.md` — B3, B4, B8, B9, B15, B17, B18, B20, B21,
B22, B26, B32, B33, B35, B37, B38, B39, B40, B41.

## Landed in the harness-honesty wave, not previously recorded here

Three defects found by forensics on the `limo` capsule and discussed directly with the owner. They
were implemented before being queued, so they are recorded here for completeness:

| Item | Evidence |
|---|---|
| **Requirement fold refuses** | A 487-byte single-line prompt naming ~13 concerns produced ONE requirement carrying FOUR acceptance criteria, each "Task gate `<X>` passes with exit code 0". `compiler.ts` folds surplus tasks into the first requirement via `nonBlankLineIndices[taskIdx % length]`. The harness already warned; the warning is now a refusal. Gate-as-acceptance (the silent third fallback) now warns loudly, and becomes conditional on a falsifiability proof once C3b lands. |
| **Projection checkpointing** | `events.jsonl` measured at 4,613,371 bytes over 66 events; the `projection` field is 103.7% of that by JSON size. Real event content totals ~17KB — the signal is 0.4% of the file. Replaced with periodic checkpoints plus replay. |
| **Unclosed attempts** | Three of four tasks in the `limo` run reached `done` holding an implementation attempt with `started_at` and no `submitted_at`. A terminal transition now refuses while an attempt is open; abandonment is an explicit attributed state. |

## R11 — File equality must be semantic, not byte-level (added 2026-08-20)

### The requirement

> "If a formatter runs and a row/column alignment changes, or it gets some additional spacing, that
> should not be registered as a different file. File equality should be handled by the content of the
> code — parsed and trimmed — so that additional spacing or alignment changes are not considered a
> difference."

The skill should not need to intervene in a repository's own formatting setup. It should be
*indifferent* to formatting instead.

### It has already caused two real failures, both today, both in this repository

**1. Digested checklists.** `bun run format` (bare `oxfmt`, no path restriction) re-indented list
items in `orchestrating-long-tasks/checklists/*.md` — `  - ` became `- `, plus blank lines. A
`git diff --word-diff` showed **zero word-level changes**. Five contract-digest tests failed, because
those files' bytes are hashed into validator domain contracts.

**2. The generated CLI manifest.** The same command reformatted
`references/cli-capabilities.md`, producing **484 insertions and 485 deletions** with no semantic
change, and breaking the freshness test that compares the checked-in file against the registry
render. This silently failed three consecutive pushes before the cause was found.

Both were worked around by adding ignore patterns to `.oxfmtrc.json`. That is a patch on one
formatter in one repository — it does not generalise to a consumer repo the skill is dropped into.

### Where byte-equality is currently load-bearing

Every one of these would report a false difference after a formatter run:

| Mechanism | What it hashes |
|---|---|
| contract digests | role and checklist document bytes |
| `prompt_sha256` | the immutable prompt |
| C4 write-scope content hash | the declared scope at claim vs submit |
| C10 drift detection | working tree vs the union of declared scopes |
| repository binding / inspection | `current_repository_inspection_sha256` |
| `gate:prove` | a reverted scratch copy against the working tree |

C4 and C10 are the dangerous pair. A repo-wide format run between claim and submit would read as
"this task wrote the whole repository", and a format run inside a scope would read as work where none
happened.

### Design direction

Introduce one content-normalisation layer that every hash and comparison routes through, with a
canonicaliser per known format and an honest fallback:

- **JSON / JSONL** — parse, canonicalise key order and whitespace, hash the canonical form.
- **YAML** — parse and canonicalise.
- **TS / JS** — normalise whitespace outside string and template literals. Do NOT attempt to run the
  consumer's formatter; that couples the harness to a toolchain it does not own.
- **Everything else** — byte equality, unchanged.

**Record which normalisation was applied.** "Equal under JSON canonicalisation" and "byte-identical"
are different claims and the evidence spine already has the vocabulary to say so. Collapsing them
would be the same dishonesty this project keeps removing.

### The trap to avoid

Normalisation must never hide a real change. Whitespace is semantic in more places than it looks:
Markdown list indentation changes nesting, YAML indentation changes structure, Python indentation
changes control flow, and inside a template literal a space is data. A canonicaliser that trims too
eagerly turns a correctness mechanism into a blind spot — which is worse than the false positives it
set out to fix. Prefer a conservative canonicaliser per format over a general whitespace stripper,
and byte-equality wherever the format is unknown.

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

There it went _around_ the harness by editing files directly. Here it goes _into_ the harness by
reading its source. One cause, two symptoms.

Note what is NOT the problem: `harness.ts help plan:add` already emits a complete, excellent contract —
every flag, type, requirement, default, mutual exclusion, and worked examples. Better help would not
have prevented this, because the model already ran `help` twice at the start. The gap is entirely in
what happens when a command is _refused_.

Verified: grepping the source for any error carrying a suggested next command returns essentially
nothing. Errors state what was rejected; none state what to run instead.

### R7 — Errors prescribe, they never merely diagnose

Every refusal carries three parts, and the third is currently missing everywhere:

| part                                                                  | today  | required |
| --------------------------------------------------------------------- | ------ | -------- |
| **what** was rejected                                                 | yes    | yes      |
| **why** — the rule violated                                           | partly | yes      |
| **fix** — the literal argv to run instead, fully formed with real ids | **no** | **yes**  |

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
refused model a _command to run_ in place of a _file to read_, which is the substitution the whole
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
