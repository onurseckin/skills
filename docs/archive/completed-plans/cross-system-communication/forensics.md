# Cross-System Communication — Forensics

**Version:** 1.0.0
**Target Repository:** `@onurseckin/skills` (`/Users/onurseckinsenoglu/repos/skills`)
**Status:** Evidence gathered — informs `architecture.md` and `protocol.md`
**Source:** One continuous 47-wave programme on `/Users/onurseckinsenoglu/repos/limo`, run by two independent
OLT-using systems: a Claude Code planning/verification session (`claude-planner`) and an Antigravity
orchestration fleet (`orchestrator_phase-fundamentals`) communicating solely through the OLT mailbox.

---

## 1. Why this document exists

The mailbox worked. Messages were signed, delivered, and durable. What failed repeatedly was everything
_around_ the message: knowing whether it had been read, whether reading it caused anything to happen,
whether the other side was alive, and what the shared truth actually was.

Every failure below was observed, measured, and has a run id. None is hypothetical.

---

## 2. Observed failure modes

### 2.1 Acknowledgement is not execution — the silent relay

The planner addressed the orchestrator; the orchestrator replied that it had "relayed the directive to
the coordinator"; the work never landed. The acknowledgement was truthful and the outcome was still
nothing, because no lane's write scope contained the named paths.

- **Wave 36.** A waypoint scope addition was authorised, acknowledged and relayed. `lane-contract-core-airport`
  closed `done` with its write scope unamended — the paths were never in it. The only occurrence of the
  word "waypoint" in that lane was its gate command.
- **Wave 37.** A dwell-ticker rename was acknowledged as "relayed to coordinator for immediate execution".
  At that moment the only open lane's scope was `booking/guest`, `admin/dispatch-grid` and `passenger-flow` —
  none containing `driver/progression`. The directive had nowhere to execute and the lane closed.

**An ACK proves a message was read. Nothing in the protocol proves it became work.**

### 2.2 Read-state is forensics, not protocol

To distinguish "ignored" from "not yet read", the planner repeatedly ran `stat` on
`.olt/mailboxes/<agent>/cursor.json` and compared `last_read_id` against its own sent message ids. That is
reverse-engineering a private file to recover a fact the protocol should state.

### 2.3 Messages cross, and both sides then wait

The orchestrator sent "standing by for the Wave 46 brief; please provide your instructions" at the same
moment the planner sent that brief. Each believed it was blocked on the other. Recovered only because the
planner inspected the cursor and saw its own directive was `last_read_id`.

### 2.4 Liveness is discovered by polling, late

The orchestrator went dark between 14:36 and 14:44 UTC. Detection took **four watchdog pulses (~40 minutes)**
of comparing frozen event counts, an unchanging dirty-file count, and a stale cursor mtime. Total outage
before human notification: **81 minutes**, during which three lanes sat in `validating` with no lease holder
and a fourth was never claimed.

**There was no heartbeat. Absence was inferred from the absence of side effects.**

### 2.5 Verification is pull-based polling against the tree

The planning side ran a 10-minute cron that each time re-derived state by shelling out: `git log`,
`git status`, `wc -l` on `events.jsonl`, `python3` over `state.json`, greps over baselines. Roughly 200
pulses. Both sides independently reconstructed the same truth from primary sources, and disagreed often
enough that "measure it yourself" became the operating rule.

### 2.6 The orchestrator is a bottleneck and a single point of failure

Every inbound message — directives, corrections, verdicts, questions — landed on the one identity that was
also planning waves, dispatching coordinators, and sealing runs. When it stalled, cross-system
communication stopped entirely. There was no path to reach the coordinator or a lane directly, and no other
identity authorised to answer.

### 2.7 Identity resolution races under concurrency

`msg:recv --actor claude-planner` was rejected with `AUTHENTICATION_FAILURE`, reporting the caller as
`coordinator_wave-41`, while that coordinator was running harness commands concurrently. The same command
succeeded on immediate retry. Already registered as a defect; it matters here because a verdict that fails
once and succeeds on retry will be silently dropped by any caller that does not retry.

### 2.8 No shared measurable state

Both sides argued about numbers — `localUiImportsTier1`, mixed-vocabulary files, distinct implementer
counts, capture dimensions. Each recomputed independently, with different methods, and the discrepancies
were real: an adoption count measured by exact import specifier missed every subpath import and appeared
to show 230 imports deleted rather than repointed. Nearly became a false rejection of correct work.

### 2.9 The channel carries no execution telemetry

The owner reported the application felt unimproved and waves felt slow. Diagnosis required the planner to
parse `events.jsonl` actor fields by hand, discovering that **one implementer identity had served four
disjoint lanes** in each of waves 44 and 45 (120 and 233 events respectively), and that **no UI agent had
been deployed in waves 41, 43, 44 or 45**. Six waves of serial execution and absent visual validation were
invisible to the communication channel while every message reported success.

---

## 3. What the evidence implies

| Observation                     | Requirement it generates                                                                 |
| :------------------------------ | :--------------------------------------------------------------------------------------- |
| ACK ≠ execution (2.1)           | Receipts must be **two-phase**: delivered, then _bound to a write scope_                 |
| Read-state via `stat` (2.2)     | Read and unread state must be **queryable protocol state**                               |
| Crossed messages (2.3)          | Requests must carry **correlation and expectation**, so "waiting on you" is explicit     |
| 81-minute blind outage (2.4)    | **Heartbeat with declared interval**, and liveness as a first-class query                |
| 200 polling cycles (2.5)        | **Push/subscribe** for state change; polling as fallback only                            |
| Orchestrator bottleneck (2.6)   | A **dedicated liaison identity per system**, not the working orchestrator                |
| Identity race (2.7)             | Deterministic caller binding; retryable errors distinguished from authorisation failures |
| Divergent measurement (2.8)     | A **shared metrics surface** both sides read rather than recompute                       |
| Invisible execution shape (2.9) | **Roster and concurrency telemetry** on the channel, not buried in event logs            |

---

## 4. What worked and must be preserved

- **HMAC-signed durable messages.** No message was ever lost or forged.
- **Correlation ids.** Threading a conversation across dozens of messages worked well.
- **A closed vocabulary of message types.** `DIRECTIVE`, `SCOPE_CORRECTION`, `VERIFICATION_PASS`,
  `VERIFICATION_REJECT`, `WAVE_COMPLETED` carried unambiguous obligations.
- **The capsule as the auditable record.** Where it was intact, disputes were settled by reading it.

Any replacement must keep these. The problem is not the mailbox — it is that the mailbox is the _only_
mechanism, and it is being asked to carry liveness, state, telemetry and obligation tracking that it was
never designed to express.
