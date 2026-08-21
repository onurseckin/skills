# CONSCIOUSNESS — a self-orchestrating role system driven by an external pulse

**Status:** design plan. No code written. Every claim about what exists was checked by opening the
file or running the command; every claim about what should exist is marked as a proposal and carries
its cost.

**Subject:** `orchestrating-long-tasks` at `/Users/onurseckinsenoglu/repos/skills`, read 2026-08-21.

**Companion documents that this one builds on and does not repeat:**
`../coordinator-conformance/FORENSICS.md` (the evidence), `DESIGN.md` (the six refusals),
`RAILS.md` (the weak-model principle), `CHANNEL.md` (the CLI as sole medium),
`SUPERVISION.md` (the session supervisor), `QUEUE.md` (the ranked backlog),
`../orchestration-overhaul/AUTONOMOUS.md` (the current autonomous operating procedure),
`model-effort-policy.md` (the deferred model decision).

---

## 0. Read this first: two things I found while writing this plan

Both were found by running the code, not by reading it. Both change the design.

### 0.1 `orchestrator:supervise --watch` exits silently after one tick, with exit code 0

The heartbeat that landed the morning before this plan was written, and that the brief correctly
notes "HAS NEVER RUN AGAINST A REAL RUN", does not work. Measured on a copy of
`.capsules/b32-b20-telemetry-proof-2026-08-21`, Bun 1.3.14:

```
$ bun scripts/harness.ts orchestrator:supervise --run <capsule> --actor probe2 --watch --interval 30
exit=0  elapsed_ms=128  stdout_bytes=0  stderr_bytes=0
```

It should have ticked every 30 seconds until the run went terminal or the process was stopped.
Instead it ticked once (the `stale-recovery` event is in `events.jsonl`, sequence 13) and the
process died 128 ms later having printed nothing at all.

**Root cause, reproduced in isolation.** `orchestrator/supervision-watch.ts:43-46` unrefs its sleep
timer:

```ts
const timer = setTimeout(resolve, ms);
if (typeof timer === "object" && timer !== null && "unref" in timer) {
  (timer as { unref: () => void }).unref();
}
```

and `harness.ts:63` invokes the CLI as a floating promise — `main(Bun.argv.slice(2)).catch(...)` —
with no top-level `await`. Module evaluation therefore finishes immediately, the unrefd timer is the
only remaining scheduled work, nothing holds the event loop, and Bun exits 0. Two minimal repros
confirm it:

| repro                                                | result                                    |
| :--------------------------------------------------- | :---------------------------------------- |
| floating `main()` + **unrefd** timer (harness shape) | prints tick 1, exits in **18 ms**, code 0 |
| floating `main()` + **refd** timer                   | prints tick 1 **and** tick 2, 3019 ms     |

**Why this matters more than an ordinary bug.** This is failure mode 5 in its purest form. A cron
driver running `--watch` would receive exit 0 forever while the loop never ticked twice and never
printed a word. The monitor does not merely fail — it fails in the shape that is indistinguishable
from success. It is also, in its current state, strictly worse than the plain single tick, which
does print its morning report.

**Consequence for this design.** The pulse is NOT built on `--watch`. It is built on the re-entrant
single tick driven from outside, which is what `supervision-tick.ts` and the command's own
documentation always said it was for. `--watch` should still be fixed — a command that exits 0 in
128 ms having done nothing is a lie — but fixing it produces a process held open all night, which is
the thing the re-entrant design deliberately avoided. Fix it for honesty; do not build on it.

### 0.2 A single "timeless" capsule is arithmetically impossible; rotation is mandatory

`store/constants.ts:limits()` caps a capsule at **100,000 events** and **256 MiB** of event log, and
`store/event-append.ts:45-46` throws `INVALID_STATE` when the count is exceeded. At a conservative
20 events per pulse and a 15-minute pulse — 96 pulses a day, 1,920 events a day — a single
consciousness capsule hits the ceiling in **about 52 days**.

"Timeless" therefore cannot mean one infinite capsule. It has to mean **generational rotation**: a
mind capsule is sealed and chained to a successor that carries forward the charter digest, the open
candidate ledger and the previous event head. The mechanism already exists —
`orchestrator/capsule-chainer.ts` does exactly this carry-forward for rounds — and this plan reuses
it rather than inventing a second one.

### 0.3 Two smaller corrections to the brief's premises

- **`orchestrator:supervise` IS granted to a role.** `roles/coordinator.md:46` lists it. Only
  `orchestrator:run` is granted to nothing. The distinction matters: a coordinator can already
  legally run a supervision tick today.
- **Concurrent ticks on one capsule race.** Four simultaneous `orchestrator:supervise` invocations
  against one capsule: three succeeded, one failed `INTEGRITY / STATE_PROJECTION`
  ("state.json does not equal the final event projection and head"), exit 3. `doctor` afterwards
  reported no integrity issues, so this is a transient read race against the writer's rename, not
  durable corruption. The design must therefore make the pulse **single-writer by construction** and
  must classify `STATE_PROJECTION` as retryable rather than as an alarm.

---

## 1. The concept, and what it is not

### 1.1 The concept

CONSCIOUSNESS is a **role, a capsule shape, and a pulse protocol** — not a daemon, not a new engine,
and not a process that stays alive.

The harness never calls a model. It never will: that is invariant 6 in `SKILL.md`. So an "always
thinking" system cannot be a loop inside the harness. It has to be a loop **outside** it that keeps
handing the harness back to a host, and a **state shape durable enough that each hand-back resumes
the same thought**. That is exactly what `.capsules/` already is, and exactly what
`supervision-tick.ts` was already built for: a stateless tick that, "called again after a crash,
reaches the same answer a continuously-running process would have."

So:

> **Consciousness is the discipline that makes an arbitrary number of disconnected wake-ups behave
> like one continuous mind.** The continuity lives in the capsule, not in a process. The scheduler
> supplies time. The host supplies thought. The harness supplies memory, refusal and evidence.

Four tiers, each of which may only deploy the tier below it:

- **Tier 0 — Consciousness.** One per repository, long-lived, never edits a file. Owns the charter
  binding, the pulse ledger, the candidate ledger, budgets and the escalation channel. Decides
  _whether there is anything worth doing_ and _what kind of thing it is_.
- **Tier 1 — Orchestrator.** One per objective. Owns a chain of rounds against one objective; never
  edits a file. This is what `agents/orchestrator.yaml` already describes as the tier 1
  meta-orchestrator, given its own contract instead of borrowing the coordinator's.
- **Tier 2 — Coordinator.** One per run capsule. Exactly what `roles/coordinator.md` already is.
- **Tier 3 — Implementer / Validator** (and repairer, planner, critic, sub-\*). Exactly what exists.

### 1.2 What it is NOT

Stating this precisely is most of the value of the document.

- **It is not a running process.** Nothing stays resident. Between pulses there is no Consciousness,
  only a capsule. Anything that must survive a pulse boundary is written down, or it does not exist.
- **It is not a scheduler.** It does not implement time. It consumes wake-ups from whatever the host
  can offer, and its only scheduling responsibility is to _arm the next one before it stops_.
- **It is not an autonomous product manager.** It cannot decide what the application is for. That
  lives in an owner-written charter it is structurally forbidden to modify, checked by digest on
  every pulse.
- **It is not a source of new features.** Novelty enters only as a **proposal** that the owner must
  grant before a single task is planned. An infinite loop that is allowed to invent its own
  objectives will invent them; the discipline is that it may only ever _propose_.
- **It is not "AI that improves itself".** It may not install, upgrade or edit its own runtime. That
  is on the never-unattended list (§11.3), because a system that can rewrite its own guard rails has
  no guard rails.
- **It is not a substitute for CI, tests or review.** It is a consumer of those signals. If the gates
  are weak, Consciousness will faithfully certify weak work, faster and more often. §12 exists
  because of this.
- **It is not free.** Every pulse costs tokens whether or not it does anything. §11 is the answer to
  "what stops it from burning money at 3 a.m. producing busywork" and it is the section most likely
  to be under-implemented.

### 1.3 The one-sentence test the design must pass

From `RAILS.md`, raised one level:

> An operator that always takes the locally cheapest action, never reads a reference file, and never
> explores the command surface still produces an honest, bounded, legible night of work — because
> every cheaper path is either refused with a repair in hand, or does not exist.

---

## 2. The ground: what already exists, verified

Everything in this section was opened. This is the inventory the design is allowed to assume.

### 2.1 Correct, load-bearing, and reusable as-is

| Mechanism                       | Where                                                | Why it matters to Consciousness                                                                                                                                      |
| :------------------------------ | :--------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-entrant supervision tick     | `orchestrator/supervision-tick.ts`                   | The pulse's recovery half. Pure function of state + clock; safe to call from cron.                                                                                   |
| Single-tick-without-dispatcher  | `orchestrator/supervisor.ts:233-234`                 | `dispatcher === undefined` → `stopReason: "single_tick"`. The externally driven mode already exists.                                                                 |
| Time-based stale recovery       | `workflow/lease/recover-stale.ts`                    | Complete and correct: expired leases → `retry_ready`/`changes_requested`, interrupted validations, branch subtasks, critics.                                         |
| Dead-agent reclaim + event      | `orchestrator/dead-agent-detector.ts`                | Emits `supervisor-dead-agent-reclaimed` so reclaims are countable, not inferred.                                                                                     |
| Failure classifier              | `orchestrator/failure-classifier.ts`                 | `rate_limit`/`network`/`provider_5xx`/`timeout` transient and unbounded in count, bounded in elapsed time (4 h default). Exponential backoff with jitter.            |
| Morning report                  | `orchestrator/morning-report.ts`                     | Completed / escalated / awaiting-repair / dead-agents-reclaimed / retries / run span / backoff / occupancy. Verified rendering against a real capsule.               |
| Revision guard                  | `graph/revision-guard.ts`                            | Frozen requirement contract, mutable interior; revision must increase by exactly one. The shape §8 copies one level up.                                              |
| Role-contract command authority | `packets/command-authority.ts` + `cli/execute.ts:29` | The CLI refuses a command the acting agent's role contract does not list. **This is the rail Consciousness extends.**                                                |
| Evidence spine                  | `references/protocol.md:23-36`                       | `harness_observed` / `agent_reported` / `host_reported` / `derived` / `unknown`. Absent stays absent.                                                                |
| Per-agent telemetry ledger      | `contracts/agents.ts:AgentGrantRecord`               | `model`, `model_tier`, `thinking_level`, `context_window`, `tokens_in/out` — each `Evidenced<T>`. The substrate for §10.                                             |
| Host capability probe           | `summary/host-telemetry.ts:HostCapabilities`         | `nesting_depth`, `concurrency_ceiling`, `native_workspace_isolation`, `native_resume`, `per_agent_model_selection`, `multi_agent_enabled`.                           |
| Legal-move computation          | `reporting/next-actions.ts` + `task-actions.ts`      | Produces fully-formed argv per task state, including `task:validate-start` for a submitted task with a placeholder validator id.                                     |
| Handoff document                | `reporting/handoff.ts`                               | Waves, grants, branches, tasks, requirements, open findings, gates, packets, orphan evidence, completion blockers, recent events, **exact next argv**. Written 0444. |
| Event chain + checkpointing     | `store/event-append.ts`                              | Append-only hash chain; full projection every 20th event, patches between; fsync then rename.                                                                        |
| Torn-tail repair                | `doctor:repair`                                      | Re-derives `state.json` from the chain's last complete event, quarantining the fragment.                                                                             |
| Capsule chaining                | `orchestrator/capsule-chainer.ts`                    | Carries forward unresolved findings, unsatisfied requirements and `previousEventHead` into a successor capsule.                                                      |
| Defect synthesis                | `orchestrator/defect-synthesizer.ts`                 | Turns a round's open findings, critic decision and failed gates into the next round's prompt.                                                                        |
| `plan:audit` at compile         | `plan:compile` refuses on blocking findings          | A1/A3/A4/A5/A6 blocking, per-invariant `--accept-audit` overrides. A2 honestly reported `not_evaluated`.                                                             |
| `--auto-partition`              | `plan:add`                                           | The harness enumerates a glob and emits one task per file with a derived gate. Removes granularity from a weak planner's hands.                                      |
| No-op refusal                   | `task:submit` (C4)                                   | Byte-identical scope at claim and submit is refused unless `--no-op --reason`.                                                                                       |
| Restricted git                  | `core/restricted-git.ts`                             | A git gate argv may only be `diff --check` / `diff --cached --check`. Hooks, external diff and pagers disabled.                                                      |
| Authority pause                 | `authority:decide` + `needs_authority` disposition   | A requirement stays non-executable until a human grants it. **This is the mechanism §7.4 uses for novelty.**                                                         |
| Health checks                   | `health/index.ts:ALL_CHECKS`                         | 7 mechanical checks including `intent-drift`, which compares owner-written intent documents against production code and tests.                                       |
| Install drift detection         | `installer/runtime-freshness.ts`                     | Digest + runtime version per install root; `assertInstalledRuntimeFresh` throws `INTEGRITY` on drift. Called from `plan:init`.                                       |
| Branch-and-collect              | six `branch:*` commands                              | Proper-subset write scopes guarantee termination. Built, never used.                                                                                                 |
| Kernel-lock durability          | `references/state-model.md:298-303`                  | POSIX `flock` on the lock inode is authoritative; temp → fsync → rename → dir fsync.                                                                                 |

