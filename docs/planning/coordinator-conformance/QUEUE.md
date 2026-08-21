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

Reconciled 2026-08-20. Every row below was checked against current code by opening the file or
running the command it cites. Twelve rows that were tagged **in flight** are gone: their waves
landed and were verified wired, not merely written. Four items were deleted outright. Four new
defects found during the pass are folded into the ranking and carry their evidence below the table.

**Ordering reasoning.** The gate comes first: CI has been dead long enough that a whole test lane
rotted behind it, so #1-#3 restore the ability to notice anything at all. #4-#6 are the evidentiary
floor — R11 is promoted above the rest because C4 and C10 both landed today and both hash raw bytes,
which makes a formatter run indistinguishable from a scope violation. Everything below that is
ranked by how much of the run's honesty depends on it. #23 is last by construction.

`Source` says where the evidence lives: `Q<n>` is this file's own numbering before reconciliation,
`B<n>` is a section in `../orchestration-overhaul/BACKLOG.md`, `new` is this pass.

| #   | Item                                                      | Source    | Why it is still here                                                                                                 |
| --- | --------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | **CI runs a path that does not exist**                    | new       | No push has been validated since the suite moved to `tests/`. One line to fix; nothing below stays fixed without it. |
| 2   | **Repair the integration lane**                           | Q12       | Verified broken today: 45 of 815 fail, all from two refusals that landed today without updating the fixtures.        |
| 3   | **CI coverage floor**                                     | B9.1      | Blocked on #1 — a workflow that cannot run the suite cannot put a floor under it.                                    |
| 4   | **R11 — file equality must be semantic**                  | Q17       | C4 and C10 both landed today and both hash raw bytes, so a formatter run now reads as a scope violation.             |
| 5   | **R1/R2 — role output contracts, empty-evidence refusal** | Q5        | The UI-screenshot mandate fires only on the pass path, and UI-ness is still inferred from file extensions.           |
| 6   | **`plan:review` evidentiary floor**                       | Q10       | An entire compiled plan is still approvable on zero commands and four free-text sentences.                           |
| 7   | **Telemetry points at the wrong reporter**                | B32 + B38 | `host_reported` is declared and never assigned; neither live capsule has an `agents` key. Absorbs B38.               |
| 8   | **"Open the artifact, do not reason about it"**           | B33       | The rule reached 2 of 15 role contracts. Cheapest high-value item here.                                              |
| 9   | **Transition ↔ summary bijection**                        | B21       | The per-event refusals landed; the "every transition has a summary" check was never written.                         |
| 10  | **Per-validator quality metrics**                         | B20.4     | Quality metrics are run-wide only — never per agent, never per validator.                                            |
| 11  | **R4 — the coordinator → validator pushback edge**        | Q6        | Every pushback edge is still validator → implementer; a coordinator cannot reject a verdict.                         |
| 12  | **Worktree isolation, three gaps**                        | B22       | Landed and wired, but defaults off, ships 2 of #2's failures, and B22.5 was never implemented.                       |
| 13  | **`RunFacts.steps` is produced and read by nothing**      | B15       | gvui's own test says it: the harness emits step provenance and no UI consumes it.                                    |
| 14  | **Asset dimensions and byte size**                        | B3        | The completeness contract still never asserts them.                                                                  |
| 15  | **Strike two sentences from `SPEC.md`**                   | B4        | Code is done; only the two backward-compatibility sentences survive. Two-line deletion.                              |
| 16  | **`abandonAttempt` is unreachable**                       | new       | Fully implemented, zero call sites — and a live error message tells operators to call it.                            |
| 17  | **The health tool has a false positive**                  | new       | Reports `store/index.ts` as unimported when 45 production modules import it.                                         |
| 18  | **`BACKLOG.md` citation drift**                           | new       | Intent drift is at 35 failures, up from 26 — this pass's own notes quoted the old paths.                             |
| 19  | **gvui duplication**                                      | B8.3      | `wasmLayoutAdapter` is unimported; `getNodeRepairRounds` is duplicated verbatim in two diff engines.                 |
| 20  | **Sweep the consumer for literal fallbacks**              | B37 (13)  | Health output still says verbatim that the consumer was never swept.                                                 |
| 21  | **The reporting contract has no durable home**            | B41 (3)   | It exists in no committed file in either repo.                                                                       |
| 22  | **`process-group.ts` grace race**                         | B35       | Survives only on the owner decision it names: the grace wait is still a bare `setTimeout` race.                      |
| 23  | **The final audit gate**                                  | B17       | Last by construction; its precondition — everything else done — is still false.                                      |

