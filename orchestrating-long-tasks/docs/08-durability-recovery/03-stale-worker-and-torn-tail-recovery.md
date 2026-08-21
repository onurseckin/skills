# 03. Stale Worker, Crash Forensics & Torn Tail Quarantine

[⬅ Previous: POSIX File Locking & Durable Writes](./02-posix-flock-and-fdatasync.md) | [Master Table of Contents](../README.md) | [Next: Chapter 09 — Execution-Time Branching ➡](../09-branching-and-honesty/01-execution-time-branching.md)

---

## 💥 The Anatomy of Crash Recovery

What happens when an agent subagent crashes mid-execution, a laptop battery dies, or an unhandled exception interrupts a long task?

The harness provides an automated, fail-safe recovery architecture integrated into the CLI state engine:

- All state transitions are idempotent and event-sourced.
- Query commands (`plan:status`, `queue:next`, `run:status`, `doctor`) read the chain and surface torn
  tails and expired leases without mutating anything.
- Reclaiming is an **explicit** command — `recover` (or `doctor:repair` for a torn log tail) — so a
  reclamation is an event with an actor, not a silent side effect of someone running a status query.
- `orchestrator:supervise` wraps the same reclaim logic into a pass a coordinator can run unattended,
  and adds a judgment call `recover` never makes on its own: when a failure has repeated or dragged on
  long enough that it stops being worth retrying automatically, and needs a human instead.

---

## ✂️ Forensic Recovery Protocol: Torn Tail Quarantine

If a process was terminated while in the middle of appending bytes to `events.jsonl`, the trailing
line may contain partial, unparseable JSON characters. This is a fundamentally different failure from
a stale lease: nobody died holding a task, the **log file on disk itself** is physically incomplete.

`doctor` and `recover` both refuse to fix this for you — reading and mutating are kept as separate,
deliberate acts here too. `doctor` only **reports** a torn tail (or a mismatch between `state.json`
and what the event chain actually implies); the repair is a distinct command you run on purpose:

```bash
bun harness.ts doctor --run .capsules/<run-id>            # read-only: reports the torn tail
bun harness.ts doctor:repair --run .capsules/<run-id> --actor coordinator   # mutates: quarantines it
```

`doctor:repair` re-derives `state.json` from the event chain's **last complete event** and records the
recovery itself as a new `projection-recovered` event — the repair is not invisible; it is itself part
of the audit trail. It refuses outright if the manifest or `prompt.md` itself is corrupt: that is an
integrity failure with no safe automatic fix, not something to repair silently.