### 2.2 Exists but is not wired — the specific gaps this plan must cross

| Gap                                              | Evidence                                                                                                                                                                                                                    |
| :----------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator:run` cannot run                    | `cli/commands/orchestrator-ops.ts:76-80` throws `INVALID_STATE` without an injected executor; `grep -rn executor` finds **no injector anywhere in the tree**. The multi-round loop is a library class with no host binding. |
| `--watch` is broken                              | §0.1.                                                                                                                                                                                                                       |
| Nothing runs on a timer                          | The only `setInterval` in the tree is `orchestrator/watchdog.ts:271`, an in-memory `Map` of monitors owned by a live `AutonomousLoopRunner`. It never touches a lease and dies with its process.                            |
| `handoff.md` is refreshed at four points only    | `run:complete`, `task:claim`, and `task:reject`/`task:review` **when the result is `escalated`**. After a `task:submit`, after `recover`, after a supervision tick, it is stale.                                            |
| No command renders the handoff                   | The manifest has no command containing "handoff". It is a write side effect with no reader.                                                                                                                                 |
| `nextActions` is not surfaced from `run:status`  | `runStatus()` (`reporting/status.ts:60`) never calls it. `CHANNEL.md` R6 already asks for this.                                                                                                                             |
| `queue:wave` cannot see validation work          | `scheduler/propose-batch.ts:26` — `DISPATCHABLE_STATUSES = {proposed, ready, retry_ready}`. A `submitted` task awaiting a validator is invisible to the wave _and_ to the morning report.                                   |
| Runtime freshness is checked at `plan:init` only | `cli/commands/plan.ts:73`. A run already open never re-checks.                                                                                                                                                              |
| `host_reported` is defined and never assigned    | `references/protocol.md:31`. Model/effort arrive as CLI input and are `agent_reported`.                                                                                                                                     |
| The plan interior has never moved                | Both capsules in this repo: `graph.revision = 1`, `plan_history = []`. Also true of the six capsules in the brief.                                                                                                          |
| Branch-and-collect has never run                 | Confirmed by the same survey.                                                                                                                                                                                               |

### 2.3 What the host actually offers for scheduling — checked, not assumed

Claude Code, this build, tool descriptions read directly:

- **`CronCreate`** — standard 5-field cron in local time. **Session-only**: "Jobs live only in this
  Claude session — nothing is written to disk, and the job is gone when Claude exits." The `durable`
  parameter "has no effect". Jobs "only fire while the REPL is idle (not mid-query)". Recurring jobs
  **auto-expire after 7 days**. Jitter is added (up to 10% of the period, max 15 min).
- **`Monitor`** — streams stdout lines of a long-running script as events; `persistent: true` lasts
  the session. Dies with the session.
- **`Bash(run_in_background)`** — detached, survives across turns, re-invokes on exit. One
  notification, not a schedule.
- **`RemoteTrigger`** — the claude.ai routines API: `create`/`update`/`run`, webhook triggers,
  `list_runs`, `get_run_log`. **Server-side, survives the local session.** This is the only durable
  scheduler Claude Code exposes, and it runs the agent in the cloud, not on this machine.
- **`PushNotification`** — the escalation channel to a human.
- The `/loop` and `/schedule` skills wrap the two in-session mechanisms.

The load-bearing consequence: **on a laptop, under Claude Code, "runs forever" is false.** Sessions
end. What is true is "runs until the session ends, resumes exactly where it stopped when a session
starts again" — which is what the capsule buys, and it is a genuinely different and better promise
than the one the vision implies. Real unattended operation needs OS-level cron/systemd, or the cloud
routine, or the container in §5.3.

---

## 3. The hierarchy as it would actually live in this repository

### 3.1 The four tiers

```
                    ┌───────────────────────────────────────────────┐
                    │  OWNER (human)                                │
                    │  writes CHARTER.md · grants authority         │
                    │  reads the digest · can HALT                  │
                    └────────────────────┬──────────────────────────┘
                                         │  the only writable ground truth
      ═══════════════════ charter sha256, pinned in the mind manifest ═════════════
                                         │
   external driver                ┌──────▼─────────────────────────┐
   cron │ systemd │ routine ─fire─►  TIER 0   CONSCIOUSNESS        │  one per repo
   Monitor │ shell while          │  .capsules/mind-<gen>/         │  long-lived
        ◄──────────arm───────────  │  never edits a repository file │  never dispatches tier 3
                                  └──────┬─────────────────────────┘
                                         │  0..N per pulse, one per objective
                                  ┌──────▼─────────────────────────┐
                                  │  TIER 1   ORCHESTRATOR         │  one per objective
                                  │  owns a chain of round capsules │  never edits a file
                                  │  owns the round budget          │  never claims a task
                                  └──────┬─────────────────────────┘
                                         │  exactly one per round
                                  ┌──────▼─────────────────────────┐
                                  │  TIER 2   COORDINATOR          │  one per run capsule
                                  │  .capsules/<run>/               │  roles/coordinator.md, unchanged
                                  └───┬────────────────────────┬───┘
                          dispatch    │                        │   dispatch
                      ┌───────────────▼──────┐      ┌──────────▼───────────────┐
                      │  TIER 3 IMPLEMENTER  │─────►│  TIER 3 VALIDATOR        │
                      │  the only role that  │ pair │  independent · adversarial│
                      │  writes repo files   │      │  probes then verdicts     │
                      └───────┬──────────────┘      └──────────┬───────────────┘
                   branch:open│                                │ dispatch
                      ┌───────▼──────────────┐      ┌──────────▼───────────────┐
                      │ sub-implementer      │      │ sub-validator            │
                      │ sub-investigator     │      │ (gathers, never verdicts)│
                      └──────────────────────┘      └──────────────────────────┘

   also deployed by tier 2, unchanged:  planner · plan-validator · repairer · completeness-critic
   deployed by tier 0 on its own cadence: consciousness-auditor  (see §12.2)
```

**The rule that makes the hierarchy real rather than decorative:** _a tier may deploy only the tier
directly beneath it._ Consciousness never dispatches an implementer. If it wants code written it
deploys an orchestrator, which deploys a coordinator, which pairs an implementer with a validator.
Every skip is a refusal, enforced by the `spawns:` list in the role contract.

Why the indirection is worth its cost: each tier is the thing that _bounds_ the tier below. An
orchestrator bounds rounds; a coordinator bounds waves and repair budget; a validator bounds
"done". Collapse a tier and you delete a bound.

### 3.2 The two new role contracts

Same frontmatter schema as the fifteen that exist (`role`, `tier`, `may`, `must_not`, `commands`,
`spawns`), because `packets/role-contract.ts` parses that shape and `packets/command-authority.ts`
enforces the `commands` list at `cli/execute.ts:29`.

#### `roles/consciousness.md` (new, tier 0)

```yaml
role: consciousness
tier: 0
may:
  - Open, verify and rotate the mind capsule, and pin the charter digest into its manifest
  - Open and close exactly one pulse at a time, recording its outcome and the wake it armed
  - Read every capsule under .capsules/ and every read-only diagnostic the harness exposes
  - Record an observation from a named source, citing the recorded command that produced it
  - Record a candidate carrying its witness command id, and admit or decline it against the charter
  - Deploy tier 1 orchestrators, register each one, and bound its round and wall-clock budget
  - Declare quiescence when every source returned nothing worth doing
  - Pause on quota pressure, and lengthen its own wake interval when value per pulse falls
  - Escalate to the owner, and halt itself
must_not:
  - Write, edit, stage, revert, format or delete any repository file, including a one-line fix
  - Write, edit or supersede CHARTER.md, the budgets, or any role contract including its own
  - Claim, implement, repair, validate or review any task
  - Deploy any role below tier 1
  - Adopt a candidate that cites no witness, or that no charter goal admits
  - Open a second pulse while a pulse is open, or act on a capsule another pulse holds
  - Close a pulse without either arming the next wake or recording why it could not
  - Install, upgrade, relink or modify the harness runtime it is executing under
  - Perform, or instruct any agent to perform, anything on the never-unattended list
  - Present an unmeasured value as fact; an unobserved value is absent and renders as unknown
commands:
  - mind:init
  - mind:wake
  - mind:pulse-open
  - mind:pulse-close
  - mind:observe
  - mind:candidate
  - mind:admit
  - mind:decline
  - mind:quiesce
  - mind:escalate
  - mind:halt
  - mind:audit-start
  - orchestrator:supervise
  - run:status
  - doctor
  - doctor:repair
  - recover
  - health
  - installation-status
  - queue:wave
  - agent:list
  - branch:status
  - finding:get
  - report:get
  - evidence:get
  - summary:view
  - explain
  - agent:register
  - agent:report
  - agent:release
spawns:
  - orchestrator
  - consciousness-auditor
```

Note what is deliberately absent: every `plan:*`, every `task:*`, `run:exec`, `run:complete`,
`critic:*`, `queue:pop`, `authority:decide`. Consciousness cannot plan, cannot execute a gate,
cannot seal a run, and — critically — **cannot grant its own authority requests**. `authority:decide`
belongs to the owner alone.

#### `roles/orchestrator.md` (new, tier 1)

```yaml
role: orchestrator
tier: 1
may:
  - Own one objective across a bounded chain of round capsules
  - Open a round capsule, chaining it to the prior round's unresolved findings and requirements
  - Deploy exactly one coordinator per round and register it
  - Read the round's status, morning report and completion blockers
  - Run a supervision tick against a round that has no live coordinator
  - Synthesize the next round's prompt from the prior round's recorded findings and failed gates
  - Declare the objective converged, exhausted or escalated, with the evidence for which
