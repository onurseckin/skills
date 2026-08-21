# PHASE 0 — make the ground trustworthy

## 1. Goal

Repair the four defects that would make every later phase's evidence unreliable, and resolve the
coverage gate, so that Phase 1 builds on a harness whose monitor does not lie.

Phase 0 is not the mind. It ships no `mind:*` command and no role. It is the difference between
building on rock and building on the `--watch` bug.

## 2. Preconditions

```sh
bun run typecheck                 # exits 0
bun run test                      # exits 0, whole lane under 60s
git status --porcelain            # your own tree is clean before you start
```

If another agent's work is in the tree, do not revert it and do not stage it. Fix lint or type
breakage you cause; leave everything else exactly as found.

## 3. Work items

All five are disjoint. W0.1–W0.4 may run in parallel as two implementer/validator pairs. W0.5 is a
decision plus a small change and should be done first, because it decides whether the others land on
a red gate.

---

### W0.5 — Resolve the armed coverage gate  *(do this first)*

**Files:** `bunfig.toml`, and whichever source files are chosen for repair.

**State today:** `coverageThreshold = 0.95` and `coverageSkipTestFiles = true` are armed.
`bun run test` passes; `bun run test:coverage` **exits 1**, with roughly 125 files below threshold.
Notably `cli/commands/coverage-check.ts` — the coverage-checking command itself — was measured at
50% line / 31% function coverage.

**Choose one, and write down which and why:**

- **(a) Raise the stragglers.** Prefer this for files the later phases touch:
  `reporting/`, `cli/commands/`, `orchestrator/`. Before writing a test for a low-coverage file,
  run `health --check unused-code,dead-code` against it — if it is unreachable, deleting it is worth
  more than covering it.
- **(b) Lower the threshold to a number that passes today**, and record the target and the plan to
  reach it.

**Not acceptable:** leaving it armed and red. A gate everyone routes around protects nothing, and
this is exactly how the repository's CI came to point at a path that never existed in its history.

**Acceptance:** `bun run test:coverage` exits 0, and the chosen option is written into this file's
§7 as one sentence.

---

### W0.1 — `orchestrator:supervise --watch` must actually tick

**Files:** `orchestrating-long-tasks/scripts/src/orchestrator/supervision-watch.ts`,
`orchestrating-long-tasks/scripts/harness.ts` (read only, to understand the interaction).

**The defect.** `supervision-watch.ts:43-46` unrefs its sleep timer, and `harness.ts:62` invokes the
CLI as a floating promise with no top-level `await`. Module evaluation finishes, the unrefd timer is
the only scheduled work, nothing holds the event loop, and Bun exits 0. Measured: one tick, 128 ms,
zero bytes on stdout, exit 0.

This is the worst possible failure shape — indistinguishable from success — and it is why the pulse
is built on the re-entrant single tick rather than on `--watch` (`PLAN.md` §0.1). Fix it for
honesty; do not build on it.

**The fix.** Drop the `unref` call. Keep the abort listener and its `clearTimeout`. The plan's own
minimal repro table settles the choice: floating `main()` with a **refd** timer prints tick 1 and
tick 2 and runs 3,019 ms; with an **unrefd** timer it exits in 18 ms.

**Forbidden repairs:** a `setInterval` keepalive, a sentinel promise that never resolves, or a
`process.stdin.resume()`. The one `setInterval` already in the tree
(`orchestrator/watchdog.ts:271`) is a cautionary tale, not a pattern.

**Acceptance — two tests, and the first is the falsifiable one:**

1. **Structural, in-lane.** Make the timer factory injectable and assert the watch loop never calls
   `unref` on the handle it receives. This test fails on the current code and passes after the fix,
   with no subprocess and no real time.
2. **Process-lifetime smoke, the single sanctioned subprocess test in the lane.** `Bun.spawn` the
   harness with `--watch --interval 1` against a fixture capsule, stop it after a bounded wait
   (≤3 s), and assert **at least two ticks** and non-empty stdout. The property under test is that
   the process stays alive, which cannot be observed in-process; mark it as the exception it is and
   keep its timeout hard.

---

### W0.2 — An error subcode for `INTEGRITY:STATE_PROJECTION`

**Files:** `store/issues.ts`, `store/integrity.ts`, `contracts/capsule.ts`.

**Why.** Four concurrent supervision ticks against one capsule produced three successes and one
`INTEGRITY / STATE_PROJECTION` failure at exit 3. `doctor` afterwards found nothing wrong, so that
was a transient read race against the writer's rename — not corruption. The pulse must retry it
once; every *other* integrity failure must escalate immediately (`PLAN.md` §0.3, §5.4).

