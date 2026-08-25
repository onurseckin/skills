# OLT Defect Triage

Curated from `defects.jsonl` after a full read of all 252 rows accumulated across sessions on
2026-08-24/25. Every row was preserved: **92 open** in `defects.jsonl`, **160 closed** in
`defects-archive.jsonl`, each archived row annotated with a `curation.class` and reason.

| Archive class          | Count | Meaning                                                                                                  |
| :--------------------- | ----: | :------------------------------------------------------------------------------------------------------- |
| `NOISE_FALSE_POSITIVE` |    91 | Stagnation alarms from an auditor whose idle clock measures its own tick cadence. False by construction. |
| `SUPERSEDED`           |    28 | Earlier or coarser version of a finding kept canonically elsewhere.                                      |
| `RESOLVED`             |    19 | Investigated and answered. Retained as the reversal/closure record.                                      |
| `REFUTED`              |    16 | Claim shown false by later evidence in this same ledger.                                                 |
| `PROCESS_OBSERVATION`  |     5 | Agent-behaviour observation, not a skill defect.                                                         |
| `MALFORMED`            |     1 | Empty observation emitted by the broken stagnation auditor.                                              |

The 91 noise rows are kept deliberately: they are the evidence for defects **161** and **51**.

---

## The organising finding

Nearly every defect below is one shape: **an instrument whose output is not a function of its
subject.** Two polarities:

- **Green that cannot turn red** — a check that passes regardless of the thing it checks.
  `skill:audit:live` (144, 146), the stagnation clock (51), gates that verify nothing (137, 140),
  proofs that cannot fail (78, 81).
- **Red that cannot turn green, and misnames its cause** — a refusal whose message points at the
  wrong thing, so remediation cannot converge. Gate path form (148, 150), the candidate wedge (92).

The second is operationally worse: a false green surfaces when something breaks; a false red that
lies about why burns a capsule and a Phase 1 replay before anyone learns the real reason.

---

## P0 — Data loss and false green (fix first)

| #               | Defect                                                                                                                                                                                                                  |
| :-------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **112**         | `gate:prove` deletes the untracked files it is meant to validate. Fleet output is unstaged and at risk.                                                                                                                 |
| **142**         | Protection is inverted: `.olt/capsules` survives `git clean` because it is ignored, while charter, policy, memory, backlog, cursors and all test suites do not.                                                         |
| **143**         | The deployed skill is not a symlink to the canonical repo — it is a second clone whose 918-file running tree is untracked.                                                                                              |
| **140**         | `task-split-simulators` is `status: done`, sealed by a gate that structurally cannot see `scripts/mobile`. A sealed task resting on nothing.                                                                            |
| **137**, **35** | The declared gate is `turbo typecheck` over a write scope turbo never visits.                                                                                                                                           |
| **139**         | `tests/unit` is in no workspace and no tsconfig, so 19 contract suites whose entire purpose is asserting type contracts are never type checked by anything.                                                             |
| **81**, **82**  | `effectiveRevertScope` records nothing on its fallback path, and the persisted proof stores neither `restoredPaths`/`deletedPaths` nor stdout/stderr — so a guaranteed-true verdict is byte-identical to a genuine one. |

**Verified live:** `scripts-filesize-r2` holds `val_strip-comments-2 → falsifiable=False, exit=0`
beside three honest `falsifiable=True, exit=1` proofs. The silent bail-out is not theoretical.

## P1 — The system cannot make progress

| #                        | Defect                                                                                                                                                                                                               |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **105**                  | No code path ever clears `mind.halted`, so a transient crash streak permanently disables pulse, admit and rounds.                                                                                                    |
| **104**                  | `mind:wake` prescribes `mind:escalate` and `mind:halt`; both throw `NOT_IMPLEMENTED`.                                                                                                                                |
| **37**                   | Forensic chain: the Mind was halted for failing to perform the one act its own pulse invariant prohibits (30), while demonstrably working.                                                                           |
| **92**, **117**, **118** | Candidate backlog wedge. Every candidate is born `open`; the cap counts `open`; `mind:decline` refuses `open`. Root cause one level below: `max_open_proposals: infinite` is coerced to 5 on the throwing path.      |
| **157**, **156**         | A task can reach `status: leased` with `lease: null`, unreachable by every freeing route — `task:release` needs a vanished token, `recover` needs a non-null lease, and `task:abandon` is granted to **zero roles**. |
| **122**                  | One mis-specified `plan:add` entry permanently bricks a planning buffer. No remove, no amend.                                                                                                                        |
| **116**, **97**, **69**  | A validator dying, throwing during render, or discovering a late defect leaves its task unclosable in either direction.                                                                                              |

