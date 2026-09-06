# Cross-System Communication — Protocol

**Version:** 1.0.0
**Target Repository:** `@onurseckin/skills`
**Status:** Proposed
**Depends on:** `forensics.md` (evidence), `architecture.md` (components)

This is the load-bearing document. The receipt model below is useful even if no daemon and no monitoring
surface are ever built.

---

## 1. The central defect: acknowledgement is not execution

Today a directive names paths and the peer replies that it has relayed them. Both statements can be true
while nothing happens, because no lane's write scope ever contained those paths. This occurred in Wave 36
and again in Wave 37 (`forensics.md` §2.1), each time costing a full cycle and each time discovered only
because a verifier independently grepped the compiled plan.

The protocol must make the difference between _heard_ and _actionable_ impossible to conflate.

---

## 2. Two-phase receipts

Every message that carries an obligation gets two receipts, not one.

### Phase 1 — `RECEIPT_DELIVERED`

Automatic, emitted by the receiving liaison on drain. Carries the message id, correlation id and read
timestamp. Replaces the current practice of `stat`-ing `cursor.json` and comparing `last_read_id`
(`forensics.md` §2.2).

This is a transport fact and asserts nothing about intent.

### Phase 2 — `RECEIPT_BOUND` or `RECEIPT_REFUSED`

Emitted when the obligation is resolved into local reality — and **it must carry proof**.

`RECEIPT_BOUND` states, for each path or requirement the directive named:

- the run id and task id whose write scope now contains it, **or**
- the artefact that satisfies it (a report path, a commit hash)

`RECEIPT_REFUSED` states which requirement was not taken and why — out of scope, disagreed with, blocked.
**A refusal is a legitimate, first-class response.** Silence and false agreement are not.

### 2.1 The binding assertion

`RECEIPT_BOUND` must be _checkable_: the emitter asserts a fact about the compiled plan that the peer can
verify. A liaison claiming a path is bound when the plan does not contain it is a protocol violation, not a
misunderstanding — and unlike today, it is mechanically detectable.

### 2.2 Unbound obligations are visible

An obligation with a `RECEIPT_DELIVERED` and no phase-2 receipt after a declared window is **open and
overdue**, and appears that way on the monitoring surface. Today such an obligation is indistinguishable
from a completed one until a verifier goes looking.

---

## 3. Heartbeat

`HEARTBEAT` from each liaison on a declared interval, carrying timestamp, next-beat interval, active run
ids, and one-line status.

- Missing `N` beats marks the peer **unreachable** — a state, not an inference.
- Unreachable is _reported to the human_, since a stalled peer usually needs an out-of-band restart. The
  observed 81-minute outage required exactly that and the human could not have known without being told.
- A liaison entering a known freeze — quota exhaustion, graceful shutdown — should say so in its final
  beat. "I am stopping and why" is far more useful than silence, and quota freeze is a legitimate state
  rather than a fault.

---

## 4. Explicit expectation

Messages carrying an obligation declare what the sender is waiting for:

- `expects: receipt` — acknowledgement of binding suffices
- `expects: verdict` — sender is blocked until a verification result arrives
- `expects: nothing` — informational; do not reply

This removes the deadlock in `forensics.md` §2.3, where a brief and a request for that brief crossed and
both sides waited. With explicit expectation, "standing by" is a queryable state rather than a guess.

---

## 5. Execution telemetry on the channel

Completion reports must carry, as structured fields rather than prose:

- **distinct agent identities by type** — how many implementers actually ran, which validators reviewed
- **lane count versus distinct implementer count** — the number that exposed six waves of serial execution
  presented as parallel plans (`forensics.md` §2.9)
- **evidence artefacts produced**, by class — a DOM-metrics dump and a written optical critique are
  different classes and must not satisfy the same demand
- **browser sessions opened and closed** — orphaned headful Chrome accumulated for 18–21 hours on the
  operator's machine

These exist because each was, at some point, only discoverable by hand-parsing `events.jsonl`.

---

## 6. Shared metrics contract

Named metrics are computed **once**, by the daemon, with the definition recorded alongside the value. Both
sides read rather than recompute.

Nearly caused a false rejection: adoption measured by the exact specifier `from "@limo/design-system"`
missed every subpath import such as `@limo/design-system/primitives/input`, appearing to show 230 imports
deleted rather than repointed (`forensics.md` §2.8). One definition, one computation, one number.

Where a side disputes a metric, it disputes the _definition_ — a concrete, resolvable disagreement.

---

## 7. Preserved from today

- HMAC signing and durability
- Correlation ids
- The closed message vocabulary, extended with `RECEIPT_*` and `HEARTBEAT`
- The capsule as auditable truth

---

## 8. Acceptance

The protocol is working when:

1. No obligation can be acknowledged without either a checkable binding or an explicit refusal.
2. A peer outage is reported in **under two heartbeat intervals**, not 81 minutes.
3. Neither side needs to `stat` a private cursor file to learn whether a message was read.
4. Lane count versus distinct implementer count is visible without parsing event logs.
5. A disputed number is resolved by comparing definitions, not by both sides re-measuring.