must_not:
  - Write, edit, stage, revert, format or delete any repository file
  - Claim, implement, repair, validate or review any task
  - Deploy any role below tier 2
  - Open a new round while the prior round has a live lease or an unclosed attempt
  - Exceed the round budget its packet declared
  - Synthesize a defect nobody recorded, or discard a finding a round produced
  - Alter the objective it was given; a changed objective is a new objective and belongs to tier 0
commands:
  - plan:status
  - run:status
  - queue:wave
  - orchestrator:supervise
  - recover
  - doctor
  - summary:view
  - summary:export
  - finding:get
  - report:get
  - evidence:get
  - branch:status
  - agent:register
  - agent:report
  - agent:release
  - agent:list
  - mind:round-open
  - mind:round-close
spawns:
  - coordinator
```

The tier 1 contract exists so that `roles/coordinator.md` can stop saying _"This contract covers both
drivers: the tier 2 coordinator that owns one run, and the tier 1 loop runner that chains runs."_
One document describing two roles is precisely how a weak model ends up doing the wrong one.

#### `roles/consciousness-auditor.md` (new, tier 1)

Symmetric to `completeness-critic`, one level up. Reads the pulse ledger, the candidate ledger and
the repository; never reads Consciousness's own narrative. Full contract in §12.2.

### 3.3 Where the scheduler lives — and why it is not an agent

The brief says: _"When Consciousness deploys orchestrators it should also deploy a scheduler, or give
specific scheduler responsibilities to the orchestrators."_

**The scheduler is not an agent.** Spending a model call to decide "wait 15 minutes" is the most
expensive possible implementation of `sleep`, and an agent that must stay resident to keep time is
the exact thing that dies with the session. The scheduler is a _mechanism_ outside the model
entirely (§5).

What is real, and what the owner's sentence is actually asking for, is the **scheduling
responsibility**, and it is an obligation on the pulse rather than a person:

> **The arming rail.** A pulse may not close until it has either (a) armed the next wake and recorded
> the mechanism and time, or (b) recorded a terminal reason (`halted`, `owner-stopped`,
> `charter-drift`). A pulse that can do neither closes with outcome `unarmed` and fires a push
> notification, because an unarmed pulse is the end of the mind.

This is `AUTONOMOUS.md`'s hardest-won rule — _"NEVER end a turn with nothing in flight… this happened
once, a turn ended after a commit with the next wave deferred to the wakeup, and the run sat idle
until the owner came back and found it stopped"_ — turned from a paragraph of exhortation into a
refusal at the CLI door.

Tier 1 gets a narrower version of the same obligation: an orchestrator may not close a round without
recording either the next round it opened or why the chain ended.

### 3.4 Packets

Nothing new. `packets/render-packet.ts` already stamps `role_contract_sha256` into a published
packet, so a tier-0 or tier-1 packet is the existing mechanism with a new contract file. What
Consciousness adds to a tier-1 packet:

| Field                | Class              | Source                                                  |
| :------------------- | :----------------- | :------------------------------------------------------ |
| `objective`          | `agent_reported`   | The admitted candidate's statement                      |
| `witness_command_id` | `harness_observed` | The recorded command that proved the defect exists      |
| `charter_goal_ids`   | `harness_observed` | Which charter goals admitted it                         |
| `round_budget`       | `derived`          | From the remaining pulse/day budget                     |
| `wall_clock_budget`  | `derived`          | Same                                                    |
| `profile`            | `agent_reported`   | Abstract profile name only — never a model string (§10) |
| `prohibitions`       | `harness_observed` | The charter's never-unattended list, copied verbatim    |

---

## 4. The pulse

### 4.1 The state machine

```
                          ┌───────────────────────────────┐
        driver fires ────►│  WAKE                         │
                          │  mind:wake  (read-only)       │
                          └───────────────┬───────────────┘
                                          │
      ┌───────────────────────────────────┼──────────────────────────────────┐
      │ charter digest mismatch           │  budget spent / quiet hours      │
      │ integrity unrepairable            │  quota signal observed           │
      │ auditor verdict = halt            │  another pulse holds the lock    │
      ▼                                   │                                  ▼
   ┌───────┐                              │                             ┌─────────┐
   │ HALT  │ escalate, do not arm         │                             │  DEFER  │ arm later, no work
   └───────┘                              │                             └─────────┘
                                          ▼
                          ┌───────────────────────────────┐
                          │  ORIENT                       │  ONE brief, ≤ ~1 KB
                          │  mode · runs · leases         │  ends in literal argv
                          │  escalations · health · argv  │
                          └───────────────┬───────────────┘
                                          ▼
                          ┌───────────────────────────────┐
                          │  TRIAGE — first non-empty lane wins, cheapest first
                          │                               │
                          │  1. RESCUE   stale leases · dead agents · torn state
                          │  2. REPAIR   open findings · failing gates · escalations
                          │  3. ADVANCE  dispatchable tasks in a live run
                          │  4. DISCOVER only if 1-3 are all empty
                          └───────────────┬───────────────┘
                                          ▼
                          ┌───────────────────────────────┐
                          │  ACT — at most ONE lane per pulse
                          │  dispatch is host-side; the harness records it
                          └───────────────┬───────────────┘
                                          ▼
                          ┌───────────────────────────────┐
                          │  RECORD                       │
                          │  mind:pulse-close --outcome … │
                          └───────────────┬───────────────┘
                                          ▼
                          ┌───────────────────────────────┐
                          │  ARM  (rail: cannot be skipped)│
                          │  next wake, mechanism + time   │
                          └───────────────┬───────────────┘
                                          ▼
                                     ─── SLEEP ───►  (driver fires again)
```

### 4.2 The lanes, and why the order is exactly this

The order encodes the busywork discipline. It is not a preference; it is what makes DISCOVER rare.

1. **RESCUE** is the cheapest and always correct. It is one `orchestrator:supervise` tick plus, if
   the tick reports damage, `recover` / `doctor:repair` / `task:abandon`. It never needs judgement.
2. **REPAIR** consumes signals someone else produced: a validator's finding, a red gate, an
   escalation waiting for a human decision. Zero invention.
3. **ADVANCE** dispatches work a compiled plan already contains. Zero invention.
4. **DISCOVER** is the only lane that can create new work, and it is reachable only when the other
   three are provably empty. That "provably" is a recorded fact, not a claim: the pulse cites the
   three commands whose empty output opened the lane.

**One lane per pulse.** A weak model handed four lanes will do the shallowest bit of each. One lane
per pulse makes each pulse finite, makes the ledger legible, and makes cost per pulse predictable.
Depth comes from many pulses, not from one long one.

### 4.3 What ends a pulse

A pulse ends — always, exactly once — with `mind:pulse-close --outcome <o>`, where the outcome is one
of:

| Outcome      | Meaning                                                         | Arms next?       |
| :----------- | :-------------------------------------------------------------- | :--------------- |
| `rescued`    | Recovery acted; the ledger names what it reclaimed              | yes              |
| `repaired`   | Work dispatched against an existing finding, gate or escalation | yes              |
| `advanced`   | Work dispatched against an existing plan                        | yes              |
| `discovered` | A candidate was admitted and an orchestrator deployed           | yes              |
| `proposed`   | Novelty recorded as a `needs_authority` proposal for the owner  | yes              |
| `quiescent`  | Every source checked, nothing worth doing — with the evidence   | yes, longer      |
| `deferred`   | Budget, quiet hours, or another pulse held the lock             | yes, later       |
| `paused`     | Quota pressure observed; nothing killed, everything resumable   | yes, much longer |
| `escalated`  | Something needs the owner; push sent                            | yes              |
| `halted`     | Charter drift, unrepairable integrity, auditor halt, owner stop | **no**           |
| `unarmed`    | The pulse could not arm a successor                             | **no** — pages   |

A pulse also ends when its **deadline** passes. Every pulse writes `deadline_at` at open. A pulse
found open past its deadline by the next wake is reclaimed exactly the way an expired lease is —
same clock, same idea, no new machinery, no timer (§9.3).

### 4.4 What begins the next

The armed wake fires and the whole thing repeats. Three properties make this a mind rather than a
cron job:

- **Continuity is durable, not remembered.** The successor pulse reads the ledger, not a transcript.
- **Its interval is a decision, not a constant.** Quiescent lengthens it; work shortens it; quota
  pressure multiplies it. §11.2.
- **It knows how long it was gone.** `now - last_pulse_closed_at` against the armed interval yields
  "the driver missed N wakes", which is the only way a dead scheduler is ever noticed (§9.4).

---

## 5. The scheduler adapter seam

### 5.1 The driver contract — four obligations, nothing more

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                          THE DRIVER CONTRACT                             │
  │                                                                          │
  │  1. FIRE       invoke exactly one pulse. The driver passes no judgement, │
  │                no arguments beyond the mind capsule path.                │
  │  2. SERIALISE  never two pulses at once against one mind capsule.        │
  │                Measured need: 4 concurrent ticks → 1 INTEGRITY failure.  │
  │  3. SURVIVE    outlive any single pulse process, including a crashed one.│
  │  4. REPORT     surface a pulse that exits non-zero, somewhere a human    │
  │                can see. Silence must not be the only failure signal.     │
  └──────────────────────────────────────────────────────────────────────────┘
```

Anything satisfying those four is a legal driver. Nothing else about it is the harness's business —
which is the whole point of a seam.

The seam itself is one file the driver executes and one command the pulse begins with:

```
  driver  ──►  scripts/pulse.sh <mind-capsule>   ──►  host invokes the tier-0 agent
                     │                                        │
                     │ 1. acquire the pulse lock (flock)      │  the agent's FIRST action:
                     │ 2. refuse if a pulse is open & alive   │  bun harness.ts mind:wake --mind <c>
                     │ 3. hand the host the wake brief        │  … then ONE lane … then
                     │ 4. release the lock on exit, always    │  bun harness.ts mind:pulse-close …
```

`pulse.sh` contains no intelligence. It is a lock, an invocation and a trap. It must be under 40
lines, and every line of it must be dry-run on the target machine before it is armed — because
`SUPERVISION.md` records the cost of not doing that: _"an earlier watchdog in this project used
`find -newermt '-8 minutes'`; this machine's `find` is `bfs`, which rejects that syntax, so the check
returned nothing and reported IDLE for an hour while two dozen agents were writing."_

### 5.2 Per host

