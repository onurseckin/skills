# CONTRACTS — the substrate every phase writes against

Nothing here is a suggestion. These are the names, shapes and paths that phases 1–6 assume. An
implementer who needs a field that is not here adds it *to this document first*, in the same change,
so the next agent inherits it instead of inventing a second one.

Everything below was checked against the tree. Line references are to
`orchestrating-long-tasks/scripts/src/` unless another root is given.

---

## 1. The mind capsule

### 1.1 Creation

`mind:init` calls `initRun` (`store/capsule.ts:24`) with:

| Argument         | Value                                                             |
| :--------------- | :---------------------------------------------------------------- |
| `repoRoot`       | `--repo`, realpath'd by `initRun`                                 |
| `runId`          | `mind-<generation>`, default `mind-1` — matches `RUN_ID_PATTERN`  |
| `prompt`         | the charter file's bytes, read with `readRegularFileNoFollow`     |
| `captureMode`    | `"file"`                                                          |
| `sourceVerified` | `true` — `captureAssurance` requires it for any non-verbatim mode |

The capsule that results is indistinguishable from a run capsule to `doctor`, `doctor:repair`,
`recover`, `verifyIntegrity`, `loadRun` and the lock. That is the point of D2.

### 1.2 Layout

```
.capsules/mind-1/
├── manifest.json      prompt_sha256 IS the charter digest        (0444 semantics enforced)
├── prompt.md          the charter, byte-identical, mode 0444
├── state.json         the projection described in §1.3
├── events.jsonl       append-only hash chain, checkpoint every 20th event
├── last_pulse.json    NOT in the chain — see §1.5
├── escalation.md      appended by mind:escalate — see §5.10
└── (the directories initialCapsuleDirectories() creates, unused by tier 0 until Phase 4)
```

### 1.3 `state.json` — the projection

Reserved keys are owned by the store and must never be written by a mutator
(`store/constants.ts:11-17`): `schema`, `version`, `revision`, `event_sequence`, `event_head`.
Everything below is a business field, mutated only inside a `transact` callback
(`store/transaction.ts:17`).

```jsonc
{
  "mind": {
    "generation": 1,
    "opened_at": "<iso8601>",
    "charter": {
      "source_path": "docs/consciousness/CHARTER.md",
      "pinned_sha256": "<hex>",
      "goals": ["G1", "G2"],
      "repo_roots": ["orchestrating-long-tasks/", "docs/"],
      "evidence_class": "harness_observed"
    },
    "previous_generation": { "run_id": "mind-0", "event_head": "<hex>", "sealed_at": "<iso8601>" }
  },

  "budget": {
    "pulses_per_day": 96,
    "wall_clock_ms_per_day": 21600000,
    "max_agents_in_flight": 8,
    "max_rounds_per_objective": 3,
    "base_interval_ms": 900000,
    "max_interval_ms": 14400000,
    "max_pause_interval_ms": 1800000,
    "pulse_deadline_ms": 1200000,
    "max_open_proposals": 5,
    "quiet_hours": null,
    "day_key": "2026-08-21",
    "pulses_today": 41,
    "wall_clock_ms_today": 7860000
  },

  "pulse": {
    "counter": 1284,
    "open": {
      "pulse_id": "pulse-1284",
      "opened_at": "<iso8601>",
      "deadline_at": "<iso8601>",
      "host": "<host id as reported>",
      "driver": "<driver id as reported>",
      "actor": "consciousness-1"
    },
    "last": {
      "pulse_id": "pulse-1283",
      "closed_at": "<iso8601>",
      "outcome": "quiescent",
      "value": 0,
      "armed_interval_ms": 1350000,
      "armed_at": "<iso8601>",
      "arm_mechanism": "systemd-timer",
      "zero_value_streak": 3
    }
  },

  "observations": [
    {
      "id": "obs-41",
      "source": "intent-drift",
      "command_id": "<command record id>",
      "count": 35,
      "observed_at": "<iso8601>",
      "evidence_class": "harness_observed"
    }
  ],

  "candidates": [
    {
      "id": "cand-12",
      "kind": "defect",
      "statement": "<one line, agent_reported>",
      "witness_command_id": "<command record id>",
      "charter_goal_ids": ["G2"],
      "falsifier_argv": ["bun", "run", "typecheck"],
      "falsifier_exit": 1,
      "write_scope": ["orchestrating-long-tasks/scripts/src/health/"],
      "status": "admitted",
      "decided_at": "<iso8601>",
      "decline_reason": null,
      "gate_failed": null,
      "objective_run_id": "objective-7"
    }
  ],

  "escalations": [
    { "id": "esc-3", "reason": "<text>", "opened_at": "<iso8601>", "resolved_at": null }
  ],

  "audit": {
    "last_started_at": "<iso8601>",
    "last_verdict": "approved",
    "open_findings": []
  }
}
```

