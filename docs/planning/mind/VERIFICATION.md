# VERIFICATION — the check-and-balance regime

This is the document that decides whether a phase is finished. It applies to every phase, and each
phase file adds its own suites on top of it.

The regime exists because this project has already been lied to by its own tooling, twice, and both
times the lie looked exactly like success:

- Eleven tasks were claimed, submitted, validated and marked done inside one second, with **no file
  written during the run window** and every "domain gate" the same repo-wide `bun run typecheck`
  (`../coordinator-conformance/FORENSICS.md`).
- `orchestrator:supervise --watch` exits **0**, in 128 ms, having printed nothing and ticked once
  (`PLAN.md` §0.1). A cron driver would have received success forever.

Both are the same failure: **a check that cannot fail**. Everything below is machinery for making
checks that can.

---

## 1. The five bars

Every phase is graded against these. A phase that satisfies four is not done.

| # | Bar                     | The question it answers                                                 |
| - | :---------------------- | :----------------------------------------------------------------------- |
| 1 | **Falsifiable**         | Does the test fail when the change is reverted?                         |
| 2 | **Negative**            | Is there a test for every refusal, asserting *which* refusal fired?     |
| 3 | **Adversarial**         | Has a planted defect been caught by the check that claims to catch it?  |
| 4 | **Independent**         | Was it verified by someone other than whoever wrote it?                 |
| 5 | **Legible**             | Can a human read the output and say what happened without asking?       |

Bar 1 is the one this repository has historically failed. `gate:prove`
(`cli/commands/gate-prove.ts`) exists because ten tasks once shared a gate that passed whether the
task did its work or nothing at all. Apply its logic by hand to every test you write: **stash the
change, run the test, watch it fail, restore.** A test that passes against the unfixed tree is
decoration.

---

## 2. Where tests live and how they run

- **One lane. Unit only.** `tests/unit/<area>/<subject>.test.ts`. There is no integration lane and
  one must not be re-created; a previous attempt to restore it cost a day.
- `bun run test` → `bun test --timeout 30000 --parallel --no-isolate tests/unit`.
- **The whole lane must stay under 60 seconds.** If a new suite pushes past that, the suite is doing
  real work it should be mocking.
- **A unit test mocks the boundary; it does not re-run the real thing.** Filesystem, git, clock,
  host dispatch and network are all seams to be substituted. A test that shells out to `bun test`,
  clones a repository, or sleeps for a real interval belongs in a phase's experiment section, not in
  the lane.
- **Run file-specific tests during implementation** (`bun run test:unit <path>`), never the whole
  lane between edits.
- **Fixtures over ambient state.** Capsule-shaped inputs come from `tests/fixtures/capsules/` and
  `tests/support/`, never from whatever happens to be in `.capsules/` on the machine. A suite that
  reads the developer's live capsules passes or fails for reasons unrelated to the code.

### 2.1 Time

Nothing in the pulse design may depend on a real clock passing. Every deadline, interval, backoff and
staleness check takes its `now` as an argument, exactly as `workflow/lease/recover-stale.ts` and
`orchestrator/supervision-tick.ts` already do. This is what makes the pulse re-entrant, and it is
also what makes it testable in milliseconds instead of minutes.

**A test that calls `sleep` to advance a deadline is a design defect in the code under test.**

---

## 3. The four suite classes

Every phase produces all four for the surface it adds.

### 3.1 Positive — the thing works

Ordinary. The least interesting and the least trustworthy: this project has produced a run where
29 of 29 validations passed and nothing had been built.

### 3.2 Negative — the refusal fires, and the right one

For every refusal condition in `CONTRACTS.md` §5, one test that triggers it and asserts:

1. the command exited non-zero with the documented code,
2. the message names **which** condition refused — not merely that something did,
3. the message contains the repair argv (§4 below),
4. **the capsule did not change**: `event_sequence` and `event_head` are identical before and after.

That fourth assertion is the one people forget, and it is the one that catches a refusal implemented
*after* a mutation.

### 3.3 Adversarial — plant the defect, require the catch

For every check that claims to detect something, a test that constructs the thing and requires
detection. Phase 5's auditor is graded entirely this way: an auditor that has never caught a planted
defect has not been tested, it has been observed being agreeable.

Minimum planted set, extended per phase:

- a pulse with an open and no close
- an admitted candidate whose witness command exits 0
- a candidate citing a charter goal that does not exist
- a charter edited after the pin
- a value series that claims work the ledger does not contain

### 3.4 Damage — break it, then require recovery

The deliberate-damage suite is a **deliverable**, not a nice-to-have (`PLAN.md` §13.2). Against a
scratch capsule, each of these, asserting which ladder rung (`PLAN.md` §9.2) responds and what it
records:

| Damage                                    | Expected response                                     |
| :---------------------------------------- | :----------------------------------------------------- |
| expire a lease                            | rung 1 reclaims it; `supervisor-*` event recorded      |
| kill an agent mid-attempt                 | rung 2 `task:abandon` path with a reason               |
| truncate the tail of `events.jsonl`       | `doctor:repair` re-derives, quarantines the fragment   |
| corrupt `state.json`                      | `INTEGRITY` with the subcode; retry-once then escalate |
| hold two pulses at once                   | the second refuses; capsule unchanged                  |
| leave a pulse open past its deadline      | next `mind:wake` closes it `crashed`, counts it        |
| three consecutive crashed pulses          | HALT, no arm, escalation recorded                      |
| a charter whose bytes changed since pin   | HALT at wake, no arm                                   |

