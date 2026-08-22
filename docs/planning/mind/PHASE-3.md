# PHASE 3 — discovery and judgement (the DISCOVER lane)

## 1. Goal

Let the mind find work nobody handed it — **and make busywork structurally hard rather than
discouraged.**

This is the phase where an infinite loop most reliably goes wrong, and the phase whose validation
matters most. Everything here is built so that the cheapest available action is an honest one.

## 2. Preconditions

Phases 0–2 complete, their exit criteria recorded, and at least a week of Phase 2 pulses in the
ledger. Discovery without a baseline of what "quiet" looks like has nothing to compare against.

## 3. Work items

---

### W3.1 — The witness rule, as a refusal

**Files:** `cli/commands/mind-candidate.ts`, `mind/witness.ts` (new).

> A candidate task must cite one recorded command whose output contains the defect. No witness, no
> candidate. The command id is `harness_observed`; everything the model says about it is
> `agent_reported` and proves nothing.

This is the single structural device that makes busywork hard. It does not ask the model to be
disciplined — it removes the input channel through which undisciplined work arrives. There is no
source that emits _"it would be nice if…"_.

`mind:candidate` refuses a `defect` without `--witness`, and refuses a witness whose recorded exit
code and output do not actually contain the cited defect. Resolving a command id means finding the
recorded command in some capsule under `.capsules/` — never trusting the flag's text.

**Acceptance:** a candidate with no witness is refused; a candidate citing a command id that exists
nowhere is refused; a candidate citing a command whose recorded exit was 0 is refused; each refusal
names the gate and carries repair argv.

---

### W3.2 — The ten sources

**Files:** `mind/sources.ts` (new), `cli/commands/mind-observe.ts`.

Each is a real command in this repository today (`PLAN.md` §7.2):

| #   | Source                               | Command                                       | Class            |
| --- | :----------------------------------- | :-------------------------------------------- | :--------------- |
| 1   | code no longer matching intent       | `health --check intent-drift --all`           | harness_observed |
| 2   | dead / unreachable / unenforced code | `health --check unused-code,dead-code,…`      | harness_observed |
| 3   | literal fallbacks                    | `health --check literal-fallbacks`            | harness_observed |
| 4   | open findings from real validators   | `finding:get --run <r> --all`                 | agent_reported*  |
| 5   | escalated tasks awaiting a human     | `run:status` / morning report `needsHuman`    | harness_observed |
| 6   | gates whose recorded exit ≠ 0        | `failingGateRuns` / `evidence:get`            | harness_observed |
| 7   | capsule integrity damage             | `doctor --run <r>`                            | harness_observed |
| 8   | install / runtime drift              | `installation-status --home … --source …`     | harness_observed |
| 9   | unsealed capsules with live leases   | `run:status` across `.capsules/`              | harness_observed |
| 10  | owner backlog in charter documents   | `health intent-drift` over charter references | harness_observed |

\* a finding is an agent's assertion, but one that reached the ledger already survived the
validator's own gate run, which is `harness_observed`. That is why it counts.

**Deliberately not a source: the model's own idea.** Novelty has exactly one door (W3.4).

Note the anti-circularity property, which answers the tautology directly: sources 1 and 10 compare
code against **owner-written documents the mind cannot edit**. `health/intent.ts` parses
backticked tokens out of headings and checks whether each named command, identifier and path exists
in production and in tests. Requirements are not derived from the plan; they are derived from a
document with a different author. That is what makes "every requirement is covered" a claim capable
of being false.

**Acceptance:** each source resolves to a real command in `COMMAND_REGISTRY`; `mind:observe` refuses
an unknown source id and a command id that resolves to nothing; a test that observing all ten with
zero counts is exactly the precondition `mind:quiesce` requires.

---

### W3.3 — The six admission gates

**Files:** `cli/commands/mind-admit.ts`, `mind/gates.ts` (new).

`mind:admit` refuses unless all six pass, **stops at the first failure**, and records which one
refused (`PLAN.md` §7.3):