| Host                           | Mechanism that satisfies FIRE                                        | SERIALISE                                                      | SURVIVE                                         | Honest verdict                                                                                           |
| :----------------------------- | :------------------------------------------------------------------- | :------------------------------------------------------------- | :---------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| **Claude Code (in-session)**   | `CronCreate` recurring, off-minute (e.g. `*/17 * * * *`)             | Cron fires only while the REPL is idle → natural serialisation | **No.** Session-only; auto-expires after 7 days | Good for a night at the keyboard. Not "timeless". Re-arm on every session start.                         |
| **Claude Code (event-driven)** | `Monitor` with a poll script emitting one line per due pulse         | Script-side lock                                               | **No.** Dies with the session                   | Best for reacting to a _change_ (a capsule file moving) rather than to the clock.                        |
| **Claude Code (durable)**      | `RemoteTrigger` routine on a cron schedule                           | Server-side                                                    | **Yes** — survives the local session            | The only durable Claude Code option. Runs in the cloud, so the repo and capsule must be reachable there. |
| **Antigravity**                | Its own scheduler; `invoke_subagent` for the pulse agent             | `pulse.sh` flock                                               | Per its scheduler's own persistence             | The brief reports these as "somewhat stable". Verify before trusting; do not assume.                     |
| **Codex**                      | `spawn_agent` from an OS-level timer; no native scheduler documented | `pulse.sh` flock                                               | OS-level                                        | Multi-agent is feature-flagged — `codex features list` before designing around it.                       |
| **Cursor**                     | `Task` from an OS-level timer                                        | `pulse.sh` flock                                               | OS-level                                        | Cannot nest twice, so tier 3 sub-agents are unavailable there.                                           |
| **Bare container**             | `systemd` timer, or `cron`, or a supervised `while` loop             | `flock` in `pulse.sh`                                          | **Yes**                                         | The reference implementation. §5.3.                                                                      |

Two facts worth stating loudly because they will otherwise be assumed away:

- **In-session cron is idle-gated.** A pulse that takes twelve minutes of model time delays the next
  fire. That is a _feature_ — it prevents overlap — but it means the armed interval is a floor, not a
  period, and the ledger must record the actual gap rather than the intended one.
- **Session-only means session-only.** A design that promises overnight autonomy on a laptop under
  in-session cron is promising something the tool's own documentation denies.

### 5.3 The bare container — the minimum viable driver

The case the owner cares most about: a Hetzner box, no CLI host, running forever.

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │  systemd                                                               │
  │   ├── consciousness.timer     OnUnitInactiveSec=15min, Persistent=yes  │
  │   └── consciousness.service   Type=oneshot                             │
  │         ExecStart=/opt/mind/pulse.sh /srv/repo/.capsules/mind-1        │
  │         TimeoutStartSec=<pulse deadline + slack>                       │
  │         Restart=no          ← a failed pulse must NOT hot-loop         │
  └───────────────────────────┬────────────────────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │  pulse.sh                                                              │
  │   flock -n /srv/repo/.capsules/.locks/mind.pulse  || exit 0            │
  │   bun harness.ts mind:wake --mind $MIND  > $BRIEF                      │
  │   <host CLI> --non-interactive --prompt-file $BRIEF                    │
  │   trap 'bun harness.ts mind:pulse-close --outcome unarmed …' EXIT      │
  └───────────────────────────┬────────────────────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │  liveness, for something OUTSIDE the box to check                      │
  │   .capsules/mind-1/last_pulse.json   { at, outcome, next_wake_at }     │
  │   a 20-line uptime check reads it; stale ⇒ page the owner              │
  └────────────────────────────────────────────────────────────────────────┘
```

Three container-specific facts, one of them measured here:

- **`Persistent=yes` is load-bearing.** After a reboot or a suspend, the timer fires the missed
  pulse instead of silently skipping to the next slot.
- **`Restart=no` is load-bearing.** A pulse that crashes on a poisoned capsule and is restarted
  immediately becomes an infinite crash loop that burns the whole token budget before dawn. Failure
  must wait for the next timer tick, which is the natural backoff.
- **Capsule permissions do not survive a naive copy.** Copying a capsule to the box and then running
  `chmod -R u+w` produced, verbatim:
  `INTEGRITY: prompt.md is writable (write mode bits 200)`. Any provisioning path that moves capsules
  must preserve `0444` on `prompt.md` and on every frozen artifact, or the first pulse refuses.
- **`.capsules/` is gitignored** (`.gitignore:18`). The mind capsule therefore does **not** travel
  with the repository. On a container it needs its own persistent volume and its own backup, or the
  mind is amnesiac on every redeploy. This is the single most likely way a remote deployment quietly
  loses its history.

**The honest floor.** The minimum viable driver on a machine with nothing installed is:

```sh
while :; do /opt/mind/pulse.sh /srv/repo/.capsules/mind-1 || true; sleep 900; done
```

run under any supervisor that restarts it (systemd, tmux + a restart wrapper, `supervisord`). It
satisfies all four obligations. It is worse than the timer only in that a machine reboot loses it
unless the supervisor is itself persistent — which is exactly what `Restart=always` on the _wrapper_
(not on the pulse) provides.

### 5.4 Single-writer, by construction

From the measured race in §0.3, the rules are:

1. **One pulse per mind capsule at a time**, enforced by `flock -n` in `pulse.sh` — a second driver
   exits 0 immediately rather than queueing, so a slow pulse never accumulates a backlog.
2. **One writer per run capsule at a time.** If Consciousness runs a supervision tick against a run
   whose coordinator is live, they race. So: a tick is only taken against a run with **no live
   coordinator grant** — which `agent:list` answers — or when the coordinator's grant has expired.
3. **`INTEGRITY` + `STATE_PROJECTION` is retryable exactly once**, then reported. Every other
   `INTEGRITY` issue is an immediate escalation. This distinction must be in the harness (an error
   subcode), not in a shell script's grep, or it will decay into matching on message text — the
   "counting mentions instead of occurrences" failure from `SUPERVISION.md`.

---

## 6. The wake-up state contract

### 6.1 One command, three tiers of depth

```
bun harness.ts mind:wake --mind .capsules/mind-1
```

Read-only. No mutation, no lock beyond a shared read. It is the only thing a pulse is _required_ to
read, and it must be affordable for a small model with a small context.

**Tier A — the brief. Always returned. Target ≤ 1 KB / ~300 tokens.**

```
### Pulse 1,284  ·  mind-1  ·  2026-08-21T07:51Z
MODE      work            (work | idle | paused | halted)
CHARTER   ok  a3f1…9c2    (ok | DRIFTED | missing)
RUNTIME   ok  0.2.0       (ok | drifted | unknown)
INTEGRITY ok               (ok | repairable | FAILED)
BUDGET    41/96 pulses today · 2h11m/6h wall · 3/8 agents
GAP       17m (armed 15m; driver late by 2m)

RUNS      2 live
  gvui-auth-hardening      executing   3 tasks  1 leased  0 escalated  gates 2/3 green
  skills-queue-item-4      validating  1 task   0 leased  1 escalated  gates 1/1 green

ATTENTION 1 escalation · 2 open findings · 1 stale lease · 0 unrepairable
HEALTH    intent-drift 35 · unused-code 2 · unenforced 4        (last run 41m ago)

LANE      rescue          (rescue | repair | advance | discover | quiesce)
NEXT      bun harness.ts orchestrator:supervise --run .capsules/gvui-auth-hardening \
            --actor consciousness-1
THEN      bun harness.ts mind:pulse-close --mind .capsules/mind-1 --outcome rescued \
            --witness <command-id> --arm 15m
```

Every line is a fact the harness measured, or the literal word `unknown`. The last two lines are the
`RAILS.md` "Prescribe" mechanism at tier 0: **the pulse is handed its next move as argv, not as a
description of a move.**

**Tier B — depth on demand.** `mind:wake --run <run>` returns that run's `handoff.md`, which already
carries waves, grants, branches, tasks, requirements, open findings, gates, commands, packets,
orphan evidence, completion blockers, recent events and the exact next argv. Nothing to build except
the reader.

**Tier C — the raw capsule.** Only ever reached through `explain --code <CODE>` or a named artifact.
The rule from `CHANNEL.md` holds: _a model should never have to read this skill's internals to use
it correctly._

### 6.2 Cost, measured

| Call                                            | Bytes |   Wall |
| :---------------------------------------------- | ----: | -----: |
| `run:status` markdown, 1-task capsule           |   476 |  ~0.1s |
| `run:status` markdown, 3-task capsule           |   801 |  ~0.1s |
| `run:status --format json`, 1-task capsule      | 5,428 |  ~0.1s |
| `orchestrator:supervise` single tick (markdown) |  ~600 | ~0.15s |

The markdown briefs are bounded by `cli/formatters/line-limiter.ts` at 30 lines, so they do **not**
scale with task count — a 200-task run still returns 30 lines. That bound is why a Tier A brief of
~1 KB is realistic rather than aspirational, and it is the single most important existing property
for weak-model affordability. `--format json` is unbounded and must never be the default path for a
pulse.

**The budget:** a pulse's orientation must cost **under 2 KB of harness output**. If it costs more,
the brief is wrong, not the model.

### 6.3 What has to be built, and what merely has to be wired

| Piece                                      | State today                                                     | Work                                                                                                              |
| :----------------------------------------- | :-------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| Per-run status, occupancy, phase           | exists (`run:status`)                                           | call it                                                                                                           |
| Escalations, retries, dead agents, backoff | exists (`buildMorningReport`)                                   | call it                                                                                                           |
| Live leases and grants                     | exists (`agent:list`, task `lease`)                             | call it                                                                                                           |
| Legal next argv                            | exists (`nextActions`) but is **unreachable from `run:status`** | surface it — `CHANNEL.md` R6 already asks for this                                                                |
| Handoff render on demand                   | write-only side effect, **no reader command**                   | add `--run` mode to `mind:wake`; refresh after `task:submit` and after a tick                                     |
| Charter digest check                       | does not exist                                                  | new (§8)                                                                                                          |
| Runtime freshness at pulse time            | exists but only fires at `plan:init`                            | call `assertInstalledRuntimeFresh` from `mind:wake`                                                               |
| Budget accounting                          | does not exist                                                  | new (§11)                                                                                                         |
| Driver-lateness (`GAP`)                    | does not exist                                                  | trivial: `now − last_pulse.closed_at` vs armed interval                                                           |
| Lane selection                             | does not exist                                                  | new — but it is a pure function of the numbers above, so it is derivable and **must be derived, never asked for** |

That table is the real scope of the wake-up contract: **most of it already exists and is not
plumbed.** This is the plan's cheapest, highest-value work.

---

## 7. Task discovery and self-judgement

The hardest question in the brief, and the one where an infinite loop most reliably goes wrong.

### 7.1 The witness rule

> **A candidate task must cite one recorded command whose output contains the defect. No witness, no
> candidate. The command id is `harness_observed`; everything the model says about it is
> `agent_reported` and proves nothing.**

This is the single structural device that makes busywork hard. It does not ask the model to be
disciplined; it removes the input channel through which undisciplined work arrives. There is no
source that emits _"it would be nice if…"_, so `mind:candidate` refuses a candidate without
`--witness <command-id>`, and refuses a witness whose recorded exit code and output do not actually
contain the cited defect.

It is the same move `gate:prove` makes for gates, and `task:submit --no-op` makes for effort: convert
a claim into a mechanically checkable fact. `RAILS.md` calls it _Prove_.

### 7.2 The ten legitimate sources

Each is a real command in this repository today.

```
   SOURCE                                    COMMAND (exists today)                       CLASS
   ─────────────────────────────────────     ────────────────────────────────────────     ──────────────
 1 code that no longer matches intent        health --check intent-drift --all            harness_observed
 2 dead / unreachable / unenforced code      health --check unused-code,dead-code,…       harness_observed
 3 literal fallbacks (fabricated values)     health --check literal-fallbacks             harness_observed
 4 open findings from real validators        finding:get --run <r> --all                  agent_reported *
 5 escalated tasks awaiting a human          run:status / morning report needsHuman       harness_observed
 6 gates whose recorded exit ≠ 0             failingGateRuns / evidence:get               harness_observed
 7 capsule integrity damage                  doctor --run <r>                             harness_observed
 8 install / runtime drift                   installation-status --home … --source …      harness_observed
 9 unsealed capsules with live leases        run:status across .capsules/                 harness_observed