## P2 — Instrument credibility

| #                        | Defect                                                                                                                                                                                                                                                                                                                                                              |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **161**                  | **The meta-defect.** `mind-auditor.yaml` has two write grants to the defect ledger, zero read grants, and no read verb in its allowlist. Five generations of the role independently re-derived and re-filed the same findings. _General form: any role instructed to write to a record it has no granted means of reading will re-derive that record indefinitely._ |
| **51**, **125**          | Idle is computed as time since the auditor last ran; the Mind event log is never indexed. The never-inspected fallback defaults to threshold-exceeded rather than unknown.                                                                                                                                                                                          |
| **152**, **107**         | The cursor ratchets across two independent axes — observers and capsules. At index 234, 11 of 13 capsules were invisible and 3.6% of events scanned. `saveCursor` swallows a bad read and rewrites from `{}`. **Both axes must be fixed together.**                                                                                                                 |
| **144**, **146**         | `skill:audit:live` cannot emit an incident: its three detector literals have no producer in the running source, and the documented invocation omits `--run`, skipping the scan wholesale.                                                                                                                                                                           |
| **153**, **123**, **95** | Defect writes route to the skill home repo while reads target the project repo, so "Unresolved Defects: 0" is structurally always 0.                                                                                                                                                                                                                                |
| **131**, **130**         | 38 of 83 receipts are gate-shaped verification running where no capsule declares a matching gate. ~40–44% of bindable receipts are unbound.                                                                                                                                                                                                                         |
| **93**, **96**           | Root cause pinned to one line; briefs hand out 12-character command-id prefixes, and citing a prefix raises the same refusal.                                                                                                                                                                                                                                       |

**Remedy indicated by event ordering:** `gate-proved` and `gate-attached` are separate steps and only
attach requires binding, so an unbound receipt looks healthy throughout and fails for the first time
after the implementer's lease has closed. **One guard at `run:exec` time**, not a contract change.

## P3 — Path form, diagnostics, friction

| #                               | Defect                                                                                                                                                                                                                                 |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **148**, **149**, **150**       | Any absolute path in a gate command is structurally invalid, but the error says "must perform substantive verification". **The standing guidance mandates the thing that breaks it.** The same message fires on three disjoint causes. |
| **7**, **8**, **10**, **17**    | Bare run ids resolve against different roots per command; one creates a capsule-shaped decoy that `doctor` then reports phantom failures against.                                                                                      |
| **24**, **25**                  | Gate commands run without a shell, so multi-check gates are rejected as weak; `run:exec -- bash x.sh` is refused while `./x.sh` works.                                                                                                 |
| **18**, **98**                  | `task:check` does not load bun-types (TS2307 on every bun test file, pressuring implementers toward `@ts-ignore`); the briefing generator emits `??` that the quality gate then rejects.                                               |
| **87**, **110**, **11**, **88** | `doctor` misdiagnoses pulse expiry as tier-confinement, raises violations against subagents that never existed, and fails healthy capsules over an undeclared layout key.                                                              |
| **60**, **66**, **147**, **49** | `orchestrator:supervise` is not read-only, writes under actor `mind` regardless of caller, and its counters read foreign history.                                                                                                      |

---

## Two process findings worth keeping

**64** — a wrong claim became settled fact because a confirming agent inherited the framing and read
past the disproof already in its own terminal. This recurred during curation: a Tier 0 Mind inferred a
`gate:prove` seal deadlock from two true facts, a relay confirmed the two facts and mistook that for
testing the inference, and both reported it as verified. It had already been refuted four hours
earlier **in this ledger**. Retraction at row 160.

The two failure modes are complements, and both reduce to acting without consulting what is known:

- inheriting a framing and mistaking confirmation for testing;
- testing everything and consulting nothing — which only guarantees being rigorously redundant.

**Practices adopted:** read this ledger before filing or concluding; run the verb rather than reasoning
about whether it is permitted; a reading that makes another line of the same file unfollowable is
probably wrong; mark inherited-but-unverified claims as such.
