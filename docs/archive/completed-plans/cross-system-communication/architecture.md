# Cross-System Communication — Architecture

**Version:** 1.0.0
**Target Repository:** `@onurseckin/skills`
**Status:** Proposed for implementation planning
**Depends on:** `forensics.md` (evidence), informs `protocol.md` (wire contract)

---

## 1. Executive summary

Two independent OLT-using systems currently coordinate by writing mailbox messages to each other's
_working orchestrator_. That orchestrator is simultaneously planning waves, dispatching coordinators and
sealing runs. The channel therefore competes with execution for the same identity's attention, carries no
liveness signal, cannot distinguish "read" from "acted upon", and provides no shared view of the state both
sides are arguing about.

This proposes three additions, in dependency order:

1. **A liaison agent per system** — a dedicated tier-0 identity that owns cross-system traffic and nothing
   else. It never plans, implements or validates.
2. **A liaison daemon** — a long-lived local service that maintains liveness, projects shared state, and
   pushes change notifications instead of being polled.
3. **A monitoring surface** — a live read-only view of both systems, served by the daemon, so a human or an
   agent can see roster, concurrency, obligations and drift without parsing event logs.

None of this replaces the mailbox. The mailbox remains the durable, signed transport. These are the layers
the mailbox was never meant to provide.

---

## 2. Component 1 — The liaison agent

### 2.1 Why a separate identity

In the observed programme every inbound message landed on `orchestrator_phase-fundamentals`, which was also
the busiest working agent. When it stalled for 81 minutes, cross-system communication stopped completely
(`forensics.md` §2.4, §2.6). There was no second identity authorised to answer "are you alive" or "did that
directive reach a lane".

A liaison is cheap precisely because it does no work: it holds no leases, edits no files, runs no gates.

### 2.2 Responsibilities

- **Own the mailbox** for its system. Drain continuously, never in a polling cron.
- **Translate obligations into local lifecycle facts.** When a `DIRECTIVE` names paths, the liaison's job is
  to answer, verifiably, whether those paths now sit in some lane's write scope — not to promise a relay.
- **Emit heartbeats** on a declared interval.
- **Answer state queries** from the peer without waking the orchestrator.
- **Escalate** to its own orchestrator only when a message requires planning or execution.

### 2.3 What it must never do

Plan, claim, implement, validate, or seal. A liaison that starts doing work reintroduces the bottleneck it
exists to remove. This mirrors the existing rule that supervisory tiers do not execute.

### 2.4 Naming

`liaison_<system>` — e.g. `liaison_claude`, `liaison_antigravity`. Peers address liaisons, never working
orchestrators. Directives still _originate_ from planners and verdicts from verifiers; the liaison is the
transport endpoint, not the author, and the message retains its author identity.

---

## 3. Component 2 — The liaison daemon

A long-lived local process per system, started with the run and torn down with it.

### 3.1 Liveness

Emits a heartbeat carrying: timestamp, declared next-beat interval, active run ids, and a one-line status.
A peer that misses `N` consecutive beats knows within seconds rather than inferring absence from frozen
event counts over 40 minutes.

**Liveness must be positively asserted.** The current design infers presence from side effects, which is
why an 81-minute outage went unnoticed.

### 3.2 State projection

Maintains a small, cheap, continuously-updated projection of the facts both sides argue about:

- run and task states, lease holders, and **distinct implementer identities per run**
- capsule event count and last event timestamp
- HEAD, dirty count, ahead/behind
- named ratchet and gate metrics, computed **once, by one method**

`forensics.md` §2.8 records a near-false-rejection caused by two sides measuring adoption differently. A
single computed projection removes that class of dispute entirely: disagreement becomes a bug in one
definition rather than an argument.

### 3.3 Change notification

Pushes on transition — task state change, run completion, verdict recorded, heartbeat lapse — so the peer
reacts in seconds instead of at the next cron tick. Roughly 200 polling cycles in the observed programme
each re-derived state by shelling out to `git` and `python3`.

Polling remains as fallback. The daemon is an optimisation and a convenience, never the source of truth —
**the capsule and the git tree remain authoritative**, and any consumer must be able to fall back to them.

### 3.4 Failure posture

If the daemon dies, communication degrades to today's behaviour rather than stopping. Its absence is itself
a detectable condition via the missing heartbeat.

---

## 4. Component 3 — The monitoring surface

A read-only live view served by the daemon, showing for each system:

- **Liveness** — last heartbeat, age, declared interval
- **Roster** — active agents by identity and type; **distinct implementers per run** displayed as a
  first-class number, since serial execution masquerading as a parallel plan went undetected for six waves
  (`forensics.md` §2.9)
- **Obligations** — open directives, their correlation ids, and their binding state (see `protocol.md`)
- **Run state** — lanes by status, lease holders, unclaimed ready lanes
- **Shared metrics** — the projected numbers, with the definition each was computed from
- **Drift** — gate/ratchet direction and any regression absorbed

This is the artefact that answers "is the other side working well?" without reading a transcript. It exists
because that question was repeatedly answered by hand-parsing `events.jsonl` actor fields.

---

## 5. What this does not change

- The mailbox stays: signed, durable, correlation-threaded, closed vocabulary.
- The capsule stays the auditable source of truth for runs and evidence.
- Verification still means reading the diff. **No projection, dashboard or receipt substitutes for a
  verifier reading the tree** — the daemon reports what happened, never whether it was correct.
- Agent read/write permissions are unchanged. Agents write to mailboxes to communicate; that stays.

---

## 6. Build order

1. **Protocol first** (`protocol.md`) — receipts and heartbeat semantics are the load-bearing change and are
   useful even with no daemon.
2. **Liaison agent definitions** — deployable immediately once the protocol exists.
3. **Daemon with heartbeat and projection** — the largest win per unit of work.
4. **Monitoring surface** — valuable, but only once there is something reliable to display.

Stopping after step 1 or 2 still leaves both systems better off than today. That property is deliberate.