10 owner backlog in the charter's documents  health intent-drift over CHARTER refs        harness_observed

   * a finding is an agent's assertion, but a finding that reached the ledger already survived
     the validator's own gate run, which is harness_observed. That is why it counts.
```

**Deliberately not a source: the model's own idea.** Novelty has exactly one door (§7.4).

Note the anti-circularity property, which is failure mode 6 answered directly: sources 1 and 10
compare code against **owner-written documents Consciousness cannot edit**. `health/intent.ts`
already parses backticked tokens out of headings in intent documents and checks whether each named
command, identifier and path exists in production and in tests. Requirements are not derived from the
plan; they are derived from a document with a different author. That is what makes "every requirement
is covered" a claim capable of being false.

### 7.3 The admission test — six mechanical gates

`mind:admit` refuses unless all six pass, and records which one failed when it refuses.

| #   | Gate                | Question                                                                                                  | Decided by                                                          |
| --- | :------------------ | :-------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------ |
| 1   | **Witnessed**       | Is there a recorded command whose output shows this defect?                                               | harness: the command record exists and its output matches           |
| 2   | **In charter**      | Does a charter goal id admit it? Does any non-goal exclude it?                                            | harness: goal id must be cited and must exist in the pinned charter |
| 3   | **Falsifiable**     | Is there a command that fails now and would pass if this were fixed?                                      | agent declares it; harness **runs it now and requires non-zero**    |
| 4   | **Scoped**          | Is the write scope narrow, disjoint from every live lease, inside the charter's repo roots?               | harness: `scopeConflict` + charter roots                            |
| 5   | **Affordable**      | Does the remaining budget cover the declared round budget?                                                | harness: arithmetic on the budget ledger                            |
| 6   | **Not a duplicate** | Is there an open candidate, a live task, or a _declined_ candidate with the same witness class and scope? | harness: candidate ledger lookup                                    |

Gate 3 is the load-bearing one and it is the direct ancestor of `gate:prove`. A candidate whose
"failing command" already exits 0 is not a defect; it is a wish. Requiring the harness to _run_ it
during admission — not merely to record that the agent named it — is what stops a weak model from
naming a plausible command it never executed.

Gate 6 with the "_declined_" clause is what stops the loop from re-proposing the same rejected idea
every night forever. A declined candidate is remembered.

### 7.4 Novelty: proposal, not adoption

The owner explicitly wants creative feature discovery. The honest way to give it that without letting
it redefine the product:

```
   model has an idea
          │
          ▼
   mind:candidate --kind proposal --statement "…" --rationale "…" --charter-goal <id>
          │                                   (a proposal needs no witness — that is
          │                                    exactly why it may not be adopted)
          ▼
   recorded as a needs_authority REQUIREMENT in the mind capsule
          │
          ├──────────────► surfaced in the wake brief's ATTENTION line, forever, until decided
          ├──────────────► surfaced in the owner's digest
          │
          ▼
   OWNER runs:  authority:decide --requirement <id> --decision grant|decline --rationale "…"
          │
   grant ─┴─ decline
     │            └─► disposed out_of_scope, remembered, never re-proposed (gate 6)
     ▼
   becomes an admissible candidate; still must pass gates 2-6 (it can never pass gate 1,
   so a granted proposal carries `witness: owner-decision` explicitly)
```

This reuses `authority:decide` and the `needs_authority` disposition exactly as built, including
`nextActions`'s existing line: _"requirement X is paused for an authority decision and no registry
command records one; every task bound to it stays undispatched."_ Consciousness is not granted
`authority:decide`. It cannot approve its own ideas. That is the whole design.

**A cap on proposals.** At most **one open proposal per N pulses** (charter-configured, suggested 24
hours), and a hard ceiling on open proposals (suggested 5). Without a cap, the loop that must always
find something will produce a proposal every pulse, and the owner's inbox becomes the busywork the
discipline was meant to prevent.

### 7.5 Idling well

> Idling is a first-class outcome with its own record, not a failure to find work.

`mind:quiesce` records a **quiescent pulse**: the sources checked, the command id each returned, the
count each returned, and the resulting interval. It is a positive statement — _"I checked ten places
and all ten were clean"_ — and it is the most valuable line in the ledger, because it is the one a
human can use to decide whether the system is healthy or merely asleep.

Consequences of quiescence:

- The wake interval **multiplies** (suggested ×1.5, capped at the charter's `max_interval`, suggested
  4 hours). Consecutive quiescence is cheap by construction.
- After K consecutive quiescent pulses (suggested 8), Consciousness sends **one** digest — not a
  page — saying "the repository has been clean for K pulses; here is what I check". Then it keeps
  going at the capped interval.
- The interval **resets to the charter's base** the moment any source returns non-empty.

That is exactly the `SUPERVISION.md` shape (_"progress resets the backoff"_), and exactly the
`failure-classifier` shape (bounded backoff with a ceiling), applied to attention rather than to
retries.

### 7.6 What this rules out — the busywork catalogue

Naming the failures makes the rules checkable.

| Busywork shape                             | What blocks it                                                                                 |
| :----------------------------------------- | :--------------------------------------------------------------------------------------------- |
| "Improve error messages in `foo.ts`"       | Gate 1 — no witness                                                                            |
| "Add tests for coverage"                   | Gate 3 — name the command that fails now; a coverage floor that already passes is not a defect |
| "Refactor for readability"                 | Gates 1 and 3                                                                                  |
| "Add a feature users would like"           | Gate 2 unless a charter goal admits it; otherwise it is a proposal                             |
| Re-proposing last night's declined idea    | Gate 6 remembers declines                                                                      |
| Fixing the same drift finding twice        | Gate 6 duplicate-scope check                                                                   |
| A dozen shallow tasks to look productive   | One lane per pulse; round budget in the packet                                                 |
| Rewriting the goal to match what it did    | The charter guard (§8); Consciousness holds no write on the charter                            |
| "≥5 validator pushbacks" quota-filled work | **No prompt anywhere states a target count.** §12.4                                            |
| Churning a file to make the mtime move     | `task:submit`'s C4 no-op refusal                                                               |

---

## 8. Anti-drift: the charter

### 8.1 What it is

One owner-written file at a charter path named in the mind manifest — suggested
`docs/consciousness/CHARTER.md`. It is the answer to _"what does this application actually want"_, and
it is the only thing standing between an infinite loop and a redefined product.

```
CHARTER.md
├── identity        what this application is, in the owner's words, one paragraph
├── goals           G1…Gn — each with an id, a statement, and a "done looks like" line
├── non-goals       explicit exclusions. A candidate touching one is refused, not debated.
├── repo_roots      the only paths any agent may write
├── stability       the exact commands that define "the app is stable", and their expected exit
├── gates           which of those are blocking and which are advisory
├── budgets         pulses/day · wall-clock/day · max concurrent agents · quiet hours · intervals
├── prohibitions    the never-unattended list (§11.3), verbatim, copied into every packet
├── escalation      how to reach the owner, and what is worth reaching them for
└── open_questions  the owner's own unresolved decisions — a legitimate discovery source
```

`stability` is what turns the owner's phrase _"is the app stable according to all the validation
guidelines"_ into something mechanical: a list of commands and expected exits, run by the harness,
recorded with evidence. Not a feeling.

### 8.2 The charter guard

Modelled directly on `graph/revision-guard.ts:75-83`, which the brief correctly identifies as the
best-designed code in the subsystem and which encodes exactly the shape needed here:

```
   revision-guard (exists, tier 2/3)          charter-guard (proposed, tier 0)
   ────────────────────────────────           ────────────────────────────────
   requirement source contracts               charter identity + goals + non-goals
     may never change                           may never change
   graph revision must increase by 1          mind generation must increase by 1
   active task contracts freeze               an in-flight objective's statement freezes
   interior (tasks, deps, scopes) mutable     interior (candidates, pulses, runs) mutable
   supersession needs an explanation          a retired goal needs an owner decision
```

Enforcement, in the order it fires:

1. **At `mind:init`**, the charter's sha256 is pinned into the mind manifest, alongside the
   `runtime_version` and the resolved harness digest.
2. **At every `mind:wake`**, the charter is re-hashed. A mismatch is not a warning and not a
   re-pin — it is **`HALT`**: the pulse stops, escalates, and does not arm. The owner re-pins with
   an explicit command that records who changed what and why.
3. **`mind:admit` gate 2** requires a cited goal id that exists in the pinned charter. A candidate
   citing a goal that is not there is refused with the list of goals that _are_.
4. **Consciousness holds no command that writes the charter**, and its `must_not` says so. Since
   `assertGrantedCommand` refuses out-of-contract commands at the CLI door, this is a rail for every
   harness path — but note the honest limit in §11.4: it is not a rail for a shell.

### 8.3 Why the halt is right, and what it costs

A charter change is the one event where "keep going" is unambiguously wrong. If the owner edited it,
Consciousness must re-read a _different_ document than the one it has been serving, and no automatic
reconciliation is safe. If something _else_ edited it, that is a security event.

The cost is real and should be stated: **the owner will trip this by editing the charter and
forgetting to re-pin, and will find the mind halted in the morning.** Mitigations: the halt escalates
immediately via `PushNotification` rather than waiting to be discovered; the re-pin command is one
line and appears verbatim in the halt message; and the digest is reported in every wake brief so the
owner sees it change.

---

## 9. Crash detection and recovery

Built on what exists. The design adds two things and reuses seven.

### 9.1 The five liveness questions

```
                 WHO IS DEAD?                            ANSWERED BY
  ┌───────────────────────────────────────┐   ┌─────────────────────────────────────┐
  │ 1. a tier-3 agent holding a lease     │──►│ recoverStale — time-based, exists    │
  │ 2. a branch sub-agent or a chain      │──►│ recoverBranchSubTasks — exists       │
  │ 3. a coordinator / orchestrator       │──►│ grant expiry + no events since ⇒ NEW │
  │ 4. the pulse itself                   │──►│ pulse deadline + open ⇒ NEW          │
  │ 5. the driver (nothing fires at all)  │──►│ last_pulse.json staleness ⇒ NEW,     │
  │                                       │   │ and it must be checked from OUTSIDE  │
  └───────────────────────────────────────┘   └─────────────────────────────────────┘
