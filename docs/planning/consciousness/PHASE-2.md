# PHASE 2 — maintenance autonomy (RESCUE and REPAIR)

## 1. Goal

Give the pulse two lanes that consume signals someone else produced, so it can keep a repository's
existing work healthy overnight **without inventing a single new task**.

Phase 2 still dispatches nothing. Its output is recovery actions the harness already knows how to
take, and an escalation digest a human reads at breakfast.

## 2. Preconditions

```sh
bun run typecheck && bun run test && bun run test:coverage    # 0
bun harness.ts mind:wake --run .capsules/mind-1               # a real brief, under 2 KB
```

And the Phase 1 overnight experiment passed all five bars, with the result written into
`PHASE-1.md` §7. A Pulse Zero that has never survived a night is not a foundation.

## 3. Work items

---

### W2.1 — The lane selector

**Files:** `mind/lane.ts` (new), `mind/brief.ts`.

A **pure function** from the brief's numbers to one of `rescue | repair | advance | discover |
quiesce | defer`. Never a question put to the model. `PLAN.md` §4.2 fixes the order and the order is
the whole discipline:

1. **RESCUE** — stale leases, dead agents, torn state. Cheapest, always correct, needs no judgement.
2. **REPAIR** — open findings, red gates, escalations. Consumes signals someone else produced.
3. **ADVANCE** — dispatchable tasks in a live run. Zero invention.
4. **DISCOVER** — reachable only when 1–3 are **provably** empty, and "provably" means the pulse
   cites the three command ids whose empty output opened the lane.

**One lane per pulse.** A weak model handed four lanes does the shallowest bit of each. One lane
makes each pulse finite, the ledger legible and the cost predictable. Depth comes from many pulses.

In Phase 2, `advance` and `discover` are not yet implemented; the selector returns `quiesce` where it
would have returned them, and records that it did. Do not stub them as no-ops that claim success.

**Acceptance:** a table test over constructed brief inputs asserting exactly one lane per row,
including every boundary; a test that `discover` is unreachable while any of the three prior lanes
is non-empty; a test that the selector reads only recorded numbers and never calls a command.

---

### W2.2 — The RESCUE lane

**Files:** `mind/lanes/rescue.ts` (new).

The ladder from `PLAN.md` §9.2, in order, each rung an existing command:

| Rung | Condition                                | Action                                            |
| :--- | :--------------------------------------- | :------------------------------------------------- |
| 0    | charter drift / runtime drift            | HALT, escalate, **do not arm**                     |
| 0    | `INTEGRITY` with the W0.2 subcode        | retry **once**, then escalate                      |
| 0    | `INTEGRITY` otherwise                    | `doctor` → `doctor:repair` → escalate if it persists|
| 1    | any live run                             | `orchestrator:supervise --run <r> --actor <a>`     |
| 2    | open attempt, agent gone                 | `task:abandon --reason …`                          |
| 2    | orphan evidence                          | escalate; a coordinator disposes of it             |
| 2    | abandoned worktrees                      | `worktree:reclaim`                                 |
| 3    | grant active, no attributable event      | `agent:release --reason presumed_dead`             |
| 4    | pulse open past deadline                 | close `crashed`; **3 consecutive ⇒ HALT**          |
| 5    | `GAP > 3×` armed interval                | record and notify — the driver is late or dead     |

Two single-writer rules that are not optional (`PLAN.md` §5.4):

- A supervision tick is taken **only** against a run with no live coordinator grant, or one whose
  grant has expired. `agent:list` answers this. Otherwise the tick races the coordinator.
- `INTEGRITY:STATE_PROJECTION` is retryable **exactly once** and is distinguished by the W0.2
  subcode, never by matching message text.

Rung 4's HALT reuses `orchestrator/failure-classifier.ts`, which already treats `crash` as transient
until it repeats three times and deterministic after. A poisoned capsule stops itself after three
attempts instead of crash-looping until dawn.

**Acceptance:** one test per rung asserting which rung fired and what it recorded; a test that a run
with a live coordinator grant is skipped; a test that a second `STATE_PROJECTION` failure escalates
rather than retrying again.

---

### W2.3 — The REPAIR lane and the escalation digest

**Files:** `mind/lanes/repair.ts` (new), `mind/digest.ts` (new).

Triages open findings, failing gates and escalations into a human-readable digest built on
`formatMorningReportMarkdown`'s existing shape. **It dispatches nothing.** Its product is the
document someone reads over coffee.

The digest must contain one section nothing else contains — and this section is the point of the
whole document (`PLAN.md` §12.2, check 4):

> **"What I would have done without asking"** — every declined candidate and every open proposal,
> with its reason.

In Phase 2 that section is usually empty, because discovery does not exist yet. Build the section
anyway: it is where a human notices drift long before a metric does, and a section that appears only
once there is something to hide in it is a section nobody has learned to read.

**Acceptance:** golden-file test over a fixture with findings, gates and escalations; a test that the
digest names its sources by command id; a test that an empty repository produces a digest that says
so rather than an empty file.

---

### W2.4 — Driver lateness and the `GAP` line

**Files:** `mind/brief.ts`, `mind/last-pulse.ts`.

`GAP = now − last_pulse.closed_at`, compared against the armed interval. Past 3× armed, record it and
surface it. This is the only way a dead scheduler is ever noticed **from the inside** — and the
inside is not enough:

> Nothing inside a dead system can report that it is dead.

So `last_pulse.json` must be readable and meaningful to something outside the process: a second cron,
an uptime ping, a phone. Phase 6 wires that. Phase 2 makes the file trustworthy.

**Acceptance:** a test that a fabricated stale `last_pulse.json` produces the lateness record; a test
that the file is rewritten from the chain when the two disagree; a test that `GAP` renders `unknown`
rather than zero when there is no previous pulse.

---

### W2.5 — Dead-pulse reclaim, complete

**Files:** `cli/commands/mind-wake.ts`, `mind/pulse-reclaim.ts` (new).

Phase 1 closed a corpse so the experiment could continue. Phase 2 makes it a proper lease:

- `mind:pulse-close` refuses a pulse id that does not match the open one.
- A pulse open past `deadline_at` **plus grace** closes `crashed`, with the evidence recorded as
  "no close within deadline" — never as a guess about what the pulse was doing.
- Three consecutive `crashed` outcomes HALT the mind and escalate.

No timer, no daemon, same clock and same idea as `workflow/lease/recover-stale.ts`. A pulse is a
lease over a mind capsule; treat it as one.

**Acceptance:** a test per transition using an injected clock; a test that grace is honoured; a test
that the third consecutive crash halts and does **not** arm.

---

## 4. Check and balance

### 4.1 The deliberate-damage suite — the phase's main deliverable

This is where the monitor gets tested before it is trusted. Against a scratch capsule, inject each
failure and assert which rung responds and what it records. The full table is in
`VERIFICATION.md` §3.4; every row is required here.

The rule that makes it worth having: **a suite that has never caught a planted defect has not been
tested.** Run it against the unfixed tree first and watch the rows fail.

### 4.2 Everything from Phase 1 still applies

Negative tests per refusal with an unchanged `event_sequence`; the refusal-argv sweep; no real clock;
coverage at threshold on new files; independent verification of §5.

### 4.3 The thing to watch for in this phase specifically

A rescue lane that *reports* damage it did not actually repair is the `FORENSICS.md` failure wearing
a new hat. Every rung's test asserts the **state change**, not the log line.

## 5. Exit criteria

```sh
bun run typecheck && bun run test && bun run test:coverage     # 0
bun run test:unit tests/unit/mind/damage.test.ts               # 0, every row
```

Plus, recorded here:

1. The damage suite caught every planted failure, and each row names its rung.
2. A pulse against a repository with a deliberately expired lease reclaimed it, and the ledger names
   what it reclaimed.
3. The escalation digest was read by a human who could say what needed attention without asking.

## 6. Failure modes

| Likely mistake                                             | The tell                                                     |
| :--------------------------------------------------------- | :------------------------------------------------------------ |
| Asking the model to choose the lane                        | A prompt containing the word "decide"                         |
| Ticking a run whose coordinator is alive                   | Intermittent `STATE_PROJECTION` failures under load           |
| Retrying every `INTEGRITY` failure                         | Real corruption gets retried instead of escalated             |
| Matching `"STATE_PROJECTION"` in a message string          | Detection degrades exactly as the 473-transcript scan did     |
| Stubbing `advance`/`discover` as silent no-ops             | The ledger claims lanes that do nothing                       |
| Asserting log output instead of state change               | Rescue "succeeds" while the lease stays expired               |
| Building the digest only when there is something to report | Nobody learns to read it before it matters                    |

## 7. Rollback

Revert the commits; the lanes are additive and no existing command changes behaviour. A capsule that
received a Phase 2 reclaim keeps its events — they are true statements about what happened and must
not be rewritten.