---

## 4. The refusal-quality gate

`RAILS.md`: *a refusal without a prescribed repair is a defect.* A weak model that hits a bare
refusal does not re-plan — it leaves the harness and edits files directly, and the ledger becomes
fiction.

This is enforced mechanically, not by review. One suite enumerates `COMMAND_REGISTRY`
(`cli/registry/index.ts:22`), and for every `mind:*` command drives each documented refusal, then
asserts the error message contains a runnable `bun harness.ts …` argv.

Add the command, forget the repair argv, the lane goes red. That is the difference between a
convention and a rail — the distinction this entire subsystem is organised around.

---

## 5. Coverage

`bunfig.toml` carries `coverageThreshold = 0.95` and `coverageSkipTestFiles = true`.

**As of this writing the gate is armed and failing** — the lane is green (all tests pass) but
`bun run test:coverage` exits 1, with roughly 125 files under threshold. A red gate that everyone
routes around protects nothing, so Phase 0 must resolve it one way or the other and record which:

- **either** the stragglers are raised and the gate passes,
- **or** the threshold is deliberately lowered to a number that passes today, with the target and
  the reason written down.

What is not acceptable is leaving it armed and red while new work lands on top of it.

Thereafter, the standing rule for every phase: **the files a phase touches leave it at or above the
threshold.** A phase does not have to fix the repository's history; it does have to not add to it.

Two anti-patterns, both of which this repository has produced before:

- **Tests written to move a number.** A test that asserts a mock returns what the mock was told to
  return raises coverage and proves nothing. `VERIFICATION.md` §1 bar 1 is the filter: if it cannot
  fail, delete it.
- **Covering code that should be deleted.** Before writing tests for a low-coverage file, check
  whether it is reachable at all. `health --check unused-code,dead-code` answers this. Deleting an
  unreachable file is worth more than covering it.

---

## 6. Independence

- **Every implementer has a validator.** Structural, not numeric — there is no target count of
  findings, and zero findings is a legitimate result (`PLAN.md` §12.4).
- **A validator never receives the implementer's narrative.** Allowlisted context only; the
  packet machinery already enforces this.
- **The auditor is not tested by whoever wrote it** (`PLAN.md` §13.7, phase 5). This is the single
  most important independence rule in the plan, because the auditor is the check on the checker.
- **Nobody validates their own phase's exit criteria.** The agent that runs the exit-criteria
  commands is not the agent that implemented the work items.

---

## 7. Evidence rules

- **No claim without a command id.** Every answer in the auditor's questionnaire, every observation,
  every candidate witness cites the recorded command that produced it. A statement with no command
  id is `agent_reported` and proves nothing.
- **Green from one lane is not green.** The unit lane once passed while the integration lane sat at
  45 failures and CI had never run the real tests since the repository's first commit. The charter's
  `stability` block must name *every* lane that matters.
- **Absent renders as `unknown`.** Never as a plausible default, never as a neutral-looking zero.
- **Structured fields, never prose matching.** A naive scan for quota terms once matched 473 agent
  transcripts, because agents were reading the source file that *contains* those terms. Detection
  reads a typed field or it does not exist.

---

## 8. What is deliberately not a validation

| Not a validation                              | Why                                                       |
| :-------------------------------------------- | :--------------------------------------------------------- |
| The system's own summary of its night          | `agent_reported`. It is the thing being checked            |
| Pulses run, agents deployed, commands executed | Activity, not value. `PLAN.md` §11.2 keeps these out       |
| Tokens spent, files touched, lines changed     | Same                                                       |
| "All gates green" with one lane                | §7                                                         |
| A validator's pass on work it also planned     | Independence failure; the pairing invariant exists for it  |
| A count of findings hitting a target           | A run once asked for ">=5 pushbacks" and produced exactly 5 |

---

## 9. Experiments — the checks that are not unit tests

Three phases are graded by an experiment rather than a suite, because what they claim is about
behaviour over hours. Each has a written pass bar, and each produces an artifact a human reads.

| Phase | Experiment            | Duration | Pass bar                                     |
| :---- | :-------------------- | :------- | :------------------------------------------- |
| 1     | The overnight run     | 1 night  | `PHASE-1.md` §5 — five numbered criteria     |
| 3     | The shadow week       | 7 days   | `PHASE-3.md` §5 — discovery on, adoption off |
| 6     | The soak              | 72 h     | `PHASE-6.md` §5 — four injected failures     |

An experiment's result is recorded in the capsule and summarised in one paragraph in the phase file
itself, so the next reader inherits the finding rather than the intention.

---

## 10. The phase verification matrix

| Phase | Positive | Negative | Adversarial | Damage | Experiment | Independent verifier |
| :---- | :------- | :------- | :---------- | :----- | :--------- | :------------------- |
| 0     | yes      | yes      | —           | —      | —          | yes                  |
| 1     | yes      | yes      | —           | —      | overnight  | yes                  |
| 2     | yes      | yes      | yes         | **yes**| —          | yes                  |
| 3     | yes      | **yes, 20 cases** | yes | —      | shadow week| yes                  |
| 4     | yes      | yes      | yes         | yes    | one real objective | yes          |
| 5     | yes      | yes      | **yes, planted ledger** | — | —  | **different agent**  |
| 6     | yes      | yes      | —           | yes    | 72 h soak  | owner                |