Rules that are not negotiable:

- **Arrays are append-mostly.** A candidate is never deleted; a decline is a status change. Gate 6
  (`PLAN.md` §7.3) depends on declined candidates being remembered forever.
- **Every recorded measurement carries `evidence_class`** from the spine in
  `references/protocol.md:23-36`. A count the harness computed is `harness_observed`; a statement an
  agent typed is `agent_reported`; a value nobody supplied is absent, and renders `unknown`.
- **No field is ever back-filled with a plausible default.** `references/protocol.md:13-14`.

### 1.4 Event kinds

Appended through `transact(runRoot, actor, kind, payload, mutate)`. Kind strings are exact.

| Kind                    | Appended by         | Payload carries                                            |
| :---------------------- | :------------------ | :--------------------------------------------------------- |
| `mind-initialized`      | `mind:init`         | generation, charter source path, pinned digest             |
| `mind-pulse-opened`     | `mind:pulse-open`   | pulse id, deadline, host, driver                           |
| `mind-pulse-closed`     | `mind:pulse-close`  | pulse id, outcome, value, armed interval, arm mechanism    |
| `mind-pulse-reclaimed`  | `mind:wake`         | pulse id, deadline passed by ms, consecutive crash count   |
| `mind-observed`         | `mind:observe`      | source, command id, count                                  |
| `mind-candidate-opened` | `mind:candidate`    | candidate id, kind, witness command id, goals, scope       |
| `mind-candidate-admitted` | `mind:admit`      | candidate id, six gate verdicts, falsifier exit observed   |
| `mind-candidate-declined` | `mind:decline`    | candidate id, reason, gate that refused when applicable    |
| `mind-quiesced`         | `mind:quiesce`      | sources checked, command id and count per source           |
| `mind-escalated`        | `mind:escalate`     | escalation id, reason                                      |
| `mind-halted`           | `mind:halt`         | reason, whether an arm was suppressed                      |
| `mind-round-opened`     | `mind:round-open`   | objective id, round index, chained-from capsule            |
| `mind-round-closed`     | `mind:round-close`  | objective id, round index, successor or terminal reason    |
| `mind-audit-started`    | `mind:audit-start`  | audit id, window start, auditor agent id                   |
| `mind-audit-reported`   | `mind:audit-report` | audit id, eight answers with command ids, verdict          |

### 1.5 `last_pulse.json` — deliberately outside the chain

```jsonc
{ "at": "<iso8601>", "pulse_id": "pulse-1283", "outcome": "quiescent", "next_wake_at": "<iso8601>" }
```

Written with `atomicWriteJson` (`core/durable-write.ts`) after every close, including a crash-close.
It exists so that **something outside the system can tell that the system is dead**. Nothing inside a
dead process reports its own death (`PLAN.md` §9.2, rung 5). It is not authoritative state; the chain
is. If the two disagree, the chain wins and `last_pulse.json` is rewritten.

### 1.6 Generational rotation

`store/constants.ts:38` caps a capsule at 100,000 events and `store/event-append.ts:45-46` throws
`INVALID_STATE` past it. At ~20 events per pulse and a 15-minute pulse that ceiling arrives in about
52 days (`PLAN.md` §0.2).

`mind:wake` therefore reports remaining head-room, and at a configurable threshold (default: 90% of
`maxEventCount`) it refuses to open another pulse with the rotation argv in the refusal. Rotation
uses `orchestrator/capsule-chainer.ts`, carrying forward: the charter pin, every open and declined
candidate, the pulse counter, the budget ledger's day key, and `previousEventHead`.

Rotation is specified in Phase 6 but **the head-room warning ships in Phase 1**, because the failure
it prevents is silent.

---

## 2. Wiring a new command — the complete recipe