```

Questions 1 and 2 are solved. 3, 4 and 5 are the new work, and each is deliberately **time-based and
stateless**, so that a pulse arriving after any crash reaches the same answer a continuously running
process would have — the property `supervision-tick.ts` was designed for.

### 9.2 The ladder

Every rung is an existing command except where marked NEW.

```
   ┌── 0 ── mind:wake reports INTEGRITY / CHARTER / RUNTIME ───────────────────────┐
   │                                                                              │
   │   charter drift ────────────────────────────► HALT + escalate  (no arm)      │
   │   runtime drift ────────────────────────────► HALT + escalate  (no arm)      │
   │   INTEGRITY:STATE_PROJECTION ───────────────► retry once, then escalate      │
   │   INTEGRITY:other ──────────────────────────► doctor --run … then            │
   │                                                doctor:repair --run … then     │
   │                                                escalate if still failing      │
   └──────────────────────────────────────────────────────────────────────────────┘
   ┌── 1 ── per live run: orchestrator:supervise --run <r> --actor consciousness ──┐
   │        reclaims expired leases · escalates deterministic dead ends ·          │
   │        surfaces changes_requested · returns the morning report                │
   └──────────────────────────────────────────────────────────────────────────────┘
   ┌── 2 ── residue the tick cannot fix ──────────────────────────────────────────┐
   │        open attempt, agent gone ───────────► task:abandon --reason …          │
   │        orphan evidence ───────────────────► escalate (coordinator disposes)   │
   │        abandoned worktrees ───────────────► worktree:reclaim                  │
   └──────────────────────────────────────────────────────────────────────────────┘
   ┌── 3 ── dead tier-1/tier-2 agent  (NEW) ──────────────────────────────────────┐
   │        grant active + no event attributable to it for > grant_idle_seconds    │
   │        ⇒ agent:release --reason presumed_dead, then redeploy or escalate      │
   └──────────────────────────────────────────────────────────────────────────────┘
   ┌── 4 ── dead pulse  (NEW) ────────────────────────────────────────────────────┐
   │        pulse open + deadline_at passed ⇒ close it `crashed`, count it,        │
   │        and if crashes ≥ 3 consecutive ⇒ HALT + escalate (poisoned capsule)    │
   └──────────────────────────────────────────────────────────────────────────────┘
   ┌── 5 ── dead driver  (NEW, partly external) ──────────────────────────────────┐
   │        inside: GAP = now − last_pulse.closed_at; > 3× armed ⇒ record + notify │
   │        outside: last_pulse.json read by anything at all — a second cron,      │
   │                 an uptime ping, a phone. Nothing inside a dead system can     │
   │                 report that it is dead.                                       │
   └──────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 Dead pulse reclaim, in detail

A pulse is a lease over a mind capsule. It should be treated as one, using the same clock and the
same idea as `recoverStale` — no timer, no daemon:

- `mind:pulse-open` records `opened_at`, `deadline_at = opened_at + pulse_deadline`, host, driver,
  and the pulse's own id.
- `mind:pulse-close` is refused if the pulse id does not match the open one.
- `mind:wake` finding an open pulse whose `deadline_at` has passed **plus grace** closes it with
  outcome `crashed`, records the evidence (`no close within deadline`), and proceeds.
- Three consecutive `crashed` outcomes is a deterministic failure by the existing
  `classifyFailure` logic (`crash` is repeat-bounded, default threshold 3) and triggers `HALT`.

That last line is deliberate reuse: `failure-classifier.ts` already treats `crash` as transient until
it repeats three times, then deterministic. A poisoned mind capsule that crashes every pulse will
therefore stop itself after three attempts rather than crash-looping until morning.

### 9.4 Quota pauses, never terminates

The owner's explicit requirement, and it already matches the harness's own behaviour:
`failure-classifier.ts` classes `rate_limit`, `network`, `provider_5xx` and `timeout` as **transient
and unbounded in count**, bounded only by elapsed time (4 h default), with exponential backoff and
jitter.

At the pulse level:

- A quota signal observed **in an error record** — never in text an agent happened to read — closes
  the pulse `paused` and multiplies the armed interval (suggested ×2, capped at the charter's
  `max_pause_interval`, suggested 30 min).
- **Nothing is killed.** Leases stay live, attempts stay open, worktrees stay put. Everything is
  resumable when tokens refresh.
- Progress clears the multiplier.

The "in an error record" clause is not a detail. `SUPERVISION.md` records the exact failure: _"A naive
scan for quota terms matched 473 agent transcripts — because agents were reading
`failure-classifier.ts`, whose source text contains `RESOURCE_EXHAUSTED` and `rate_limit`."_ The
detector must match a structured field, never a substring of prose. In this design that means the
pulse reports a quota signal through `mind:pulse-close --signal rate_limit`, and the harness records
it as a typed value — it never greps anything.

---

## 10. Model and effort selection

### 10.1 The rule that governs everything else

This project's standing rule — _never assume model names, tiers or thinking levels; record only
observed values_ — and the owner's wish for "best decisions on sub-agent, model and thinking level"
reconcile in one move:

> **The policy names abstract profiles. The owner binds profiles to concrete values. The harness
> records what was actually used. Nothing in the skill ever contains a model name.**

### 10.2 The mechanism

```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ 1. PROBE      detectHostTelemetry() → HostCapabilities                   │
   │               per_agent_model_selection? concurrency_ceiling?            │
   │               nesting_depth? native_resume? multi_agent_enabled?         │
   │               ── exists today in summary/host-telemetry.ts               │
   ├─────────────────────────────────────────────────────────────────────────┤
   │ 2. RESOLVE    role → abstract profile      (in the skill, no names)      │
   │                 consciousness      → deliberate                          │
   │                 orchestrator       → deliberate                          │
   │                 coordinator        → default                             │
   │                 planner            → deliberate                          │
   │                 implementer        → default                             │
   │                 validator/critic   → adversarial                         │
   │                 sub-investigator   → cheap_bulk                          │
   ├─────────────────────────────────────────────────────────────────────────┤
   │ 3. BIND       profile → concrete           (owner file, never the skill) │
   │                 consciousness.profiles.json, e.g.                        │
   │                 { "adversarial": { "effort": "<value the host accepts>" } }
   │               UNBOUND PROFILE ⇒ INHERIT ⇒ recorded as `unknown`          │
   ├─────────────────────────────────────────────────────────────────────────┤
   │ 4. RECORD     agent:register --model / --model-tier / --thinking-level   │
   │               each Evidenced<T>; absent stays absent                     │
   ├─────────────────────────────────────────────────────────────────────────┤
   │ 5. DEGRADE    host cannot select per agent ⇒ do not emit the parameter,  │
   │               record "per-agent model selection unavailable on <host>",  │
   │               and say so in the run summary. Never pretend.              │
   └─────────────────────────────────────────────────────────────────────────┘
```

Step 3 is what keeps the skill honest: a model name is a _value the owner observed on their host_,
so it lives in the owner's config, exactly as `model-effort-policy.md` records the owner's own 2026-08-20
decision table rather than the skill encoding it.

### 10.3 What the recorded evidence already says

From `model-effort-policy.md`, which is the owner's own research and is marked **deferred**:

- No supported host routes by task difficulty. Per-agent selection exists; difficulty-based routing
  does not. Codex is the only host where `model` and `reasoning_effort` are first-class spawn
  parameters.
- Effort is the cheap dial: `low` gave up 1–3 points for a third to a half off cost; `medium` matched
  the default's accuracy at 70–85% of cost.
- Coordinator-plus-worker tiering **lost** to the coordinator's own model at lower effort in every
  measured case except two: work exceeding one context window, and tail insurance on routine work.
- The widely-cited 2025 multi-agent result is contradicted by the 2026 measurements.
- **Never set `CLAUDE_CODE_SUBAGENT_MODEL`** — it outranks everything and fails silently.

The shape that evidence supports, and which this design adopts as its default binding: **model mostly
inherited, effort as the per-role dial.** Highest effort for adversarial verification and
architecture; middle for implementation against a clear spec; lowest for mechanical work.

Because the owner's decision is deferred, the _skill_ ships with every profile **unbound** — i.e.
inherit everything — and the first thing a new deployment does is bind them. An unbound deployment
works; it is simply not optimised, and its ledger says so.

### 10.4 Adaptation, and the threshold it is gated behind

The tempting feature is "learn which profile works best". The honest version:

- The data already exists: `AgentGrantRecord` carries `model`/`thinking_level` per agent, and
  `task:review` records verdicts per task. Joining them gives _observed_ pass-rate, repair-round
  count and wall-clock per profile.
- **Do not adapt until the join has enough observations to mean anything.** Suggested floor: 30
  completed implementer/validator pairs per profile, per repository. Below that, report the numbers
  and change nothing.
- When it does adapt, it adapts **one dial, one step, and records the change as a decision with the
  evidence** — never a silent re-tuning.
- It may never adapt _itself_ upward into a more expensive profile without an owner decision. That is
  a budget change, and budgets belong to the charter.

This is the most speculative section of the plan and should be the last thing built. §14 lists it as
a risk.

---

## 11. Cost and safety bounds

### 11.1 The budget block

Lives in the charter, enforced at the CLI door, reported in every wake brief.

| Key                        | Suggested default | Enforced by                                                   |
| :------------------------- | :---------------- | :------------------------------------------------------------ |
| `pulses_per_day`           | 96 (15 min)       | `mind:pulse-open` refuses past the count; outcome `deferred`  |
| `wall_clock_per_day`       | 6 h               | Same, summed from pulse durations                             |
| `max_agents_in_flight`     | 8                 | `mind:admit` gate 5; also `max_agents` (100) caps grants/run  |
| `max_rounds_per_objective` | 3                 | Orchestrator packet; `AutonomousLoopRunner` caps at 10 anyway |
| `base_interval`            | 15 min            | Armed by default                                              |
| `max_interval`             | 4 h               | Ceiling on quiescent backoff                                  |
| `quiet_hours`              | none              | `mind:pulse-open` → `deferred`                                |
| `max_open_proposals`       | 5                 | `mind:candidate --kind proposal` refuses past it              |
| `pulse_deadline`           | 20 min            | Dead-pulse reclaim (§9.3)                                     |

Every one of these is a **refusal**, not a warning. A budget that logs a warning and proceeds is not a
budget.

### 11.2 Value per pulse, and the throttle

Define value mechanically so it cannot be talked up:

```
   value(pulse) =  leases_reclaimed
                +  findings_resolved
                +  gates_flipped_red_to_green
                +  tasks_reaching_done
                +  candidates_admitted
                +  proposals_recorded        (capped at 1 per pulse)
```

Every term is a count the harness measured. Explicitly **not** counted: files touched, commands run,
tokens spent, agents deployed, words written.

The throttle, borrowing `nextBackoffDelayMs`'s exact shape (exponential, capped, jittered):

- `value > 0` → interval resets to `base_interval`.
- `value == 0` for K consecutive pulses → `interval = min(max_interval, base × 1.5^K)`.
- Add jitter, for the same reason `CronCreate` does: many machines choosing the same minute is a
  self-inflicted thundering herd.
- Report the trailing value series in the owner digest. **A long flat zero is either a healthy repo
  or a broken mind, and only a human can tell which** — so the digest must show it rather than hide
  it behind a summary.

### 11.3 The never-unattended list

Copied verbatim into every packet, and stated as `must_not` in every new role contract.