### The four new items, with their evidence

These have no section anywhere else, so their evidence lives here.

**#1 — CI runs a path that does not exist.** `.github/workflows/ci.yml:23` is
`run: bun test orchestrating-long-tasks/scripts/tests`. That directory does not exist and, per
`git log`, never has — the suite has always lived at repo-root `tests/`. Running the exact CI
invocation locally exits 1 with _"The following filters did not match any test files"_. Because the
step fails, the `Typecheck` step at line 26 never runs either. **GitHub-side CI has been reporting
failure on every push regardless of code correctness, and has validated nothing.** This is the
single cause behind #2, #3 and #18: three separate kinds of rot accumulated behind a gate that was
never closed.

**#16 — `abandonAttempt` is unreachable.** `workflow/lease/abandon.ts:6` exports a complete,
transactional `abandonAttempt` — it closes the attempt, deletes the lease and transitions the task.
`grep` finds exactly two mentions in the whole tree: its own definition, and
`workflow/lease/attempt-state.ts:39`, which throws a `HarnessError` reading _"…or call
abandonAttempt to close it explicitly before the task can \<verb\>"_. No CLI command invokes it
under any name; `branch:abandon` is a different mechanism. An operator who does exactly what the
harness tells them to do cannot comply. Either give it a command or stop naming it in the error.

**#17 — the health tool has a false positive.** `harness.ts health --all` reports
`src/store/index.ts` as _"no production module imports anything from it; only tests do, so the
subsystem it implements never runs"_. `grep -rln 'store/index\.ts"' src/` returns **45** production
files, including `reporting/status.ts`, `reporting/doctor.ts` and `integration/record-command.ts`.
The same check reports `test:unit` and `test:integration` as missing commands when both are
`package.json` scripts. This matters more than an ordinary bug: the health tool is currently the
**only** working gate, and a gate that cries wolf gets ignored. The other unused-code failure it
reports in the same breath — `workflow/lease/abandon.ts` — is #16 and is genuinely real.

**#18 — `BACKLOG.md` citation drift.** Commits `a214752` and `5869023` moved roughly two dozen test
files from `tests/unit/**` into flat `tests/integration/*` names without updating the citations that
pointed at them. Intent drift now reports **35 failures**, up from 26 before this pass — the
reconciliation notes themselves quoted the old paths while explaining the moves, which added nine.
Affected: B1, B2, B3, B6, B15, B17, B19, B20, B22, B27, B34, B35, B37, B38.

## Reconciliation protocol

**Before working any queued item, first establish that it is still real.** Open the files it cites,
run the commands it cites, and decide: still real / already fixed / obsolete. Delete the obsolete
ones from this file rather than leaving them tagged.

Run reconciliation as its own pass, after a wave lands and the repo is stable — never interleaved
with implementation, because a tree mid-edit cannot answer "is this still true".

**Verify the wiring, not the existence of code.** Three times in one day an agent reported a fix that
was real code joined to nothing: `gate:prove` was built but never called, the dual-channel analyzer
shipped but was never imported, and five gvui validator roles were unreachable because the producer
emitted a different shape. A symbol that exists is not a symbol that runs.

### The 2026-08-20 pass

24 items were reconciled against current code. 20 survived, 4 were deleted, 4 new defects were found.
Twelve `in flight` rows were verified landed and cleared. Deletions, with cause:

| Item    | Verdict       | Cause                                                                                                                                      |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **B26** | already fixed | `tests/unit/workflow/validator-independence.test.ts` drives the exact cycle it asked for, asserting by error code. Retagged `verified`.    |
| **B39** | already fixed | `grants.ts` stamps every CLI-supplied field `agent_reported`; conflict surfacing reaches `markdown-formatter.ts` and `graph-generator.ts`. |
| **B18** | obsolete      | Its own text withdrew B18.2 in favour of B22 — and B22's worktree module is now implemented and wired.                                     |
| **B40** | obsolete      | It existed only to audit B39. With B39 fixed, it tracks nothing.                                                                           |

**Owed next:** re-reconcile after #1 and #2 land, because a green CI changes what "verified" means
for every row above.

## Landed in the harness-honesty wave, not previously recorded here

Three defects found by forensics on the `limo` capsule and discussed directly with the owner. They
were implemented before being queued, so they are recorded here for completeness:

| Item                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Requirement fold refuses** | A 487-byte single-line prompt naming ~13 concerns produced ONE requirement carrying FOUR acceptance criteria, each "Task gate `<X>` passes with exit code 0". `compiler.ts` folds surplus tasks into the first requirement via `nonBlankLineIndices[taskIdx % length]`. The harness already warned; the warning is now a refusal. Gate-as-acceptance (the silent third fallback) now warns loudly, and becomes conditional on a falsifiability proof once C3b lands. |
| **Projection checkpointing** | `events.jsonl` measured at 4,613,371 bytes over 66 events; the `projection` field is 103.7% of that by JSON size. Real event content totals ~17KB — the signal is 0.4% of the file. Replaced with periodic checkpoints plus replay.                                                                                                                                                                                                                                  |
| **Unclosed attempts**        | Three of four tasks in the `limo` run reached `done` holding an implementation attempt with `started_at` and no `submitted_at`. A terminal transition now refuses while an attempt is open; abandonment is an explicit attributed state.                                                                                                                                                                                                                             |

## R11 — File equality must be semantic, not byte-level (added 2026-08-20)

### The requirement

> "If a formatter runs and a row/column alignment changes, or it gets some additional spacing, that
> should not be registered as a different file. File equality should be handled by the content of the
> code — parsed and trimmed — so that additional spacing or alignment changes are not considered a
> difference."

The skill should not need to intervene in a repository's own formatting setup. It should be
_indifferent_ to formatting instead.

### It has already caused two real failures, both today, both in this repository

**1. Digested checklists.** `bun run format` (bare `oxfmt`, no path restriction) re-indented list
items in `orchestrating-long-tasks/checklists/*.md` — ` -` became `- `, plus blank lines. A
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

| Mechanism                       | What it hashes                                   |
| ------------------------------- | ------------------------------------------------ |
| contract digests                | role and checklist document bytes                |
| `prompt_sha256`                 | the immutable prompt                             |
| C4 write-scope content hash     | the declared scope at claim vs submit            |
| C10 drift detection             | working tree vs the union of declared scopes     |
| repository binding / inspection | `current_repository_inspection_sha256`           |
| `gate:prove`                    | a reverted scratch copy against the working tree |

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

Nothing. The `test-lane` and `hygiene-and-docs` waves landed, along with C3b, C10, C11, the
heartbeat, `plan:apply` reachability, A2, A3, the data-model unification and R7-R10. Each was
verified wired, not merely present:

| Landed                 | Verified by                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C11 installed-runtime  | `assertInstalledRuntimeFresh` imported and called in `cli/commands/plan.ts:12`; all three roots enumerated in `installer/runtime-freshness.ts` (covers R10).                           |
| C3b `gate:prove`       | `assertGateProofFalsifiable` called at `workflow/review/record-review.ts:98`.                                                                                                          |
| C10 out-of-band drift  | `outOfBandPaths` called at `workflow/submission/submit.ts:113`.                                                                                                                        |
| The heartbeat          | `orchestrator:supervise` registered and granted in `roles/coordinator.md:46`; `orchestrator-ops.ts` → `supervision-watch` → `supervision-tick` → `reclaimDeadAgents` → `recoverStale`. |
| `plan:apply` reachable | Granted at `roles/coordinator.md:30`; `packets/planner-packet.ts:25` reads the live revision instead of hardcoding 0.                                                                  |
| A2 parallelism         | Grounded on `A2_PROMPT_LINE_THRESHOLD` and independent-root count; `not_evaluated` is now the ambiguous case, not the only case.                                                       |
| A3 gate structure      | `sameGateSignature` compares `(executable, subcommand, targets)`; the string equality is gone.                                                                                         |
| Data-model unification | The `screenshots` alias is gone from `reporting/command-evidence.ts`; `inspection-formatter.ts` no longer exists.                                                                      |
| R7 / R8 / R9           | `HarnessError.fix` at `errors/harness-error.ts:10`; the never-read-source footer at `errors/normalize-error.ts:12`; `explain` registered at `cli/registry/explain.ts:6`.               |

Unit lane at the time of writing: `bun run test:unit` → **3905 pass, 0 fail** across 464 files.
The integration lane is a different story — see #2.

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

## R7–R10: the context-burn defect (added 2026-08-20) — **landed 2026-08-20**

> Kept as the design record for work that has shipped. R7's `fix` field, R8's footer, R9's
> `explain` command and R10's three-root freshness are all wired; see the In flight table above
> for the call sites. Nothing below is outstanding.

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