Missing any step produces a command that either does not dispatch, does not appear in the manifest,
or is not governed by a role contract. All four failures are silent at the call site.

1. **Handler** — `cli/commands/mind-<area>.ts`, exporting a `CommandHandler`
   (`cli/registry/types.ts:32`): `(flags, context, remainder) => Record<string, unknown>`.
   Return an object; include a `markdown` key when the command has a human-facing brief
   (`harness.ts:52-58` prints `result.markdown` unless `--format json`).
2. **Spec** — a new `cli/registry/mind.ts` exporting `MIND_COMMANDS: readonly CommandSpec[]`, using
   `requiredFlag` / `optionalFlag` / `repeatableFlag` from `./types.ts`. Every command needs
   `name`, `aliases`, `domain`, `summary`, `description`, `flags`, `readsStdin`, `takesRemainder`,
   `exitCodes` (use `DEFAULT_EXIT_CODES` unless the command adds one), `examples`, `handler`.
3. **Domain** — add `"mind"` to the `CommandDomain` union in `cli/registry/types.ts:19-36`.
4. **Registry** — import `MIND_COMMANDS` in `cli/registry/index.ts`, spread it into
   `COMMAND_REGISTRY` (line 22) and add `"mind"` to `COMMAND_DOMAINS` (line 44).
5. **Manifest** — regenerate `references/cli-capabilities.md` and `.json` with
   `bun scripts/generate-cli-manifest.ts`. These two files are digest-checked and are deliberately
   excluded from `oxfmt` in `.oxfmtrc.json`; **never hand-edit them and never run a bare formatter
   over them.**
6. **Authority** — grant the command in every role contract that may invoke it, and in no other.
   `assertGrantedCommand` (`packets/command-authority.ts`) enforces this only when `--run` is
   present *and* the acting agent holds a grant in that capsule's ledger. See D4 and §6 below.

### 2.1 Adding a role

Per D6: the document, the `AgentRole` union, the `AGENT_ROLES` array, and the count sentence in
`references/protocol.md:40`. `spawns:` entries must themselves be members of `AGENT_ROLES`, so a
role that spawns a new role requires the new role to land first or in the same change.

---

## 3. Output conventions

- **Markdown briefs pass through `enforceLineLimit`** (`cli/formatters/line-limiter.ts:1`, default 30
  lines). This is why a 200-task run still briefs in 30 lines, and why the ≤2 KB pulse budget in
  `PLAN.md` §6.2 is achievable rather than aspirational.
- **`--format json` is global**, parsed before dispatch. Do not add a per-command format flag.
- **JSON output is unbounded** and must never be a pulse's orientation path.
- **Every brief ends in argv, not advice.** The last lines of `mind:wake` are the literal next
  command and the literal close command. `RAILS.md` calls this Prescribe; `CHANNEL.md` R6 asks for
  the same thing from `run:status`.

---

## 4. Refusals

Every refusal is a `HarnessError` whose message contains, in this order: what was refused, why, and
**the argv that would satisfy it**. Exit codes follow `DEFAULT_EXIT_CODES`
(`cli/registry/types.ts:57-66`): 3 for `INVALID_ARGUMENT` / `INVALID_STATE` / `INTEGRITY` /
`PATH_SAFETY`, 4 for `LOCK_TIMEOUT`, 70 for anything unclassified.

A refusal message that ends at "why" is a defect and `VERIFICATION.md` §4 fails the build for it.

### 4.1 The integrity subcode

`store/integrity.ts:48` currently emits `STATE_PROJECTION` as an undifferentiated issue. Four
concurrent supervision ticks against one capsule produced one such failure — a transient read race
against the writer's rename, not durable corruption (`PLAN.md` §0.3).

Phase 0 adds a subcode so a caller can distinguish "retry once" from "escalate now" **structurally**.
Nothing anywhere may decide this by matching on message text; `SUPERVISION.md` records what happens
when detection degrades into grepping prose.

---

## 5. Command surface — flags, refusals, and what each writes

`--run` is the mind capsule root everywhere (D4). `--actor` is the acting agent id everywhere and
must be a registered agent in that capsule for the role contract to bind (§6).

### 5.1 `mind:init`