**The fix.** `IntegrityIssue` already carries an optional `detail` field
(`contracts/capsule.ts:73`). Add a `subcode` — or populate `detail` with a typed discriminator — set
at `store/integrity.ts:48` to distinguish a projection mismatch that is a read race from one that is
durable. Expose it through `doctor`'s output so a caller can branch on a field.

**The rule this exists to protect:** nothing anywhere may decide retryability by matching on message
text. `SUPERVISION.md` records what text-matching detection degrades into — a scan that matched 473
agent transcripts because the agents were reading the file containing the words.

**Acceptance:** a concurrency test drives N simultaneous mutations against one capsule and asserts
every resulting failure carries the subcode; a second test asserts a deliberately corrupted
`state.json` does **not** carry it.

---

### W0.3 — Surface `nextActions` from `run:status`

**Files:** `reporting/status.ts` (`runStatus`, line 60), plus its formatter.

**The defect.** `nextActions()` (`reporting/next-actions.ts:53`) computes fully-formed argv per task
state — including `task:validate-start` for a submitted task, with a placeholder validator id — and
its only caller in the entire tree is `reporting/handoff.ts:51`. A model running `run:status` gets a
description of the situation and no legal move. `CHANNEL.md` R6 already asks for this.

**The fix.** Call it from `runStatus` and render it in the markdown brief as literal argv. Respect
`enforceLineLimit` (30 lines): if the action list would overflow, show the highest-priority actions
and a count of the remainder — never a truncated argv that looks runnable and is not.

**Acceptance:** on a mid-flight fixture capsule, `run:status` returns argv identical to what
`handoff.md` returns for the same state; and a capsule with more actions than fit still emits only
whole, runnable commands.

---

### W0.4 — Refresh `handoff.md` after submit and after a tick

**Files:** `cli/commands/task-claim.ts` (holds `taskSubmitCommand` at line 232 and already imports
`refreshHandoff` at line 9 for the claim path at line 334), `cli/commands/orchestrator-ops.ts`.

**The defect.** `handoff.md` is refreshed at exactly four places: `run:complete`
(`run-ops.ts:109`), `task:claim` (`task-claim.ts:334`), and `task:reject` / `task:review` **only
when the result is escalated**. After a `task:submit`, after `recover`, and after a supervision
tick, the document a resuming agent is told to read is stale.

**The fix.** Call `refreshHandoff(run)` after a successful submit and at the end of a supervision
tick. Return the path in the result object the way the existing call sites do.

**Acceptance:** submit a task against a fixture capsule and assert both the mtime and the content of
`handoff.md` moved, and that the refreshed content contains the submitted task's new legal move.

---

## 4. Check and balance

Beyond the per-item acceptance tests:

- **Falsifiability sweep.** For each of W0.1–W0.4, stash the change and confirm the new test fails.
  A Phase 0 test that passes against the unfixed tree is worthless, and W0.1 is precisely where that
  mistake is easiest to make.
- **No behaviour change elsewhere.** The full lane stays green and stays under 60 s.
- **Independent verification.** The agent that runs §5 is not an agent that implemented a work item.

## 5. Exit criteria

Every line is a command whose exit code was observed, by an agent that did not write the code.

```sh
bun run typecheck                                   # 0
bun run test                                        # 0, lane under 60s
bun run test:coverage                               # 0  (W0.5 resolved it)
bun harness.ts health                                # runs; findings recorded, not necessarily zero
```

Plus, recorded in the phase's own notes:

1. The watch smoke test observed **≥2 ticks** and non-empty stdout.
2. A concurrency test produced at least one subcoded `STATE_PROJECTION` failure.
3. `run:status` on a mid-flight capsule emitted runnable argv.
4. `handoff.md` moved after a submit.
5. W0.5's choice, in one sentence.

## 6. Failure modes

| Likely mistake                                              | The tell                                            |
| :---------------------------------------------------------- | :--------------------------------------------------- |
| "Fixing" `--watch` with a keepalive instead of the refd timer | A `setInterval` or `stdin.resume()` in the diff      |
| A W0.1 test that mocks the sleep and passes on broken code   | It does not fail when the change is stashed          |
| Deciding retryability by matching the message string         | `includes("STATE_PROJECTION")` anywhere outside store |
| Truncating the argv list to fit 30 lines                     | A brief ending mid-command                           |
| Raising coverage with tests that assert a mock's own return  | Coverage moves, mutation survives                    |
| Reverting another agent's in-flight work to get a clean tree  | Files you never touched appear in your diff          |

## 7. Rollback

Each item is independently revertable and none of them writes to a capsule, so rollback is `git
revert` of the item's commit. The one exception is W0.5(b): lowering the threshold is a decision, not
a defect, and reverting it re-arms a red gate.

**W0.5 decision:** _(to be filled in by the implementing agent, one sentence, before the phase is
declared done)._