```text
[ events.jsonl with corrupted trailing bytes ]
  ├── Line 1..82: Valid, canonical, cryptographic event objects
  └── Line 83: `{"sequence": 83, "kind": "command-in...` (TRUNCATED BY CRASH)
                                │
                                ▼ (`doctor:repair`)
┌────────────────────────────────────────────────────────┐
│  QUARANTINE ACTION:                                    │
│  1. Identify the exact byte offset of the last          │
│     complete, hash-verified event                      │
│  2. Copy every byte after that offset into a new file   │
│     under the capsule's own `quarantine/` directory:    │
│     `.capsules/<run-id>/quarantine/recovery-torn-<token>.fragment`
│     (written temp-then-`renameSync`, then chmod'd 0400  │
│     read-only — nothing ever edits a quarantined         │
│     fragment again)                                     │
│  3. `ftruncateSync(fd, lastValidByteOffset)` on the      │
│     real `events.jsonl`, then `fsyncSync(fd)`            │
│  4. `state.json` is rebuilt from the chain's now-clean   │
│     tail and re-projected                                │
└────────────────────────────────────────────────────────┘
```

`quarantine/` is its own top-level entry in the capsule's declared layout — not a corner of
`evidence/`. `evidence/` is a **view**: a directory of readable names pointing at content that lives in
`blobs/`, and it holds no primary facts of its own. A torn tail is the opposite: it is itself the one
and only surviving record of exactly what bytes were lost, so it earns a directory of its own rather
than being filed alongside content that was never in question.

---

## 🧟 Stale Worker & Zombie Lease Reclamation

When an agent crashes or loses network connectivity, its task lease eventually expires:

$$\text{now}() > \text{lease.expires\_at} + \text{grace}$$

```bash
bun harness.ts recover --run .capsules/<run-id> --actor coordinator --grace-seconds 30
```

`recover` does five things, all of them recorded as a `stale-recovery` event:

1. Returns tasks whose lease expired to `retry_ready` — or to `changes_requested` when the reaped
   attempt was a repair, so a dead repairer does not lose the findings it was opened to close.
2. Reopens validations that were interrupted mid-review.
3. Reclaims branch sub-tasks whose sub-agent died, recording who held them and when they expired, so a
   reclaimed sub-task still shows its history.
4. Expires a stale completeness critic.
5. Leaves a **branched parent alone.** Its lease clock is suspended, not running out: it is blocked on
   children, not gone. Reaping it would orphan the very sub-agents it is waiting for.

A fresh agent then claims the task with `task:claim --role`. If the reclaimed zombie submits anyway
after that, its token still matches a historical attempt `recover` marked expired — so the late write
is not simply refused, and it does not clobber the fresh agent's live lease either. `task:submit`
redirects it into **orphan evidence** instead (`reason: "stale_recovered_lease"`), preserved rather
than discarded. See "🧟 Orphan Evidence" below.

> **What `recover` does _not_ reclaim.** The five things above are the complete list. In particular,
> `recover` has no notion of a stale **plan-validation** assignment (C2's plan-validator role, covered
> in [Chapter 07 §02](../07-gates-and-completion/02-completeness-critic-verification.md)) — only a
> stale _task_ validation is reopened. If a plan-validator's agent dies before it calls `plan:review`
> for the graph revision it was assigned, that assignment stays `assigned` forever; `recover` will
> never expire it the way it expires a stale completeness critic. The only way to get a fresh
> assignment for that graph revision is to produce a new one — see the pushback discussion in Chapter
> 07 §02 for what that actually requires today.

---

## 🤝 The Voluntary Path

An agent that knows it cannot finish should not make the run wait out a 30-minute clock:

```bash
bun harness.ts task:release --run .capsules/<run-id> --task <task-id> \
  --agent <worker-id> --token <bearer-token>
```

Same destination, immediately, and with the agent's own token proving it was really the holder. A
`branched` task refuses release until its branch is collected or abandoned.

---

## 🧟 Orphan Evidence

A dead agent can leave behind command records that belong to no live owner. These are collected as
**orphan evidence** rather than discarded, and completion blocks until each is explicitly disposed.
Deleting them would destroy the record of what the dead agent actually did; ignoring them would let a
run finish with unexplained activity in its own log.

---

## 🤖 Unattended Recovery: `orchestrator:supervise`

`recover` is a tool a coordinator has to remember to reach for. `orchestrator:supervise` is the same
reclaim logic wrapped into something you can leave running unattended overnight — a "reclaim, classify,
dispatch" pass that also decides, on its own, when a task has failed enough times that retrying it is
no longer a reasonable thing to keep doing automatically.

```bash
bun harness.ts orchestrator:supervise --run .capsules/<run-id> --actor coordinator
```

Run bare from the CLI like this, it performs **exactly one pass** and returns. That is deliberate, not
a limitation to work around: looping the pass — sleeping between ticks, waking early when a
backed-off task's retry time arrives, stopping once the run reaches a terminal state — needs something
that can actually dispatch a task to a real agent (a `TaskDispatcher`), and the harness itself never
calls a model or spawns an agent (the same rule that keeps `orchestrate` from executing anything on its
own). A `TaskDispatcher` is a capability only a **host embedding this harness programmatically** can
inject; the plain CLI has none to offer. So the CLI form is exactly what makes `orchestrator:supervise`
safe to drive from an external poll loop — cron, a shell `while` — instead of holding a process open:
each invocation is a complete, self-contained unit of work.

### What one pass actually does

```text
┌─────────────────────────────────────────────────────────────────────┐
│  1. RECLAIM   — the exact same recoverStale() logic `recover` calls, │
│                 plus a durable per-agent event for every lease and   │
│                 branch sub-lease that came back                      │
│                        │                                             │
│                        ▼                                             │
│  2. ESCALATE  — walk every unleased task's trailing run of dead      │
│                 attempts; classify transient vs. deterministic;      │
│                 deterministic → escalateTask(..., "retry_budget_     │
│                 exhausted", ...) — the task now needs a human         │
│                        │                                             │
│                        ▼                                             │
│  3. DISPATCH  — free slots = max-parallel − occupied; ask the        │
│                 scheduler what's actually ready right now, distinct  │
│                 from what's still backing off                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Reclaim** is recorded twice over, on purpose. `recoverStale` already mutates the state the way
`recover` does; on top of that, `orchestrator:supervise` records one `supervisor-dead-agent-reclaimed`
event per task lease or branch sub-lease it just reclaimed. A single before/after diff would only tell
_this process_ what it just found — but a supervising process can itself die and be restarted, and the
cumulative "how many dead agents has this run reclaimed, all told" figure a morning report wants to
show has to survive that. Recording it as its own durable event on the run's existing hash chain means
a fresh supervisor process, or a human reading the chain later, sees the whole history rather than only
whatever the currently-running process happened to observe.

**Escalate** is where the interesting judgment call lives: telling a failure worth retrying apart from
one that will never resolve on its own, without either burning a whole night retrying something that
can never pass or giving up on something that would have succeeded on the next attempt. The
classification looks only at what a dispatch attempt actually reported — never at the task's name or
shape:

| Signal                                              | Class                                   | Why                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rate_limit`, `network`, `provider_5xx`, `timeout`  | transient, **unbounded in count**       | These describe the far end having a bad moment. Repeating the identical message doesn't make the world more broken each time, so a repeat _count_ alone never demotes them — only running past `--max-elapsed-ms` (default 4 hours) without a success does. |
| `crash`                                             | transient, **bounded in repeats**       | The task's own agent dying is evidence about the task, not the world. The same `crash` detail repeated `--deterministic-repeat-threshold` times in a row (default 3) reads as deterministic.                                                                |
| `auth`, `gate_failure`, `unknown`, or anything else | deterministic from the first occurrence | Nothing about these signals gives any reason to expect a retry would behave differently.                                                                                                                                                                    |

A task the classifier calls deterministic is escalated — `escalateTask(port, taskId, actor,
"retry_budget_exhausted", <evidence>, clock)` — and moves to status `escalated`. **No CLI command
reverses that transition.** It is a deliberate, permanent handoff to a human, the same way the
completeness critic's `unproven` requirement status is something only the harness can set and nothing
auto-clears; a run is considered terminal once every task is `done`, `cancelled` or `escalated`. A
transient classification instead computes a **full-jitter backoff delay** — `floor(random() *
min(maxDelayMs, initialDelayMs · 2^(repeatCount − 1)))`, default `initialDelayMs=1000`,
`maxDelayMs=300000` — and, when a host dispatcher is actually driving dispatch, records a
`supervisor-dispatch-outcome` event carrying the classification and the computed retry-at time so the
next tick knows not to retry early.

### The morning report

Every call — single pass or a whole overnight loop — ends by rendering the same **morning report**:
what completed, what escalated and why (with the evidence, not just the verdict), how many dead agents
were reclaimed across the run's whole history, a per-task breakdown of transient retries versus
deterministic stops, how long the run spent backing off in total, and current occupancy measured
against **both** the general concurrency ceiling and the separate, lower gate-running ceiling
(`--gate-max-parallel`, since a gate-heavy agent running `tsc`/a full test suite is bound by local CPU,
not by a provider). Nothing in the report is inferred from a task's name or shape — an escalation with
no recorded reason renders literally as `unknown`, never a guessed explanation.

```text
### Morning Report: `.capsules/big-migration`
- **Generated**: 2026-08-20T06:00:00.000Z
- **Completed**: 11
  - `task-schema` Database schema migration
  ...
- **Escalated (needs a human)**: 1
  - `task-legacy-import`: retry_budget_exhausted — 3 consecutive lease(s) expired with no submission (the same "crash" failure ("lease expired with no submission") repeated 3 times in a row)
- **Dead agents reclaimed**: 4
- **Retries**:
  - `task-flaky-network-call`: 6 transient retries, 0 deterministic stops
- **Run span**: 27340211ms
- **Time spent backing off**: 184332ms
- **Occupancy at report time**: 2/6 general ceiling, gate ceiling 5
```

### Not to be confused with `orchestrator:run`

They share an `orchestrator:` prefix but do unrelated jobs. `orchestrator:supervise` operates the
reclaim/escalate/dispatch loop over a run that is **already compiled and has tasks in flight**.
`orchestrator:run` is a different thing entirely: it drives the whole autonomous plan → execute →
validate → critic sequence across rounds, and — same boundary as everywhere else in the harness — it
refuses outright with `INVALID_STATE` unless a host has injected a round executor, because the harness
itself never calls a model. Nothing about `orchestrator:supervise`'s reclaim/backoff/escalation
machinery requires that executor; it works on tasks a human or a coordinator dispatched by whatever
means they chose. Between rounds, `orchestrator:run` chains one capsule's carryover (unresolved
findings, still-open requirements) into the next round's fresh capsule — and if the source capsule's
own `state.json` turns out corrupt, that chaining step re-throws the integrity failure rather than
swallowing it: silently treating an unreadable capsule as "nothing carried over" would report a false
clean slate the harness never actually observed, exactly the kind of fabrication this whole chapter
refuses to do anywhere else.

---

[⬅ Previous: POSIX File Locking & Durable Writes](./02-posix-flock-and-fdatasync.md) | [Master Table of Contents](../README.md) | [Next: Chapter 09 — Execution-Time Branching ➡](../09-branching-and-honesty/01-execution-time-branching.md)
