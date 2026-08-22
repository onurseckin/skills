# PHASE 1 — Pulse Zero

## 1. Goal

Prove that an arbitrary number of disconnected wake-ups can behave like one continuous mind, using a
system that **dispatches nothing, decides nothing, and can break nothing**.

Pulse Zero observes, records, and arms its successor. That is all. If it cannot do that legibly for
one night, nothing later in this plan is worth building.

## 2. Preconditions

```sh
bun run typecheck && bun run test && bun run test:coverage    # all 0 — Phase 0 is done
```

Plus one thing no agent may do for the owner:

**`docs/mind/CHARTER.md` must exist, written by the owner.** Its shape is specified in
`CONTRACTS.md` §7. An agent may draft a skeleton with empty sections; it may not write the identity,
the goals, the non-goals or the repo roots. The charter is the only ground truth with a different
author, and every anti-drift property in this design descends from that (`PLAN.md` §12.1).

## 3. Work items

Order matters: W1.1 and W1.2 unblock everything. W1.3–W1.6 are one implementer/validator pair each
and may run in parallel once the substrate exists. W1.7 is the driver and is the only shell work.

---

### W1.1 — Role plumbing

**Files:** `contracts/packets.ts`, `packets/role-contract.ts`, `roles/mind.md`,
`references/protocol.md`, `tests/unit/roles/role-documents.test.ts`.

1. Widen the tier bound at `packets/role-contract.ts:168` from `1..3` to `0..3`, and update the
   assertions at `tests/unit/roles/role-documents.test.ts:72-73`. `tier` is not used for enforcement
   anywhere in `src/` — it is a declared fact — so this is small, but it is required: a `tier: 0`
   contract is refused today (D5).
2. Add `"mind"` to the `AgentRole` union (`contracts/packets.ts:3-14`) **and** to
   `AGENT_ROLES` (`:16-28`). Adding the document alone fails
   `tests/unit/roles/role-documents.test.ts:24-30`, which asserts the directory matches the array
   exactly (D6).
3. Write `roles/mind.md` in the **observe-only variant**: `tier: 0`, the `may`/`must_not`
   lists from `PLAN.md` §3.2, but `commands` limited to `mind:init`, `mind:wake`, `mind:pulse-open`,
   `mind:pulse-close`, `mind:escalate`, `mind:halt`, plus the read-only diagnostics (`run:status`,
   `doctor`, `health`, `agent:list`, `installation-status`, `explain`) and the agent lifecycle
   (`agent:register`, `agent:report`, `agent:release`). **`spawns: []`.** Phase 1 deploys nothing.
4. Correct the role count sentence at `references/protocol.md:40`, which already says "Eleven roles"
   against sixteen documents.

**Acceptance:** `loadRoleContract("mind")` returns a contract with `tier === 0` and an
empty `spawns`; the roles-directory parity test passes; a test asserts the contract grants no
`plan:*`, no `task:*`, no `run:exec`, no `run:complete` and no `authority:decide`.

---

### W1.2 — The `mind` command domain

**Files:** `cli/registry/types.ts`, `cli/registry/mind.ts` (new), `cli/registry/index.ts`,
`references/cli-capabilities.md`, `references/cli-capabilities.json`.

Follow `CONTRACTS.md` §2 exactly — all six steps. The two capabilities files are **generated**
(`bun scripts/generate-cli-manifest.ts`) and are excluded from `oxfmt` in `.oxfmtrc.json`. Do not
hand-edit them and do not run a bare formatter over the repository; a previous bare `oxfmt` run
reformatted these two files by 484 insertions and 485 deletions with zero word-level change and
blocked three pushes.

**Acceptance:** `bun harness.ts --help` lists the `mind` domain; the regenerated manifest contains
every `mind:*` command with its flags; the manifest digest test passes.

---

### W1.3 — `mind:init`

**Files:** `cli/commands/mind-init.ts`, `mind/charter.ts` (new — parser), `cli/registry/mind.ts`.

Flags per `CONTRACTS.md` §5.1. Behaviour:

1. Read the charter with `readRegularFileNoFollow`. Refuse an empty file, a symlink, a directory.
2. Parse it (`CONTRACTS.md` §7). Refuse a charter missing `identity`, `goals`, `non-goals` or
   `repo_roots`, naming the missing section and showing the expected heading.
3. Call `initRun(repo, mindId, charterBytes, "file", true)`. The charter becomes `prompt.md`, mode
   `0o444`, and `manifest.prompt_sha256` **is** the charter pin (D3). No second pinning mechanism.
4. `transact` a `mind-initialized` event seeding `state.mind`, `state.budget` (defaults from
   `CONTRACTS.md` §1.3, overridden by the charter's `budgets` block) and empty ledgers.
5. Write `last_pulse.json` with a null `pulse_id` so an external checker has something to read from
   the first minute.

**Acceptance:** a fixture charter produces a capsule whose `verifyIntegrity` returns no issues; the
manifest digest equals the sha256 of the charter file; `prompt.md` is mode `0444`; re-running
`mind:init` against an existing capsule refuses without mutating it.

---

### W1.4 — `mind:wake` (Tier A brief)

**Files:** `cli/commands/mind-wake.ts`, `mind/brief.ts` (new), `mind/charter.ts`.

This is the most valuable command in the phase, and `PLAN.md` §6.3 is right that most of it is
plumbing rather than invention. Compose the brief from what already exists:

| Brief line    | Source                                                                     |
| :------------ | :------------------------------------------------------------------------- |
| `MODE`        | `state.pulse` and `state.mind`                                             |
| `CHARTER`     | re-hash `state.mind.charter.source_path`, compare `manifest.prompt_sha256` |
| `RUNTIME`     | `assertInstalledRuntimeFresh` (`installer/runtime-freshness.ts`)           |
| `INTEGRITY`   | `verifyIntegrity` on the mind capsule, plus the W0.2 subcode               |
| `BUDGET`      | `state.budget` arithmetic                                                  |
| `GAP`         | `now − last.closed_at` versus `last.armed_interval_ms`                     |
| `RUNS`        | `run:status` per capsule under `.capsules/` that is not a mind capsule     |
| `ATTENTION`   | escalations, open findings, stale leases from those same statuses          |
| `HEALTH`      | last recorded `health` result and its age — **never re-run health here**   |
| `LANE`        | derived, never asked for — see below                                       |
| `NEXT`/`THEN` | literal argv                                                               |

Hard requirements:

- **Read-only, except one case.** It may append exactly one event: `mind-pulse-reclaimed`, when it
  finds a pulse open past `deadline_at`. That case is in this phase rather than Phase 2 because
  without it a single crashed pulse wedges the overnight experiment permanently: `mind:pulse-open`
  refuses while a pulse is open. Phase 2 adds the crash-count ladder on top; Phase 1 only closes the
  corpse and records why.
- **It never refuses.** A pulse that cannot orient must still learn why. HALT conditions are
  _reported_ — `CHARTER DRIFTED`, `INTEGRITY FAILED` — with the argv that addresses them.
- **Under 2 KB.** Enforced by `enforceLineLimit` at 30 lines plus a byte assertion in the test. If
  the brief exceeds it, the brief is wrong, not the model.
- **Every line is a measured fact or the literal word `unknown`.** No plausible defaults.
- **`LANE` is derived from the numbers above by a pure function.** It is never a question put to the
  model. In Phase 1 the lane is always one of `quiesce` or `defer`, because Pulse Zero has no other
  lane implemented; the selector's full form lands in Phase 2.
- **Event head-room.** Report remaining events against `maxEventCount` and, past 90%, make `NEXT`
  the rotation argv instead of a normal move (`CONTRACTS.md` §1.6). The failure this prevents is
  silent: a hard `INVALID_STATE` at 100,000 events with nothing explaining it.

**Acceptance:** golden-file tests over fixture capsules for each MODE; a byte-length assertion; a
test that a charter whose bytes changed after the pin renders `CHARTER DRIFTED` and a `NEXT` that
does not open a pulse; a test that an open-past-deadline pulse is closed `crashed` and appears in the
brief; a test that the brief's `NEXT` argv parses against `COMMAND_REGISTRY` as a real command with
valid flags.

That last test is worth more than it looks: it makes "the harness prescribes a legal move" a
mechanical property rather than a promise.

---

### W1.5 — `mind:pulse-open`

**Files:** `cli/commands/mind-pulse.ts`, `mind/budget.ts` (new).

Flags and refusals per `CONTRACTS.md` §5.3. Additional requirements:

- **Requires a registered acting agent whose role is `mind`** in this capsule's ledger.
  This is what makes the role rail bind at all: `assertGrantedCommand` returns silently when the
  actor holds no grant (`CONTRACTS.md` §6). Refusing here converts an omission into a stop.
- Records `deadline_at = opened_at + budget.pulse_deadline_ms`.
- Rolls the budget day when `day_key` differs from today, resetting `pulses_today` and
  `wall_clock_ms_today` before the check.
- **Every budget breach is a refusal, not a warning** (`PLAN.md` §11.1), and every refusal names the
  outcome to record instead and the argv to record it.

**Acceptance:** negative tests for each refusal, each asserting the specific condition, the repair
argv, and **that `event_sequence` did not move**; a test that an unregistered actor is refused; a
test that the day roll happens before the count check.

---

### W1.6 — `mind:pulse-close` and the arming rail

**Files:** `cli/commands/mind-pulse.ts`, `mind/value.ts` (new), `mind/last-pulse.ts` (new).

Flags per `CONTRACTS.md` §5.4. This command carries the hardest-won rule in `AUTONOMOUS.md`, turned
from exhortation into a refusal:

> A pulse may not close without either an armed successor or a recorded terminal reason. A pulse
> that can supply neither closes `unarmed`, which is itself an outcome — and the driver's cue to
> page a human, because an unarmed pulse is the end of the mind.

Requirements:

- Refuse a `--pulse` that does not match the open pulse id. Refuse when no pulse is open.
- Refuse `--outcome` outside the eleven in `PLAN.md` §4.3.
- `halted` and `unarmed` do not arm. Everything else must.
- **`value` is computed, never supplied** (`PLAN.md` §11.2): leases reclaimed, findings resolved,
  gates flipped red to green, tasks reaching done, candidates admitted, proposals recorded (capped at
  one). Explicitly not counted: files touched, commands run, tokens spent, agents deployed. In
  Phase 1 most terms are structurally zero — that is correct and must not be papered over.
- Interval arithmetic: `value > 0` resets to `base_interval_ms`; a zero-value streak of K gives
  `min(max_interval_ms, base × 1.5^K)`; a `--signal rate_limit` doubles up to
  `max_pause_interval_ms`; add jitter. The quota signal is a **typed flag value**, never inferred
  from any text an agent read.
- Writes `last_pulse.json` after the event lands, atomically (`CONTRACTS.md` §1.5).

**Acceptance:** a test per outcome asserting arm-or-terminal; a test that omitting both is refused
with the argv for each escape; a table test over the interval arithmetic including the streak and
the cap; a test that `value` ignores a `--witness` for work the ledger does not contain; a test that
`last_pulse.json` matches the chain after a close and is rewritten from the chain when it disagrees.

---

### W1.7 — `scripts/pulse.sh`, the driver seam

**Files:** `orchestrating-long-tasks/scripts/pulse.sh` (new).

Under 40 lines, no intelligence: a lock, an invocation, a trap.

```
flock -n <capsule>/.locks/mind.pulse   || exit 0
bun harness.ts mind:wake --run <capsule> > $BRIEF
<host invocation> $BRIEF
trap 'record an unarmed close if the pulse is still open' EXIT
```

Four obligations and nothing more (`PLAN.md` §5.1): **FIRE** one pulse; **SERIALISE** so two never
run against one capsule; **SURVIVE** any single pulse process; **REPORT** a non-zero exit somewhere a
human sees. The fourth is the notification half of D7 — the harness records, the driver notifies.

Two things that will bite:

- **The host invocation line is host-specific and is not yet known.** `PLAN.md` §5.3 leaves it as
  `<host CLI> --non-interactive --prompt-file $BRIEF`, which is not a real command on any host here.
  Resolving it — for the host the overnight experiment will actually use — is part of this work item,
  and the resolved line is recorded in this file's §7.
- **Dry-run every construct on the target machine before arming.** `SUPERVISION.md` records the cost
  of skipping this: a watchdog used `find -newermt`, this machine's `find` is `bfs`, which rejects
  that syntax, and the check reported IDLE for an hour while two dozen agents were writing.

**Acceptance:** shellcheck-clean; a test that a second concurrent invocation exits 0 without opening
a pulse; a test that killing the pulse mid-flight leaves a capsule the next `mind:wake` can reclaim.

---

## 4. Check and balance

- **Negative suite is mandatory**, not optional: every refusal in `CONTRACTS.md` §5.1–§5.4 gets a
  test asserting the specific refusal, the repair argv, and an unchanged `event_sequence`.
- **The refusal-quality gate** (`VERIFICATION.md` §4) begins here: the sweep over `COMMAND_REGISTRY`
  that fails the lane when a `mind:*` refusal carries no argv.
- **Falsifiability.** Stash each work item and confirm its tests fail.
- **No real clock, no real sleep** anywhere in the lane. Every deadline and interval takes `now` as
  an argument.
- **Coverage.** Every file added by this phase is at or above the threshold.

## 5. The overnight experiment — the phase's real exit criterion

Arm it against this repository at a 15-minute interval and let it run one night. The only permitted
outcomes are `quiescent`, `deferred`, `paused` and `escalated`; the mind has no other lane and no
`spawns`.

Pass bar, all five, judged in the morning:

1. **Every pulse has exactly one open and exactly one close.** No gaps, no double opens.
2. **Every wake brief was under 2 KB.**
3. **The armed interval was honoured within jitter**, and every deviation is explained by a recorded
   reason — idle-gating, quota, quiet hours — not by absence.
4. **`doctor` on the mind capsule reports healthy.**
5. **A human reads the ledger and can say what happened without asking anyone.**

Bar 5 is not soft. It is the one that decides whether any of this is worth continuing, and it is the
only bar a passing test suite cannot fake.

If the experiment fails, stop. Fix what it exposed and run it again. Do not start Phase 2 with a
Pulse Zero that cannot survive a night.

## 6. Failure modes

| Likely mistake                                           | The tell                                                    |
| :------------------------------------------------------- | :---------------------------------------------------------- |
| Inventing a `--mind` flag                                | Role enforcement silently stops applying (D4)               |
| Adding `roles/mind.md` without touching `AGENT_ROLES`    | The roles parity test fails                                 |
| `tier: 0` without widening the bound                     | `loadRoleContract` throws at parse                          |
| Hand-editing `cli-capabilities.md`                       | The digest test fails, or a bare `oxfmt` rewrites 485 lines |
| Making `mind:wake` refuse on a HALT condition            | A halted mind can no longer explain itself                  |
| Re-running `health` inside `mind:wake`                   | The 2 KB budget and the ~0.1 s orientation both blow        |
| Asking the model which lane to take                      | `LANE` must be a pure function of the numbers above         |
| Letting the agent supply `value`                         | Activity becomes the numerator; busywork becomes rational   |
| A pulse that closes with neither arm nor terminal reason | The mind stops overnight and nothing says why               |
| Adding a notifier to `scripts/src/`                      | D7 — the harness records, the driver notifies               |

## 7. Rollback and recorded results

Rollback: revert the commits and delete `.capsules/mind-gen-*`. Nothing outside `.capsules/` and the six
source files above is touched, and no run capsule is affected.

To be filled in by the implementing agents before the phase is declared done:

- **Resolved host invocation line for `pulse.sh`:** _(record it)_
- **Overnight experiment result, one paragraph:** _(record it, including which bars passed)_