| Flag            | Type   | Req | Meaning                                            |
| :-------------- | :----- | :-- | :------------------------------------------------- |
| `repo`          | string | yes | Repository root the mind serves                    |
| `charter`       | string | yes | Path to the owner's charter file                   |
| `actor`         | string | yes | Recorded on `mind-initialized`                     |
| `mind-id`       | string | no  | Default `mind-1`                                   |
| `capsules-dir`  | string | no  | Override `.capsules/`                              |

Refuses when: the charter is missing, unreadable, empty, or not a regular file; the capsule already
exists; the charter's required sections are absent (§7). Writes the capsule per §1.1 and returns the
pinned digest.

### 5.2 `mind:wake`

| Flag            | Type   | Req | Meaning                                                     |
| :-------------- | :----- | :-- | :----------------------------------------------------------- |
| `run`           | string | yes | Mind capsule root                                            |
| `actor`         | string | no  | Recorded only if the call reclaims a dead pulse              |
| `depth`         | string | no  | `brief` (default) or `run`                                   |
| `target-run`    | string | no  | With `--depth run`, the run capsule whose handoff to render  |

**Read-only in the normal case.** It may append exactly one event: `mind-pulse-reclaimed`, when it
finds an open pulse past its deadline (§1.4, `PLAN.md` §9.3).

It never refuses. It *reports* HALT conditions, because a pulse that cannot orient must still be
able to learn why. Returns the Tier A brief of `PLAN.md` §6.1 — every line a measured fact or the
literal word `unknown` — ending in `NEXT` and `THEN` argv.

### 5.3 `mind:pulse-open`

| Flag       | Type   | Req | Meaning                                  |
| :--------- | :----- | :-- | :---------------------------------------- |
| `run`      | string | yes | Mind capsule root                        |
| `actor`    | string | yes | The tier-0 agent id                      |
| `host`     | string | yes | Host runtime as reported                 |
| `driver`   | string | yes | Driver identity as reported              |

Refuses when: a pulse is already open and not past its deadline; `pulses_today` has reached
`pulses_per_day`; `wall_clock_ms_today` has reached its cap; the clock is inside `quiet_hours`; the
charter digest does not match; the event head-room threshold is exceeded. Every refusal names the
outcome the pulse should record instead (`deferred`, `halted`) and the argv to record it.

### 5.4 `mind:pulse-close`

| Flag          | Type   | Req | Meaning                                                            |
| :------------ | :----- | :-- | :------------------------------------------------------------------ |
| `run`         | string | yes | Mind capsule root                                                   |
| `actor`       | string | yes | Must match the opening actor                                        |
| `pulse`       | string | yes | Pulse id; must match the open pulse                                 |
| `outcome`     | string | yes | One of the eleven outcomes in `PLAN.md` §4.3                        |
| `arm`         | string | no  | Duration for the next wake, e.g. `15m`                              |
| `arm-mechanism` | string | no | How it was armed, as reported                                       |
| `terminal-reason` | string | no | Required when `--arm` is absent and the outcome is not terminal   |
| `witness`     | string | no  | Command id evidencing the work this pulse did                       |
| `signal`      | string | no  | Typed signal, e.g. `rate_limit`; never inferred from prose          |

**The arming rail** (`PLAN.md` §3.3) lives here: the command refuses to close unless it has either an
arm or a terminal reason. A pulse that can supply neither closes `unarmed`, which is itself a
recorded outcome and the driver's cue to page a human.

Also computes and records `value` per `PLAN.md` §11.2 from counts the harness already holds — never
from a number the agent supplies.

### 5.5 `mind:observe`

| Flag         | Type   | Req | Meaning                                       |
| :----------- | :----- | :-- | :--------------------------------------------- |
| `run`        | string | yes | Mind capsule root                             |
| `actor`      | string | yes | Acting agent                                  |
| `source`     | string | yes | One of the ten source ids in `PLAN.md` §7.2   |
| `command-id` | string | yes | The recorded command whose output this is     |
| `count`      | int    | yes | How many items that source returned           |

Refuses when the source id is unknown, or when `--command-id` names no command record in any capsule
under `.capsules/`. That second refusal is what makes an observation a measurement rather than a
claim.

### 5.6 `mind:candidate`