| #   | Gate            | Decided by                                                          |
| --- | :-------------- | :------------------------------------------------------------------ |
| 1   | Witnessed       | harness: the command record exists and its output matches           |
| 2   | In charter      | harness: a cited goal id must exist in the pinned charter           |
| 3   | **Falsifiable** | agent declares the command; **harness runs it now, requires ≠ 0**   |
| 4   | Scoped          | harness: `scopeConflict` against live leases + charter `repo_roots` |
| 5   | Affordable      | harness: arithmetic on the budget ledger                            |
| 6   | Not a duplicate | harness: open, live **or declined** candidate with same class+scope |

**Gate 3 is the load-bearing one** and it is the direct ancestor of `gate:prove`. A candidate whose
"failing command" already exits 0 is not a defect; it is a wish. Requiring the harness to _execute_
it during admission — not merely record that the agent named it — is what stops a weak model from
naming a plausible command it never ran.

**Gate 6's "declined" clause** is what stops the loop from re-proposing last night's rejected idea
every night forever. A declined candidate is remembered permanently.

**Acceptance:** one test per gate, each asserting the specific gate id in the refusal and its repair
argv; a test that gate 3 actually spawns the falsifier and fails the admission when it exits 0; a
test that admission stops at the first failing gate rather than reporting all six.

---

### W3.4 — Novelty: proposal, not adoption

**Files:** `cli/commands/mind-candidate.ts`, the `needs_authority` requirement path.

The owner wants creative feature discovery. The honest way to give it that without letting the mind
redefine the product:

```
mind:candidate --kind proposal   (no witness — that is exactly why it may not be adopted)
        │
        ▼  recorded as a needs_authority REQUIREMENT in the mind capsule
        ├──► surfaced in the wake brief's ATTENTION line, forever, until decided
        ├──► surfaced in the owner's digest under "What I would have done without asking"
        ▼
OWNER:  authority:decide --requirement <id> --decision grant|decline --rationale "…"
   grant ─┴─ decline ─► disposed out_of_scope, remembered, never re-proposed (gate 6)
     ▼
becomes admissible; still must pass gates 2–6. It can never pass gate 1, so a granted
proposal carries `witness: owner-decision` explicitly.
```

This reuses `authority:decide` and the `needs_authority` disposition exactly as built.
**The mind is not granted `authority:decide`.** It cannot approve its own ideas. That is the
whole design.

**The cap.** At most one open proposal per N pulses (charter-configured, suggested 24 hours) and a
hard ceiling on open proposals (suggested 5). Without a cap, a loop that must always find something
produces a proposal every pulse and the owner's inbox becomes the busywork the discipline was meant
to prevent.

**Acceptance:** a proposal without a witness is accepted; a proposal past the cap is refused; a
granted proposal still faces gates 2–6; a declined proposal is refused re-proposal by gate 6;
`authority:decide` invoked with a mind grant is refused by the role contract.

---

### W3.5 — Idling well

**Files:** `cli/commands/mind-quiesce.ts`, `mind/interval.ts`.

> Idling is a first-class outcome with its own record, not a failure to find work.

`mind:quiesce` records the sources checked, the command id each returned, the count each returned,
and the resulting interval. It is a positive statement — _"I checked ten places and all ten were
clean"_ — and it is the most valuable line in the ledger, because it is the one a human uses to
decide whether the system is healthy or merely asleep.

- The interval **multiplies** on quiescence (suggested ×1.5, capped at `max_interval_ms`).
- After K consecutive quiescent pulses (suggested 8), send **one** digest — not a page — saying the
  repository has been clean for K pulses and here is what is checked. Then keep going at the cap.
- The interval **resets** the moment any source returns non-empty.

**Acceptance:** quiesce with any non-zero count is refused; quiesce missing any of the ten sources is
refused; the backoff table including the cap and the reset; a test that the K-th consecutive
quiescent pulse produces exactly one digest and the K+1-th produces none.

---

## 4. Check and balance