```
   NEVER, unattended, at any tier:
   ─────────────────────────────────────────────────────────────────────────────
   git push · git push --force · merge or rebase onto a default branch ·
   branch or tag deletion · history rewrite · git reset --hard on a dirty tree
   ─────────────────────────────────────────────────────────────────────────────
   any write outside charter.repo_roots · any delete outside a leased write scope ·
   rm -rf anywhere · chmod/chown outside the capsule
   ─────────────────────────────────────────────────────────────────────────────
   package publish · deploy · DB migration · infrastructure change ·
   creating or commenting on issues/PRs · sending mail · any outbound webhook
   ─────────────────────────────────────────────────────────────────────────────
   secrets: reading, writing, printing, or moving credentials of any kind
   ─────────────────────────────────────────────────────────────────────────────
   self-modification: editing CHARTER.md · editing any role contract ·
   editing budgets · installing/upgrading/relinking the harness runtime
   ─────────────────────────────────────────────────────────────────────────────
   process termination without the ancestry check, and NEVER these:
     agy · claude · wezterm-gui · tmux · zsh/bash/login/sh and their subprocesses
     (from AUTONOMOUS.md — killing the owner's editor costs more than a slow machine)
```

**Escalate rather than decide:** any product-scope judgement; any change to a public contract or
schema; a blast radius exceeding the declared write scope; a charter digest mismatch; three
consecutive crashed pulses; an integrity failure `doctor:repair` cannot fix; a candidate that would
require a prohibition to be lifted; any finding whose remediation is "change the requirement".

### 11.4 Where the bound actually lives — the honest part

**The CLI door constrains harness commands. It does not constrain a shell.**

`assertGrantedCommand` refuses `plan:compile` from a consciousness grant. It cannot refuse
`rm -rf /`, because that is not a harness command. A tier-3 agent with a Bash tool can do anything the
OS user can do, and this is true today for every existing role too.

Therefore the real safety bound is a stack of three, and the plan must not pretend it is one:

1. **The host's own permission system** — the first and most important layer. Allow-lists, prompts,
   and the fact that a human granted the session its powers.
2. **The blast radius of the account and machine** — no push credentials in the container, a
   dedicated key with no write to protected branches, no production credentials present at all,
   branch protection server-side.
3. **The harness rails** — which are excellent at what they cover (state, evidence, contracts,
   scopes) and irrelevant to what they do not.

For the remote container specifically: **give it a repository clone with no push remote at all, and
let the owner pull from it.** That converts "must never push" from a rule an agent could break into a
capability it does not have. That single decision is worth more than every prohibition in §11.3.

---

## 12. How Consciousness itself is validated

### 12.1 The tautology, one level up

Failure mode 6 says: if the plan generates the requirements, "every requirement is covered" proves
nothing. One level up: if Consciousness generates its own objectives and grades its own outcomes,
"the system is healthy" proves nothing.

Five independent checks, in increasing cost.

### 12.2 The five checks

**1. The charter is not written by it.** Ground truth has a different author, is hash-pinned, and a
mismatch halts. §8.

**2. `intent-drift` compares code to owner documents.** `health/intent.ts` parses backticked tokens
from headings in intent documents and checks each named command, identifier and path against
production and test sources. Consciousness cannot edit those documents. This is a mechanical oracle
with an external author — the single most valuable existing property for this section.

**3. The `consciousness-auditor` — a critic for the mind.** Tier 1, dispatched by Consciousness but
structurally independent, on a cadence the charter sets (suggested: every 24 h or every 50 pulses,
whichever first).

```yaml
role: consciousness-auditor
tier: 1
may:
  - Read the pulse ledger, the candidate ledger, every capsule, and the repository
  - Run its own independent commands against the repository
  - Re-run the admission test against candidates that were already admitted
  - Record findings that block, or approve with an explicit residual-risk list
  - Halt Consciousness
must_not:
  - Read Consciousness's own narrative, rationale prose, or self-assessment
  - Audit a period in which it acted as orchestrator, coordinator, implementer or validator
  - Approve while any pulse in the window is unaccounted for
  - Edit any repository file, the charter, or any ledger
commands:
  [
    mind:audit-report,
    mind:halt,
    run:status,
    doctor,
    health,
    finding:get,
    report:get,
    evidence:get,
    summary:view,
    run:exec,
    agent:register,
    agent:release,
  ]
spawns: []
```

Its questionnaire is fixed, and every answer must cite a command id:

1. Does every pulse in the window have exactly one open and one close? Name the gaps.
2. Does every admitted candidate still have a witness whose command output shows the defect?
3. Did any admitted candidate cite a charter goal that does not exist?
4. Is the trailing value series consistent with the work the ledger claims?
5. Did anything change outside a declared write scope? (out-of-band drift)
6. Did any pulse take an action on the never-unattended list?
7. What did the mind _decline_ to do, and does the reason survive re-reading?
8. Did the charter digest change without an owner decision?

Its verdict is consumed by the _next_ pulse, which cannot proceed past `WAKE` while an audit finding
is open. A `halt` verdict stops the mind.

**4. The owner digest.** Periodic, human-readable, built on `formatMorningReportMarkdown`'s existing
shape. It must contain one section nothing else contains: **"What I would have done without asking"**
— every declined candidate and every open proposal, with its reason. That section is where a human
notices the mind drifting, long before any metric does.

**5. The counterfactual re-admission test.** Cheap and unusually effective: periodically, take a
_previously admitted_ candidate and re-run the admission test with a fresh agent that has no memory of
the adoption. If it would not be admitted now, that is a finding — either the defect was already
fixed, or it was never real. This directly attacks the failure where a system rationalises work it
has already started.

### 12.3 What is deliberately not a validation

- **Consciousness's own summary of its night.** It is `agent_reported` and proves nothing.
- **Pulse count, agents deployed, commands run, tokens spent.** Activity is not value; §11.2 exists
  precisely to keep these out of the numerator.
- **"All gates green."** Green from one lane is failure mode 8. The charter's `stability` block must
  name _every_ lane that matters — unit and integration and typecheck and lint — because _"the unit
  lane passed while the integration lane sat at 45 failures and CI had never run the real tests since
  the repo's first commit."_

### 12.4 No prompt-dictated quotas — anywhere

Failure mode 10 in one line: _a run asked for ">=5 validator pushbacks" produced exactly 5._

Therefore **no prompt, packet, role contract or brief produced by this design may ever state a target
count for candidates, findings, probes, proposals or tasks.** Only _ceilings_ (a maximum, refused when
exceeded) and _floors that are structural rather than numeric_ (every implementer has a validator;
every pass records at least the configured adversarial probe round). Zero candidates is a correct and
common answer, and the design must make it comfortable to give.

---

## 13. Implementation guide

### 13.0 Phase 0 — make the ground trustworthy (half a day)

| Deliverable                                                                                           | Built by                    | Validation                                                                                                                                                            |
| :---------------------------------------------------------------------------------------------------- | :-------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix `--watch`'s silent exit: drop the `unref`, or `await main()` at the top level of `harness.ts`     | 1 implementer + 1 validator | A test that runs `--watch --interval 1` under a stop signal and asserts **≥ 2 ticks** and non-empty stdout. The current code passes no such test because none exists. |
| Add an error subcode so `INTEGRITY:STATE_PROJECTION` is distinguishable from other integrity failures | same pair                   | Concurrency test: N simultaneous ticks; every failure carries the subcode                                                                                             |
| Surface `nextActions` from `run:status` (`CHANNEL.md` R6)                                             | 1 implementer + 1 validator | `run:status` on a mid-flight capsule returns the argv `handoff.md` returns                                                                                            |
| Refresh `handoff.md` after `task:submit` and after a supervision tick                                 | same pair                   | Submit a task, assert `handoff.md` mtime and content moved                                                                                                            |

Phase 0 is not Consciousness. It is the difference between building on rock and building on the
`--watch` bug.

### 13.1 Phase 1 — Pulse Zero: the cheapest thing that proves the idea

**This is what to build first.** It dispatches nothing, decides nothing, and can break nothing.

Deliverables:

- `CHARTER.md` for this repository, written by the owner.
- `mind:init`, `mind:wake`, `mind:pulse-open`, `mind:pulse-close` — four commands, reusing the
  existing store (events, projection, flock, integrity) so crash-safety and `doctor` come free.
- `roles/consciousness.md`, in the **observe-only** variant: `commands` limited to the four above
  plus the read-only diagnostics. No `spawns`.
- `scripts/pulse.sh` — lock, invoke, trap, release. Under 40 lines. Every construct dry-run on the
  target machine first.
- `last_pulse.json`, written outside the event chain, for external liveness.

**The overnight experiment.** Arm it against this repository at a 15-minute interval and let it run a
night. The only permitted outcomes are `quiescent`, `deferred`, `paused` and `escalated`. In the
morning, the pass bar is:

1. Every pulse has exactly one open and one close. No gaps, no double-opens.
2. Every wake brief was under 2 KB.
3. The armed interval was honoured within jitter, and every deviation is explained by a recorded
   reason (idle-gating, quota, quiet hours).
4. `doctor` on the mind capsule reports healthy.
5. **A human reads the ledger and can say what happened without asking anyone.**

If that fails, nothing further is worth building. If it passes, everything after it is incremental.
Cost: roughly one implementer/validator pair for the commands, one for the driver, one night of
tokens at the lowest useful profile.

### 13.2 Phase 2 — maintenance autonomy (RESCUE + REPAIR lanes)

- The lane selector, derived from the brief's numbers — never asked for.
- RESCUE: `orchestrator:supervise` per live run, then the residue ladder (§9.2 rung 2).
- REPAIR: triage open findings, failing gates and escalations into an **escalation digest**. It still
  dispatches nothing; it produces the thing a human reads at breakfast.
- Dead-pulse reclaim (§9.3) and the driver-lateness `GAP` line.

Validation: inject damage deliberately into a scratch capsule — expire a lease, kill an agent
mid-attempt, truncate the tail of `events.jsonl`, corrupt `state.json`, hold two pulses at once — and
assert the ladder reaches the right rung each time and records the evidence. This is the phase where
the monitor gets tested before it is trusted, and the deliberate-damage suite is the deliverable, not
a nice-to-have.

### 13.3 Phase 3 — discovery and judgement (DISCOVER lane)

- `mind:observe`, `mind:candidate`, `mind:admit`, `mind:decline`, `mind:quiesce`.
- The ten sources wired to their real commands.
- The six admission gates, with gate 3 actually executing the falsifying command.
- Proposals as `needs_authority` requirements; the owner's `authority:decide` path.
- Quiescent backoff and the digest.

Validation, and this is the phase whose validation matters most:

- **A negative suite.** Twenty candidate submissions that _must_ be refused — no witness, stale
  witness, witness that exits 0, non-existent charter goal, overlapping scope, over budget, duplicate
  of an open candidate, duplicate of a _declined_ candidate, proposal past the cap. Each asserts the
  specific gate that refused and the repair command that came with the refusal.
- **A week of shadow running.** Discovery on, adoption off: it records what it _would_ have admitted.
  The owner reads a week of that and says how much of it was worth doing. That number is the honest
  measure of whether the discipline works, and it costs almost nothing to obtain.

### 13.4 Phase 4 — the hierarchy (deploy orchestrators)

- `roles/orchestrator.md`; split the dual-role paragraph out of `roles/coordinator.md`.
- `mind:round-open` / `mind:round-close`, built on `chainCapsules`.
- Consciousness deploys a tier-1 orchestrator for one admitted candidate; the orchestrator deploys a
  coordinator; the coordinator runs the existing pipeline.
- The arming rail at tier 1 (a round may not close without a successor or a reason).

Validation: one real objective, end to end, unattended, with the pass bar being the properties this
project has never yet achieved in a real run — **`graph.revision > 1`** (the plan interior actually
moved), **at least one recorded validator rejection or probe** that was not asked for by a quota, and
a `summary:export` a human finds legible.