| Flag             | Type   | Req | Meaning                                                    |
| :--------------- | :----- | :-- | :---------------------------------------------------------- |
| `run`            | string | yes | Mind capsule root                                           |
| `actor`          | string | yes | Acting agent                                                |
| `kind`           | string | yes | `defect` or `proposal`                                      |
| `statement`      | string | yes | One line, recorded `agent_reported`                         |
| `witness`        | string | cond | Command id — **required unless `--kind proposal`**         |
| `charter-goal`   | string | yes, repeatable | Goal ids from the pinned charter                |
| `falsifier`      | string | cond | Argv that fails now and would pass if fixed (defects only) |
| `write-scope`    | string | yes, repeatable | Paths the work would touch                      |
| `rationale`      | string | no  | Proposals only                                              |

Refuses a defect without a witness; a proposal past `max_open_proposals`; any candidate whose
`--charter-goal` is not in the pinned charter.

### 5.7 `mind:admit`

| Flag        | Type   | Req | Meaning                    |
| :---------- | :----- | :-- | :-------------------------- |
| `run`       | string | yes | Mind capsule root          |
| `actor`     | string | yes | Acting agent               |
| `candidate` | string | yes | Candidate id               |

Runs the six gates of `PLAN.md` §7.3 in order and stops at the first failure, recording **which gate
refused** and returning its repair argv. Gate 3 **executes** the falsifier and requires a non-zero
exit; a falsifier that already passes is a wish, not a defect. Gate 4 checks scope disjointness
against live leases and the charter's `repo_roots`. Gate 6 checks open *and declined* candidates.

### 5.8 `mind:decline` — `--run`, `--actor`, `--candidate`, `--reason` (all required). Refuses an
unknown or already-decided candidate. A decline is permanent and is what gate 6 remembers.

### 5.9 `mind:quiesce` — `--run`, `--actor`, plus `--source` repeated with a `<source>:<command-id>:<count>`
triple for each of the ten sources. Refuses if any count is non-zero, and refuses if any of the ten
sources is missing: a quiescent claim is *"I checked ten places and all ten were clean"*, and nine is
not ten.

### 5.10 `mind:escalate` — `--run`, `--actor`, `--reason` (required), `--severity` (optional).
Appends `mind-escalated` and **appends** to `escalation.md`. Sends nothing; see D7.

### 5.11 `mind:halt` — `--run`, `--actor`, `--reason` (required). Records the halt, suppresses arming,
writes `last_pulse.json` with `next_wake_at: null`.

### 5.12 `mind:round-open` / `mind:round-close` — Phase 4. Specified in `PHASE-4.md` §3.

### 5.13 `mind:audit-start` / `mind:audit-report` — Phase 5. Specified in `PHASE-5.md` §3.

---

## 6. How the role rail actually binds

`assertGrantedCommand` (`packets/command-authority.ts`) does nothing unless **all** of these hold:

1. a flag literally named `run` is present,
2. an acting-agent flag is present (`agent`, `validator`, `critic`, or `actor`),
3. that capsule's `state.json` loads,
4. and the agent id appears in that capsule's agent ledger with a role.

Therefore: **the first thing a pulse does after `mind:wake` is `agent:register`** against the mind
capsule with `--role consciousness`. Without that registration every `mind:*` command runs
ungoverned. Phase 1 makes this a refusal — `mind:pulse-open` requires a registered acting agent whose
role is `consciousness` — so the rail cannot be skipped by omission.

---

## 7. The charter's required shape

`mind:init` parses and refuses what it cannot parse. The charter is Markdown with these `##`
headings, and the first four are mandatory:

| Section         | Required | Machine-read as                                                  |
| :-------------- | :------- | :---------------------------------------------------------------- |
| `identity`      | yes      | prose, unparsed                                                   |
| `goals`         | yes      | `- G<n>: <statement>` lines; the ids gate 2 checks against        |
| `non-goals`     | yes      | `- <statement>` lines; a candidate matching one is refused        |
| `repo_roots`    | yes      | backticked paths; the only paths any agent may write              |
| `stability`     | no       | `- \`<argv>\` → exit <n>` lines; the mechanical definition of "stable" |
| `budgets`       | no       | key/value lines overriding the §1.3 defaults                      |
| `prohibitions`  | no       | copied verbatim into every packet; defaults to `PLAN.md` §11.3    |
| `escalation`    | no       | prose, surfaced in the digest                                     |
| `open_questions`| no       | a legitimate discovery source                                     |

A missing `stability` block is not an error. It is the honest state of most repositories, and the
mind's first useful proposal is usually to create one (`PLAN.md` §14.1.4).