### 4.1 The negative suite — twenty refusals, each naming its gate

This is the phase's primary deliverable. Twenty candidate submissions that **must** be refused, each
asserting the specific gate that refused, the repair argv it carried, and an unchanged
`event_sequence`:

no witness · witness that resolves to nothing · witness whose recorded exit was 0 · witness whose
output does not contain the cited defect · charter goal that does not exist · charter goal from a
previous generation · candidate matching a non-goal · falsifier that already exits 0 · falsifier that
is not a runnable command · write scope outside `repo_roots` · write scope overlapping a live lease ·
write scope overlapping another open candidate · over the agent budget · over the wall-clock budget ·
duplicate of an open candidate · duplicate of a **declined** candidate · proposal past the cap ·
proposal with a witness flag (a proposal is defined by having none) · admission while a pulse is not
open · admission by an actor with no mind grant.

### 4.2 The busywork catalogue, as tests

Every row of `PLAN.md` §7.6 becomes a test that the candidate is refused and by which gate:

| Busywork shape                           | Blocked by         |
| :--------------------------------------- | :----------------- |
| "Improve error messages in `foo.ts`"     | Gate 1             |
| "Add tests for coverage"                 | Gate 3             |
| "Refactor for readability"               | Gates 1 and 3      |
| "Add a feature users would like"         | Gate 2 → proposal  |
| Re-proposing last night's declined idea  | Gate 6             |
| Fixing the same drift finding twice      | Gate 6             |
| A dozen shallow tasks to look productive | One lane per pulse |
| Rewriting the goal to match what it did  | The charter pin    |

### 4.3 No quotas — enforced, not asked for

**No prompt, packet, role contract or brief produced by this phase may state a target count** for
candidates, findings, probes, proposals or tasks. Only ceilings, and floors that are structural
rather than numeric. Zero candidates is a correct and common answer and the design must make it
comfortable to give.

Failure mode 10 in one line: a run asked for ">=5 validator pushbacks" produced exactly 5.

Add a test that greps every prompt, brief and contract this phase emits for numeric targets.

## 5. The shadow week — discovery on, adoption off

Run discovery for seven days with `mind:admit` disabled. The mind records what it _would_ have
admitted, and nothing acts on it.

Then the owner reads a week of that and says how much of it was worth doing. **That number is the
honest measure of whether the discipline works**, and it costs almost nothing to obtain.

Pass bar: the owner judges that a majority of what would have been admitted was worth doing, and can
say why for each item. If most of it is busywork, the gates are wrong and no amount of Phase 4 will
fix that.

The shadow week is also where `PLAN.md` §14.1.5 gets answered — whether a quiescent mind should ever
propose spontaneously — because it is the first time there is data about what the cap costs.

## 6. Exit criteria

```sh
bun run typecheck && bun run test && bun run test:coverage    # 0
bun run test:unit tests/unit/mind/admission-negative.test.ts  # 0, all twenty
```

Plus: the shadow week ran seven days; the owner's judgement is recorded in §7 below; every source
returned at least once across the week, or the ones that never fired are explained.

## 7. Failure modes, rollback, and recorded results

| Likely mistake                                         | The tell                                      |
| :----------------------------------------------------- | :-------------------------------------------- |
| Gate 3 records the falsifier instead of running it     | Admission passes for commands nobody executed |
| Trusting `--witness` text rather than resolving the id | Fabricated command ids are admitted           |
| Forgetting the declined set in gate 6                  | The same idea returns every night forever     |
| A source implemented as "the model looks around"       | Discovery becomes invention with extra steps  |
| Any target count in any prompt                         | The count is met exactly, every time          |
| Enabling admission during the shadow week              | The measurement it exists for is destroyed    |

Rollback: discovery is additive and gated behind the DISCOVER lane, which the selector reaches only
when the first three lanes are provably empty. Disabling `mind:admit` returns the system to a Phase 2
mind with no loss.

- **Shadow-week judgement, one paragraph:** _(to be recorded)_