Deliberately **not** in this phase: `orchestrator:run`. Its executor does not exist, and writing one
means writing host-side dispatch code inside a harness whose first invariant is that it never calls a
model. Rounds are driven pulse-by-pulse instead: one pulse opens a round, later pulses supervise it,
a pulse closes it and chains the next. Slower per round, and it survives everything.

### 13.5 Phase 5 — audit and economics

- `consciousness-auditor` role and `mind:audit-start` / `mind:audit-report`.
- Value-per-pulse accounting and the throttle.
- Budget refusals.
- The owner digest, including "What I would have done without asking".
- The counterfactual re-admission test.

Validation: run the auditor against a **deliberately falsified** ledger — a pulse with no close, an
admitted candidate whose witness command exits 0, a candidate citing a goal that is not in the
charter — and require it to catch every one. An auditor that has never caught a planted defect has
not been tested; this is `gate:prove`'s logic applied to the auditor itself.

### 13.6 Phase 6 — the remote container

- systemd timer + service, `Persistent=yes`, `Restart=no` on the pulse.
- Persistent volume for `.capsules/`, and a backup, because `.capsules/` is gitignored.
- Mind capsule rotation at the event ceiling (§0.2), using `chainCapsules`.
- A clone with **no push remote** (§11.4).
- External liveness: something off-box reads `last_pulse.json` and pages if it is stale.

Validation: a 72-hour soak. Kill the pulse mid-flight; reboot the box; revoke the token for an hour;
fill the disk. After each, the next pulse must resume without human help, and the ledger must say what
happened.

### 13.7 Who builds what

| Phase | Agents                                                                               | Why                                                                        |
| :---- | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| 0     | 2 implementer/validator pairs, parallel (disjoint scopes)                            | Two independent one-file fixes                                             |
| 1     | 1 planner · 1 plan-validator · 3 implementer/validator pairs · 1 completeness critic | The commands, the driver and the role contract are disjoint scopes         |
| 2     | 1 planner · 4 pairs · 1 critic                                                       | The deliberate-damage suite is its own lane and its own scope              |
| 3     | 1 planner · 1 plan-validator · 5 pairs · 1 critic                                    | Ten sources partition cleanly — a natural `plan:add --auto-partition` case |
| 4     | 1 planner · 3 pairs · 1 critic                                                       | Contracts, chaining and the arming rail                                    |
| 5     | 1 planner · 3 pairs · 1 critic + **a different agent for the auditor's own tests**   | The auditor must not be tested by whoever wrote it                         |
| 6     | 1 pair + the owner                                                                   | Infrastructure needs credentials only the owner holds                      |

Effort profiles per §10: `deliberate` for planning and adversarial review, `default` for
implementation, `adversarial` for validators and critics — bound by the owner, never named in the
skill.

### 13.8 What not to build

- **A resident daemon.** It dies with the session and takes the illusion of continuity with it.
- **A second scheduler inside the harness.** The one `setInterval` in the tree is already a cautionary
  tale.
- **A model-selection ladder with names in it.** §10.
- **`orchestrator:run`'s executor**, until rounds have been proven pulse-by-pulse.
- **A dashboard**, before the ledger is legible as plain text. A dashboard over an illegible ledger
  makes the illegibility harder to see.
- **Anything that makes zero-work pulses feel like failure.** That is the pressure that manufactures
  busywork.

---

## 14. Open questions and risks

Stated plainly, including the ones I could not resolve.

### 14.1 Unresolved

1. **Command namespace.** `mind:*` is short — which matters, because a weak model retypes these
   constantly — but the system is called CONSCIOUSNESS and `consciousness:*` is the consistent name.
   I chose `mind:` for typing cost and flagged it; **the owner should decide.**
2. **Where the mind capsule lives.** `.capsules/mind-<gen>/` reuses everything but is gitignored, so
   it does not travel and is not backed up. A `.mind/` directory that _is_ committed would travel and
   would give the owner a diffable history of the mind's decisions — at the cost of committing a
   growing event log to git. Unresolved; it depends on whether the owner wants the mind's history in
   the repository.
3. **One mind per repository, or one mind across repositories?** The charter is per-application, which
   argues for per-repo. The owner's Hetzner vision ("constantly doing work") sounds cross-repo. A
   cross-repo mind needs a scheduler-of-schedulers and a fairness policy between repositories, and I
   have not designed one.
4. **What exactly counts as "the app is stable"?** I made it the charter's `stability` block — a list
   of commands and expected exits — but who writes that list for a repository nobody has instrumented?
   The first honest answer for many repos is "there is no such list yet", and Consciousness's first
   proposal should probably be to create one.
5. **Should a quiescent mind ever propose spontaneously?** §7.4 caps proposals. But a mind that only
   ever proposes when a source fires will never propose anything genuinely new, since novelty by
   definition has no witness. The cap is a compromise between "invents busywork" and "never has an
   idea", and I do not know where the right number is. It is measurable after Phase 3's shadow week.
6. **Antigravity's scheduler.** The brief says schedulers there are "somewhat stable". I did not
   verify it, and `references/host-adapters.md` records no documented messaging, depth or concurrency
   for that host. Someone must actually test it before the adapter table claims anything.
7. **`host_reported` remains unassigned.** The evidence class exists for a host attestation the
   harness independently verified, and nothing produces one. Until something does, every model/effort
   value in the ledger is `agent_reported` — a claim, not a measurement. §10.4's adaptation would be
   learning from claims.

### 14.2 Risks, and what each would cost

| Risk                                                                          | Likelihood             | Cost if it happens                                                | Mitigation in this plan                                                                                  |
| :---------------------------------------------------------------------------- | :--------------------- | :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| The pulse produces plausible-looking busywork anyway                          | medium                 | Money, and a repository slowly worsened by well-intentioned churn | Witness rule, six gates, one lane, shadow week, auditor                                                  |
| The mind capsule hits the 100k-event ceiling unnoticed                        | **high** if not built  | Hard `INVALID_STATE`; the mind stops and nothing says why         | §0.2 rotation, in Phase 6 — but it should be earlier if pulses are frequent                              |
| The driver dies and nothing notices                                           | high                   | Silent months of nothing                                          | `last_pulse.json` + **external** check. Nothing inside a dead system reports its own death               |
| A weak model routes around a refusal by editing files directly                | medium                 | Unrecorded changes; the ledger becomes fiction                    | Every refusal carries its repair argv (`RAILS.md` #1); out-of-band drift detection is a discovery source |
| Charter halt fires on an innocent owner edit                                  | **high**               | A wasted night                                                    | Immediate push notification, one-line re-pin command in the message                                      |
| Two drivers armed at once (e.g. cron _and_ an in-session loop)                | medium                 | The measured `INTEGRITY` race, repeatedly                         | `flock -n` exits 0 rather than queueing; single-writer rule                                              |
| Overnight token burn on a repo that was already clean                         | medium                 | Money for nothing                                                 | Quiescent backoff to a 4 h ceiling; value-per-pulse throttle; budget refusals                            |
| The auditor becomes a rubber stamp, exactly as the 29/29 validator passes did | medium                 | The top-level check silently stops checking                       | Planted-defect suite; fixed questionnaire; every answer cites a command id                               |
| Gates are weak, so Consciousness certifies weak work faster                   | **high** in most repos | Confident wrongness at scale                                      | The charter must name every lane; `gate:prove`; §12.3                                                    |
| A container with push credentials pushes something at 4 a.m.                  | low but severe         | Real damage to a shared branch                                    | No push remote on the box (§11.4) — a capability removed, not a rule added                               |
| Small models mis-execute the _judgement_ steps (admission, proposals)         | **high**               | Bad candidates admitted, good ones declined                       | Every judgement step is structurally bounded — a witness or nothing; the auditor re-tests admissions     |

### 14.3 The part of the vision that is not achievable yet, and why

- **"Always running, timeless" on a laptop.** Not achievable under an in-session scheduler:
  `CronCreate` is explicitly session-only, in-memory, idle-gated and 7-day-capped. What _is_
  achievable, and is genuinely valuable, is **perfect resumption**: the mind picks up exactly where it
  stopped whenever a session opens, because the capsule is the mind. On a container with systemd, or
  through a durable cloud routine, "always running" becomes true.
- **Multi-round convergence through `orchestrator:run`.** Not achievable without a host-side round
  executor, which does not exist anywhere in the tree. Rounds are achievable pulse-by-pulse today.
- **Genuine self-improvement of its own runtime.** Deliberately out of scope. A system that may edit
  its own contracts and reinstall its own runtime has no contracts and no runtime.
- **"Best decisions on model and thinking level."** Achievable as _policy plumbing_ now; achievable as
  _learned adaptation_ only after enough observations exist, and only from `agent_reported` data until
  something assigns `host_reported`. Do not promise the second.

---

## 15. Appendix — proposed command surface

Every command below is new. Each is small, and each exists because a weak model needs a _command_
rather than a _convention_. Costs are relative implementation effort.

| Command             | Reads / writes                               | Refuses when                                                     | Cost |
| :------------------ | :------------------------------------------- | :--------------------------------------------------------------- | :--- |
| `mind:init`         | creates mind capsule, pins charter + runtime | charter missing/unreadable; capsule exists                       | S    |
| `mind:wake`         | read-only brief (`--run` for handoff depth)  | never — but reports HALT conditions                              | M    |
| `mind:pulse-open`   | opens a pulse, sets deadline                 | a live pulse is open; budget spent; quiet hours                  | S    |
| `mind:pulse-close`  | closes with outcome, arm, witness            | pulse id mismatch; no outcome; **no arm and no terminal reason** | S    |
| `mind:observe`      | records a source result + command id         | command id not in any capsule's records                          | S    |
| `mind:candidate`    | records a candidate + witness                | no witness (unless `--kind proposal`); proposal cap reached      | M    |
| `mind:admit`        | runs the six gates, adopts on pass           | any gate fails — returns which one, with the repair argv         | L    |
| `mind:decline`      | records a decline + reason                   | candidate unknown; already decided                               | S    |
| `mind:quiesce`      | records a quiescent pulse + sources          | any source returned non-empty                                    | S    |
| `mind:escalate`     | records + notifies                           | no reason given                                                  | S    |
| `mind:halt`         | halts, does not arm                          | no reason given                                                  | S    |
| `mind:round-open`   | chains a round capsule (tier 1)              | prior round has a live lease or open attempt; round budget spent | M    |
| `mind:round-close`  | closes a round + successor or reason         | round not terminal; no successor and no reason                   | M    |
| `mind:audit-start`  | mints the auditor grant                      | an audit is already open                                         | S    |
| `mind:audit-report` | records the questionnaire + verdict          | any answer lacks a command id                                    | M    |

Cross-cutting requirements for all of them, taken from what this project has already learned:

- **Every refusal carries the exact argv that would satisfy it.** `RAILS.md`: _"a refusal without a
  prescribed repair is a defect"_ — a refused weak model does not re-plan, it leaves the harness.
- **Every markdown brief obeys the 30-line limit** (`enforceLineLimit`), so a pulse's orientation
  cannot grow without bound.
- **Every recorded value carries its evidence class**, and absent renders as `unknown`.
- **No command anywhere states a target count** for anything a model produces. §12.4.
