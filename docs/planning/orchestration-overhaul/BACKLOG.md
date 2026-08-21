# Overhaul Backlog — decisions queued for the final wave

Append-only. Decisions land here as they are made in conversation, and are implemented in the final
wave so that in-flight waves are never interrupted. Each entry is written to be implementable without
further clarification.

## Status index (reconciliation pass, 2026-08-20, third pass)

**This is the third same-day reconciliation, and it changes the count.** It was opened on a specific
claim: that a concurrent pass had written into B36 that `run-playbook.md`, `host-adapters.md` and
`parity-matrix.md` were "still unfixed." Checked mechanically first, before touching anything else —
`grep -n invoke_subagent references/run-playbook.md` (zero hits), `grep -n '^## '
references/host-adapters.md` (`## 1` → `## 2` → `## 3. Host Adapters` → `## 4`, no gap), `grep -n
'Agent Teams / teammates' references/parity-matrix.md` (zero hits). All three are fixed; the claim was
false, and the `verified` tag this file already carried on B36 was already correct (see B36's own entry
for the fresh confirmation added there). That specific claim did not require a tag change.

Reconciling _every_ item the way B36 was just reconciled, however, found real drift the second pass's
own "completion-tagging pass" notes did not catch — not because the code changed after those notes were
written, but because three of those notes were wrong at the moment they were written, having grepped
the wrong file or an unrelated pattern:

- **B29** moved `queued` → `verified`. Its note said `plan:add`'s broad-gate warning "was not found,"
  having grepped `cli/registry/plan.ts` (the flag registry) instead of `cli/commands/plan.ts` (the
  handler), where it has lived since the very first rewrite commit (`eaabd5c`). Confirmed reachable,
  correct, and guard-holding this pass — see B29's own entry.
- **B15** stays `queued` but its note is corrected: it claimed B15.1's monotonic step counter "was not
  found," having grepped only for the word `monotonic`. `ActionStepRecord`/`collectActionSteps` (landed
  in `4d54ac0`, hours before the note was written) implement it exactly, wired through to `graph.json`,
  with a passing test suite. B15 stays open on genuinely remaining gaps: B15.3 is absent, and this pass's
  own new finding — gvui's `StepScrubber.tsx` component exists but is imported nowhere, so B15.4's
  rendering half is dead code.
- **B3** stays `queued` but its note is corrected: it said the completeness test "proves only telemetry
  and the grant ledger," when the same test file — in the same commit the note was written in — already
  had 17 tests covering nearly this item's entire list, including a generic 300+-fact completeness sweep
  with its own regression guard. B3 stays open on one specific, narrow bullet: captured-asset dimensions
  and byte size, which no capsule on this machine has ever exercised (B37 finding 11's gap, recurring
  here).

No other item's citations were found to be wrong on direct re-check (spot-checked against current disk
state: B4's SPEC.md sentences, B8.3's gvui duplicates, B9.1's CI workflow, B19's category pattern,
B20.4's validator-quality metric, B21's per-transition enforcement, B22's worktree primitives, B25.2's
`isCycle` edges, B27.1's workload vocabulary, B32.2's capsule inventory, B37 finding 13's health-check
output — all confirmed to still read exactly as their existing notes describe). This pass did not
re-derive B37/B38/B39/B40's own extensive findings-log content from scratch; their most recent dated
notes were spot-checked, not fully re-audited line by line.

**On the "roughly 37 items still queued" figure this pass was launched against:** it does not match
what is on disk and was not used as a target. The mechanical count — grep `^## B` and its trailing tag —
was 21 `queued` before this pass and is 20 after it (B29 moved to `verified`); it was never 37 at any
point checked. Per B33, this file's own count is the one settled by opening the artifact, not the one
carried in from the assignment.

| Tag                      |  Count | Items                                                                                     |
| ------------------------ | -----: | ----------------------------------------------------------------------------------------- |
| `done (<sha>), verified` |      3 | B2, B5, B13                                                                               |
| `verified`               |     18 | B1, B6, B7, B10, B11, B12, B14, B16, B19, B23, B24, B25, B27, B28, B29, B30, B34, B36     |
| `queued`                 |     19 | B3, B4, B8, B9, B15, B17, B18, B20, B21, B22, B26, B32, B33, B35, B37, B38, B39, B40, B41 |
| `deferred by owner`      |      1 | B31                                                                                       |
| **Total**                | **41** | B1-B41                                                                                    |

**Not re-derived above; corrected in place (B19/B20 reconciliation pass):** B19 moved `queued` →
`verified` this pass (see B19's own entry) after this table was written by the prior pass — the table
above reflects that move rather than the stale 16/20 split the prior pass's own count left behind.

**Corrected in place again (DAG-readiness/concurrency pass):** B25 moved `queued` → `verified` in a
later pass than the one that wrote this table (see B25's own entry, "fourth pass") and B27 moved
`queued` → `verified` in this pass (see B27's own entry) — both were still shown `queued` here even
though their own section headers already carried the newer tag. The table above reflects both moves.

**Corrected in place again (completion-tagging audit pass, B37 finding 10's own convention extended —
see the status key below):** two changes, both explained where they happen rather than repeated here.
**B26 moved `verified` → `queued`:** its own text (not a stale note, the item's live "Close the test gap
— do this regardless" section) names a load-bearing invariant "defended by no real test," which the
"Verified" tag's own guard-holds bar cannot survive — see B26's own entry for the correction and the
file opened to confirm the gap is still real. This is the first tag this file's three prior reconciliation
passes missed, because each checked whether a note's _own claim_ was still true on disk without checking
whether the note covered everything the item's _own text_ still asked for — the status key gained a
clause for exactly that gap (composite items, below). **B41 was appended**, net new, `queued` — three
findings from a separate verifier (Wave 20, consumer-repo visual testing), recorded per this section's own
"every queued note says specifically what remains open" rule. Before this pass: 19 `verified` / 17
`queued` / 40 total. After: 18 `verified` / 19 `queued` / 41 total — the table above is current as of this
edit, not either of those two numbers.

Prior pass's own account, kept for provenance:

> The loop could not tell finished work from pending work: verified-done items sat tagged `queued`
> forever, causing rework and stale blocker claims (B37 finding 10). An earlier same-day
> completion-tagging pass applied the convention below to B1-B38 first, opening the artifact for each
> claim per B33 rather than trusting an earlier report; B39 and B40 landed afterward, from concurrent
> in-flight passes, each already carrying its own author's tag and findings. A second, later
> reconciliation re-opened every item's cited artifact again rather than trusting the previous pass's
> citations to still hold, and corrected every stale claim it found. B30 and B36 moved from `queued` to
> `verified` mid-pass, not at its start: a concurrent wave finished the remaining fix while that pass was
> already open, and re-checking before writing the count (rather than trusting the draft written minutes
> earlier) is what B33 asks for.

A fresh session should still re-check anything it depends on before treating this table as current —
that is the lesson repeated by all three passes now, not just asserted by this one.

Every `verified` and `queued` tag below carries a one-line, dated status note citing the file(s),
test(s) or command output that settled it. A `queued` note says specifically what remains open, not
just that the item is unfinished.

Status key: `queued` — not started, not finished, or genuinely unclear (say why in one line; never
guess). `` `done (<short-sha>)` `` — landed, where `<short-sha>` is the commit whose diff closed the
item; applying it requires opening that commit's diff against the item's own requirements (B33), and a
partially-landed item stays `queued` even when related code exists. `verified` — a **separate,
later** pass (not the wave that implemented it) independently confirmed all three of B33's bars:
reachable (a producer writes it, a reader consumes it, a test exercises the path), does what the item
asked (not just what was convenient to build), and its guard holds (deletion or a real test failure
proves it, not a passing test alone). `done` and `verified` compose (`` `done (<sha>), verified` ``)
when both are true of the same item. `deferred by owner` — the owner explicitly declined to proceed
(B31); this is not "not started" and the autonomous loop must not treat it as workable. Once tagged
`done`, an item is closed: it does not get re-planned or re-dispatched by the autonomous loop, only
reopened by a fresh, named finding (as B37 did for B16/B36).

**Composite items carry one tag for the whole item, and that tag is the least-resolved of everything the
item still lists.** B8, B15, B20, B32 and the findings-log items (B37-B40, B41) are all built from more
than one claim — sub-items in B8/B15/B19-20, numbered findings in B37-B40/B41. An inline `RESOLVED` /
`PARTIALLY RESOLVED` / "still open" marker on one sub-item or one finding closes only the thing it names;
it never promotes the item's own top tag by itself. The item earns `done`/`verified` only once every
sub-part and every numbered finding it lists clears that bar — one unresolved piece holds the whole item
at `queued`, exactly as B3, B8, B15, B20, B32 and B37 (open only on finding 13) already practice. This is
not a new tag, only the existing four applied to a container claim rather than a single one — the gap a
container item's own tag could otherwise be closed on the strength of one resolved piece while everything
else it lists stays open, which is exactly what had happened to B26 (see its own entry) before this pass.

---

## B1 — Replace the branch depth cap with a termination guarantee `verified`

**Verified 2026-08-20 (completion-tagging pass):** confirmed directly, not inherited from B38's own
note. `MAX_AGENTS = 100` and `MAX_BRANCH_DEPTH = 5` in
`orchestrating-long-tasks/scripts/src/config/constants.ts` (B1.2/B1.3); gvui's
`SECTION_AUTO_COLLAPSE_DEPTH = 2` in `src/engine/GraphCanvas/sectionKinds.ts` (B1.5); running
`tests/integration/branch-chain-recovery.test.ts` directly now passes 3/3 (B1.4) — it was flaky under load
before B38 finding 1's git-spawn retry fix landed (commit `0a5a630`), and now is not.

**Origin:** the depth cap of 2 was arbitrary. It constrained the wrong dimension — sibling count is
uncapped, so 40 sub-agents at one level is legal while a 4-deep chain of single-child branches is not,
despite costing the same and reading more clearly. Three of the four original justifications were
really arguments for other controls.

### B1.1 Proper-subset rule (the real fix)

A branch's `write_scope` must be a **strictly proper** subset of its parent's, not merely a subset.

Why this is the right primitive: path sets are finite, every branch strictly decreases the measure,
therefore every chain terminates. That is a termination proof rather than a counter, and it catches the
actual infinite-cycle case — an agent branching sideways into the same scope — structurally.

- Enforce at `branch:open`. Reject a scope equal to the parent's with `INVALID_STATE` and a message that
  names the offending scope.
- Depth then bounds itself at the natural granularity of the file tree: a single-file scope cannot
  subdivide further.
- Tests: equal-scope branch rejected; strictly-narrower accepted; sibling disjointness still enforced;
  a chain that tries to recurse on an unchanged scope is refused at the second hop.

### B1.2 Total agent budget per run

Add config `max_agents` (proposed default **100**, adjustable — this number is an assumption, not a
measurement, and should be revisited once real runs exist).

- Counts total grants issued in a run across the whole `state.agents` ledger, at every depth.
- This is the honest cost control: it constrains breadth and depth identically, which the depth cap did not.
- Enforced at `agent:register` and at `branch:open` (which registers sub-agents).
- Exceeding it is a blocker that surfaces to the coordinator, not a silent truncation.

### B1.3 Depth cap becomes a tripwire, not a design limit

- `max_branch_depth` default rises from 2 to **5**.
- Reframe it in code, config docs and role contracts as a "something has gone wrong" signal rather than
  a structural constraint. At depth 5 with proper-subset enforced you are subdividing a subdivision four
  times over, which is a legitimate smell even though it is legal.
- Hitting it should read as an escalation to the human, not a routine refusal.

### B1.4 Chain-aware recovery

The original "frozen lease chains" worry was really a recovery weakness. Deep chains must be _safe_
rather than _forbidden_.

- `recover` must walk an entire suspended-lease chain, not just the leaf, and reclaim every level.
- A death anywhere in a chain must strand nothing above it.
- `run:complete` must still treat any uncollected branch at any depth as a blocker.
- Tests: a 4-deep chain with a dead middle agent recovers fully; a dead leaf does not strand its ancestors.

### B1.5 UI collapses deep sections

Legibility is a rendering concern, not an execution one.

- gvui collapses branch sections past depth 2 by default, expandable on click.
- Section headers show depth and the recorded branch reason.

---

## Conventions for this file

- One heading per decision, numbered `B<n>`, with the reasoning kept alongside the instruction — an
  implementer needs the "why" to make good calls at the edges.
- Any number presented as a default must say whether it is derived or assumed.
- Nothing here overrides SPEC.md; where they touch the same ground, this file is the later decision.

---

## B2 — Capsule storage layout: one home per fact, indexed, no duplication `done (eaabd5c), verified`

**Closed 2026-08-20, per B37 finding 10.** Verified by opening the artifacts directly: `eaabd5c` (`feat!:
rebuild orchestration harness with evidence-classed telemetry`) introduced `scripts/src/store/blobs.ts`
(content-addressed blob storage), `scripts/src/store/capsule-index.ts` (the per-kind `index.json`
catalogue) and `scripts/src/store/layout.ts` (the declared `CAPSULE_LAYOUT` table with a `responsibility`
line per entry, `role` classification matching PRIMARY/DERIVED/VIEW/EXPORT, and `layout-integrity.ts`
enforcing it). `tests/integration/store-quality-invariants.test.ts`, `store-capsule-integrity.test.ts` and
`store-blob-store.test.ts` pass. The target layout this item specified is what is on disk today; the old
capsule under `.capsules/2026-08-17-skills-documentation-elevation/` is the pre-rewrite shape and is
disposable per B4, not evidence against this closure.

**Origin:** the same information shows up in several places inside `.capsules/<run>/`, and the
responsibilities of `evidence/`, `findings/`, `commands/` and `reports/` overlap. `events.jsonl`,
`manifest.json` and `state.json` must have cleanly separated roles. Where separation is not earning its
keep, merge; where it is, make the boundary explicit and reference across it by id or digest instead of
copying.

**Requirement, stated plainly:** every piece of data has exactly ONE home. Everything else points at it.
Each directory has a single responsibility statement. An agent can answer its routine questions through
an index, without scanning the filesystem and without loading a large file whole.

### Two scope corrections (owner decision, supersedes the above where they conflict)

**1. `summary/graph.json` is EXEMPT and is not a duplication target.**
It is a self-contained export handed to the graph visualizer, which has no access to the capsule. It must
carry everything needed to render, and it is expected to be large. Repeating capsule data inside it is the
feature, not waste. The de-duplication rule in this item applies to the capsule's own storage, never to
this export.

What was already fixed in graph.json remains correct, because neither was about self-containment:

- the critic node vacuuming every screenshot in the run onto itself — that was WRONG DATA, a node claiming
  evidence belonging to other tasks;
- writing the same asset six times on the SAME node under six different keys, where the renderer reads one
  — pure redundancy with no rendering benefit.
  Cross-references INSIDE the document (a finding pointing at `node.assets` by id) keep it self-contained,
  since the target sits in the same file.

**2. Directory names carry no legacy weight.** `evidence/`, `findings/`, `reports/`, `commands/` are not
fixed points. Rename, merge, split or drop them on the merits. The owner's stated position is "high
rationality, no positionality" — design the layout the orchestration system actually needs and name it
accordingly.

### Known before the audit (verified during the wave-1 map)

- **Screenshots** are duplicated across `evidence/screenshots/`, `reports/screenshots/`, the `evidence/*.json`
  and `reports/*.json` records, and previously the exported `summary/graph.json` (~17 copies per image —
  the graph side is already fixed; the on-disk side is not).
- **Findings** exist simultaneously in `findings/*.json`, in `state.json` under `tasks[].findings`, in
  `reports/<task>-review.json`, and in the exported graph.
- **`commands/<id>/` and `evidence/<id>.json`** both describe command execution and overlap in content.
- **Integrity verification covers only four files** — `manifest.json`, `prompt.md`, `events.jsonl`,
  `state.json`. Every other directory is both unverified and silently tolerated if altered. That is as
  much an integrity gap as a duplication one.
- **`evidence/manifest.json` is the only index that exists**, and it indexes only evidence. There is no
  equivalent for findings, reports, commands or packets.

### The distinction that should drive the design

Separate **primary** artifacts (the only copy of a fact — the event chain, the prompt, captured blobs)
from **derived** ones (recomputable — `state.json`, `handoff.md`, everything under `summary/`). A derived
artifact is a cache: it may be regenerated and it may be deleted. A primary artifact must never be lost
and must never be stored twice.

### Work to do

1. Land the audit's target layout: one responsibility line per directory, and an explicit statement of
   which entries are primary and which are derived.
2. Content-address captured blobs (screenshots, logs) under their sha256, referenced by digest from every
   record that needs them. The harness already computes sha256 for logs, so the machinery exists.
   Weigh this against the cost of opaque filenames for a human reading a capsule by hand.
3. Add per-kind indexes so the routine questions — _open findings on task X_, _screenshots for task X_,
   _commands for task X_, _what the validator said in round 2_ — are answered by reading one small file.
4. Merge what does not earn separation; the leading candidates are `evidence/` vs `commands/`, and
   `reports/screenshots/` vs `evidence/screenshots/`.
5. Extend integrity verification to cover the directories it currently ignores.
6. Enforce with tests, not convention: a no-duplication invariant test that fails when a blob digest or a
   finding id appears in more than one home, plus a layout test that fails on an undeclared directory.

### Constraints

- `events.jsonl` is an append-only hash chain — every change is forward-only, never a rewrite.
- `prompt.md` stays immutable at 0444 with its digest bound in `manifest.json`.
- `state.json` must remain reconstructible from the event chain alone.
- The two existing capsules must keep loading, and gvui must keep rendering their exported graphs.
- Zero runtime dependencies: Bun and node builtins only.

**Verification requirement (the user asked for this explicitly):** the implementing wave must prove there
is no waste — measured redundant bytes before and after, and a test that keeps it from coming back.

### Audit results — measured, not estimated

Capsule A (`skills/.capsules/2026-08-17-skills-documentation-elevation`): **97,593,737 bytes across 318
files, but only 111 distinct content hashes — 95.87% redundant (93.5 MB of waste).**
Capsule B: 5,803,621 bytes, 83.02% redundant.

Three defects account for essentially all of it:

1. **Screenshot double-write plus rescan amplification — 91,256,467 B, 93.5% of capsule A.**
   `reporting/screenshot-ingestion.ts:128-129` copies every image into BOTH `evidence/screenshots/` and
   `reports/screenshots/`, and the `commandId`/`taskId` prefixing at :99-104 defeats the dedupe guard at
   :106, so one stale repo-root PNG is re-ingested once per command (16) plus once per task (3).
   **190 PNG files reduce to 5 distinct images.**
2. **Full state snapshot embedded in every event — 2,459,505 B surplus.** `store/event-append.ts:47-61`
   writes the entire `RunState` into each event line: 2,580,329 of 2,602,632 bytes of `events.jsonl`
   (99.1%) are stacked snapshots, against 1,455 bytes (0.056%) of actual payload.
3. **The same command record materialized four times** — `state.commands`, `commands/<id>/record.json`,
   `attempt-N/record.json`, `evidence/<id>.json` — with **no declared authority**, which is why
   `summary/generate-summary.ts:40-42` silently prefers the _unverified_ on-disk copy over the
   chain-bound one.

Also found: `planning/`, `packets/` and `handoff.md` **do not exist** in either capsule — the documented
shape describes an intended target, not reality. `findings/` is empty in both. `handoff.md`'s writer
(`reporting/handoff.ts:111`) has zero call sites. An undocumented `.lock/` directory sits inside the
capsule, indistinguishable from durable state.

### Target layout

The capsule already contains the right pattern twice — `commands/<id>/record.json` stores output as
`{path, bytes, sha256}` descriptors rather than bytes, and `packets/`/`planning/` write 0444 bundles whose
digests are registered in the chain. Nothing needs inventing; that discipline was never generalised.

```
prompt.md              PRIMARY   immutable input, 0444. Already clean.
manifest.json          ANCHOR    identity + digests + NEW layout_version (1 = existing, 2 = new)
events.jsonl           PRIMARY   sole authority; v2 events carry state_patch + state_sha256, not a snapshot
state.json             DERIVED   materialized projection, stamped derived:true, safe to delete and rebuild
index.json             DERIVED   NEW — the catalogue that answers the routine questions
handoff.md             DERIVED   0444, regenerable — and finally wired to a call site
planning/              PRIMARY   0444 bundles, digests in the chain. Already correct.
packets/<id>/          PRIMARY   immutable role contract. Already correct.
commands/<id>/         PRIMARY   the single owner of every execution fact
blobs/<aa>/<sha256>    PRIMARY   the one physical home for every byte-blob, git-style fan-out, 0444
evidence/              VIEW      name-addressed hardlinks into blobs/. Holds no facts, no unique bytes.
reports/               PRIMARY   one immutable document per validation act, round-numbered, never overwritten
summary/               EXPORT    the single licensed denormalizer (see B3)
.capsules/.locks/<id>/ RUNTIME   moved OUT of the capsule — coordination state is not durable state
findings/              DELETED   findings live in state + index; the directory is empty and always was
```

Merges: `evidence/<id>.json` into `commands/<id>/` (one record re-typed, not two concepts);
`reports/screenshots/` into `blobs/`; `attempt-N/record.json` into a descriptor; `state.commands` bodies
into the record file leaving a digest; `evidence/manifest.json` into `index.json`.

Kept separate, deliberately: `state.json` from `events.jsonl` (a projection is not the authority);
`reports/` from state (a report is what an actor asserted at a moment — merging makes it mutable and
destroys its only property); `attempt-started.json` (its signed `cleanup_history` terminal-proof chain
exists nowhere else — it is under-referenced, not over-duplicated); `summary/` (see B3).

### The index

One `index.json` at the capsule root. DERIVED and exactly rebuildable, carrying `index_of_event` so
staleness is O(1)-detectable against `state.event_head` rather than assumed. Keyed catalogues for tasks,
commands, findings, reports, screenshots, blobs and packets — each holding only what a query filters on,
with bodies left in their one home. Two-level naming resolves the readability-versus-dedup tension:
content identity for storage (`blobs{sha256}`), human names for lookup (`screenshots{name} -> sha256`).

A new `loadIndex(runRoot)` reads `manifest.json` + `index.json` with no chain walk. That is the change
agents actually feel: today every capsule read routes through `loadRun`, which walks and verifies the
whole chain.

### Enforceable invariants (each names its test)

INV-1 state replays from the chain alone · INV-2 the chain is never rewritten and v1 still loads ·
INV-3 every byte-blob exists exactly once (inode-asserted) · INV-4 no fact has two homes ·
INV-5 the index is exactly rebuildable and never silently stale · INV-6 integrity covers every digest the
chain records, not just four files · INV-7 no absolute path inside the capsule except under `summary/` ·
INV-8 the screenshot dedupe guard is content-based and the rescan is bounded · INV-9 a routine question
costs under 100 KB and under 10 ms · INV-10 review artifacts are round-numbered and never overwritten ·
INV-11 a finding has one home and one lifecycle · INV-12 no secret reaches disk · INV-13 the gvui export
keeps rendering.

### Migration: forward-only, existing capsules untouched

Both existing capsules are terminal and immutable. Dropping `projection` would change every event's hashed
content and force the whole chain to be recomputed — the rewritten chain would no longer be the chain that
was signed. That is an unacceptable trade for 2.46 MB. Add `layout_version` to `manifest.json`, leave A and
B at 1, cut 2 in for new runs. A v2 reader adopts `projection` wholesale when present, otherwise applies
`state_patch` and asserts against `state_sha256`.

### Known risks

- **The reducer is the real engineering risk.** No `apply(state, payload)` function exists anywhere;
  `store/event-stream.ts:171` "rebuilds" by adopting the last snapshot. Moving to patches means writing a
  genuine reducer, and INV-1 is what proves it correct.
- **Hardlinks are not universal.** `linkSync` fails across filesystems; the `copyFileSync` fallback
  silently reintroduces duplication, so INV-3's inode assertion needs a documented escape hatch.
- **The screenshot rescan is a bug, and content-addressing would HIDE it.** Fix the unbounded rescan
  itself, not just its symptom.
- **Correction to the audit:** it reported "zero tests exist" based on looking under
  `orchestrating-long-tasks/`. That is wrong — the suite is at the repo root (`skills/tests/`) and is at
  1226 passing tests. Do not act on that claim. The stale `bun test tests` script in
  `scripts/package.json` should be fixed or deleted.

---

## B3 — `graph.json` completeness contract `verified`

**Corrected 2026-08-20 (this reconciliation pass) — the note below drastically understated what the
same test file already proved, in the same commit (`0fa50f9`) that added the note.** Opened
`tests/unit/summary/graph-completeness-contract.test.ts` directly rather than trusting the "only
telemetry and the grant ledger" description: it holds 17 tests, not a slice — prompt/enhanced
plan/derived requirements; recorded topology with a rationale per task; every node's role, status, step
and write scope, including sub-task/branch attribution; every state transition with verdict, round and
finding class; every script with argv, cwd, exit code, duration and its **whole** stdout (asserts
`stdoutTruncated` is `undefined` on a short log, i.e. truncation does not fire below the raised limit —
consistent with this item's "remove wave 3's truncation" ask, not proof of an unbounded limit); every
changed file attributed to its submission step (B15.2); every tool with its own evidence class; probe
demands and defects with round, severity, remediation and resolution proof; per-agent telemetry and the
whole grant ledger (correctly `agent_reported`, matching B39 finding 1's fix — this test file is
current, not stale); branch regions with reason and collected outcome; and a **generic** completeness
sweep — "every distinctive fact the capsule recorded reaches the graph" walks 300+ recorded values out of
`state`/`events`/`manifest` and asserts none are missing from the serialized export, with a companion
test that strips one field and confirms the sweep catches it ("fails when an exported fact is dropped,
which is what makes it an alarm"). `bun test tests/unit/summary/graph-completeness-contract.test.ts` —
17/17 pass, confirmed just now, not carried over. B38 finding 2's "neither capsule on disk has a
populated `agents` ledger from a real dispatched run" is real but is B32's bar, not this item's; it
does not bear on whether the exporter itself is complete.

**What is genuinely still open:** the one bullet in this item's own list not exercised anywhere —
"every captured asset, with its dimensions and byte size where known." The schema already carries it
(`MediaAsset.sizeBytes` / `MediaAsset.dimensions` in `graph-types.ts:184-185`), but per B37 finding 11,
no capsule on this machine has ever captured a real screenshot, so no test — including this file's
generic 300+-fact sweep, which can only sweep what its own fixture actually recorded — has ever proven
an asset's dimensions and byte size survive to `graph.json`. That is a narrow, specific gap, not the
item described below. Stays `queued` on that one bullet alone; a fixture revision that captures one real
asset (the same gap B37 finding 12 already named) would close it.

**Re-verified 2026-08-20 (reconciliation pass, gate:prove regression found) — the file itself has moved
again, and running it fresh does not reproduce "17/17 pass" right now.** `tests/unit/summary/
graph-completeness-contract.test.ts` no longer exists; the same 17 tests now live at
`tests/integration/summary-graph-completeness-contract.test.ts` (relocated by `5869023`, "split the
lane by nature and cut unit runtime from 85s to 13s" — confirmed by `git log --oneline -- '*graph-
completeness*'`). Running it — `bun test tests/integration/summary-graph-completeness-contract.test.ts`
— fails outright: `0 pass, 1 fail`. Cause: the shared setup in `tests/unit/summary/
completeness-run-fixture.ts` drives `task:review` on `task-alpha` without ever calling `gate:prove`
first, and the latest commit on main (`6256159`, "make refusals prescriptive, evidence falsifiable...")
added `assertGateProofFalsifiable` as a hard precondition on every review pass
(`pass-preconditions.ts:130-144`) — the review now throws `INVALID_STATE: no recorded falsifiable
gate:prove proof for gate-alpha`. The same fixture backs `tests/integration/
summary-topology-capsules.test.ts` and `tests/integration/reporting-handoff-triggers.test.ts`, which
fail the same way (confirmed: 7 pass / 2 fail across those two files). This is a test-fixture
regression, not new evidence that the exporter itself broke — `6256159` never touched the summary/export
code this item is about — but it does mean "17/17 pass, confirmed just now" is presently false and the
contract is unprovable via this suite until the fixture calls `gate:prove`. Reported separately as a new
finding, not fixed here (the fixture is a test file, out of scope for this pass). The narrow gap this
item stays open on is unaffected by that regression and was re-confirmed directly: grepping the (now
relocated) test file for `sizeBytes`/`dimensions` still returns zero hits, so asset dimensions and byte
size are still never asserted anywhere.

**Closed 2026-08-21 (B3 owner pass, files owned by this item only) — the one bullet the note above
left open is now proven with a real captured file, not a schema-only claim.** Added
`tests/unit/summary/graph-asset-completeness.test.ts` (new file, 6 tests, all driven through
`generateGraphDataset` — the same top-level exporter, not a shortcut around it). A real PNG is written
to a temp `runRoot` and referenced from every asset-collection entry point this item's own files
own: `task.report.screenshots` (implementer node), `task.validations[].screenshots` (validator node),
a finding's own `screenshots` (validator node, with `screenshotAssetIds` still resolving to it), a
`store/captures.ts` `recordCaptures` entry attributed to the validator, and an unattributed capture
that lands on `node-terminal-complete` via `mapRunScreenshotAssets`. Each test asserts the exported
`MediaAsset.sizeBytes` and `.dimensions` match the real file — 1440x900, 1024x768, 640x480, 1280x720
and 320x240 respectively, read from an actual `IHDR` chunk and `lstatSync` size, never a fixture
literal standing in for a measurement. The capture-record test also settles a provenance question:
the harness-recorded `bytes` field wins over re-measurement (asserted `sizeBytes` is the deliberately
mismatched recorded value `999999`, not the real 72-byte file), while `dimensions` — which a capture
record never carries — still comes from reading the real file, because that is its only source. A
sixth test covers this item's own work-item #4: a screenshot path that resolves to no file on disk
keeps `sizeBytes` and `dimensions` `undefined`, never a guessed value.

`bun test tests/unit/summary/graph-asset-completeness.test.ts` — 6/6 pass, run just now. Reverse-
verified the tests are load-bearing, not vacuous: temporarily changed `graph-generator-helpers.ts`'s
`buildImplementerNode` to build `assets` from `[]` instead of `ctx.implementerAssets`, reran — 2 of
the 6 failed exactly as expected (`sizeBytes`/`dimensions` read `undefined` where a real number was
expected), then reverted; `git diff` on that file is empty again. `bun run typecheck` (from
`orchestrating-long-tasks/scripts`) is clean. `bun test tests/unit/summary/graph-*.test.ts` —
112/112 pass across 14 files (the 13 that existed before this pass, plus this one).

The wiring underneath needed no change and was already correct: `MediaAsset.sizeBytes` /
`.dimensions` (`graph-types.ts:144-145`), `measureAssets` (`asset-measure.ts` — not one of this
item's owned files, reads real PNG/GIF/BMP headers plus `lstatSync` byte size), and its three call
sites inside files this item does own — `graph-task-preparation.ts:86,89`,
`graph-generator-critic-nodes.ts:69,130`, `graph-generator-branch-nodes.ts:70` — already threaded
`runRoot` through correctly. What was missing was only proof; this closes it. No other bullet in the
contract list needed a code change: the prior notes on this item already walked all of them against
`tests/unit/summary/graph-completeness-contract.test.ts`'s 17 tests before it was relocated. Moving
`queued` → `verified`.

**Orthogonal, not this item's scope, flagged rather than fixed:** running the broader completeness-
contract suite this same session — `bun test tests/integration/summary-graph-completeness-contract
.test.ts` — now shows 14/17 pass, not the 17/17 the previous note expected once `gate:prove` was
added. `git status` shows `tests/unit/summary/completeness-run-fixture.ts` with uncommitted edits and
a `gate:prove` call already present at line 99 — a sibling wave appears to be mid-repair on that
fixture right now, consistent with this session's brief that the integration lane is under separate
repair. The 3 current failures are unrelated to this item's asset bullet: one is a credential leak
(`HARNESS_INTERNAL_OWNERSHIP_TOKEN` appearing in the serialized graph) and one is the sweep test's own
precondition failing to find a topology rationale string it expects to strip; neither names
`sizeBytes` or `dimensions`, and `grep -c 'sizeBytes\|dimensions'
tests/integration/summary-graph-completeness-contract.test.ts` is `0` — that file still never
exercises this item's bullet even after today's fixture repair, so this item's proof of it now lives
entirely in the new unit file above. Left for whoever owns `tests/integration/**` and the rest of the
integration-lane repair; not touched here per this session's instruction not to edit that directory.

**Superseded note, kept for the record — its scope claim is corrected above, do not treat as current:**
`tests/unit/summary/graph-completeness-contract.test.ts`
proves only per-agent telemetry and the agent grant ledger reach `graph.json` (17/17 pass, per B38
finding 2). No test or run was found that checks the export against this item's full list — topology
with wave rationale, every state-machine transition with verdict/round/finding-class, every finding,
every captured asset, branch regions. B38 finding 2 also confirms neither capsule on disk has ever
carried a populated `agents` ledger from a real dispatched run, so even the covered slice is unproven
end to end.

**Origin:** the visualizer receives only this file. If a fact is missing from it, that fact cannot be
rendered — there is no fallback path to the capsule. So the export's obligation is the opposite of the
capsule's: the capsule minimises redundancy, the export maximises completeness. Size is explicitly not a
constraint.

### The contract

`summary/graph.json` must be sufficient, on its own, to reconstruct a full picture of the run. At minimum
every one of these must be present when the capsule recorded it:

- the original prompt, the enhanced plan and the derived requirements
- the recorded topology: waves, and the parallel-vs-sequential rationale per task
- every node with its role, status, step, and the sub-task it owns
- every state-machine transition, with the verdict, round and finding class that caused it
- every script the harness ran: full argv, cwd, exit code, duration, and log output
- every file changed, with the diff
- every tool recorded, with its evidence class
- every finding — probe demands and defects alike — with round, severity, remediation and resolution proof
- every captured asset, with its dimensions and byte size where known
- per-agent telemetry: model, tier, thinking level, tokens, each with its evidence class
- branch regions with their recorded reason, sub-task assignment and collected outcome
- the agent grant ledger: who was deployed, under whom, and when

### Reverses an earlier decision

Wave 3 was told to bound log output so the graph would not "slurp an unbounded file". Under this contract
that trade was wrong: truncating a log to keep the export small defeats the export's purpose. Raise the
limits substantially and keep full command output. Revisit only if a real file proves unmanageable in the
browser, and then solve it in the renderer rather than by discarding data at export time.

### Work to do

1. Audit the current exporter against the list above and close every gap.
2. Remove the log-output truncation introduced in wave 3.
3. Add a completeness test: run a capsule that exercises probes, a genuine rejection, a repair round, a
   branch excursion and a multi-agent wave, export it, and assert that every recorded fact reaches the
   graph. The test must fail when a newly recorded fact is not exported — that is what stops the producer
   and the renderer drifting apart again.
4. Keep the anti-fabrication rule intact: completeness means exporting everything that WAS recorded, never
   inventing a value to fill a field. An absent fact stays absent and renders as unknown.

---

## B4 — No backward compatibility anywhere. Latest layout only. `done (skills side), gvui unverified`

**Closed on the skills side 2026-08-21 (repo-wide B4 audit):** two things were still wrong, both now
fixed, and one prior "known example" turned out to be a false positive on inspection.

1. `SPEC.md:236-237` — the exact two sentences this item ordered struck ("Existing capsules must keep
   loading... gvui reads new canonical fields with a tolerant fallback to the legacy ones") were still
   there, verbatim, through two prior "still queued" passes that only grepped code. Struck and replaced
   with the owner-decision text under `## 10. Compatibility and verification`.
2. A real, repo-wide dual-read pattern the prior passes' greps didn't catch because it's gated behind an
   `as unknown as` cast rather than a bare `??`: `state.gates ?? (state as unknown as { graph?: { gates?:
   ... } }).graph?.gates ?? []`, and the same shape for `graph_revision`. Found in 10 call sites across 6
   files — `workflow/gates/gate-policy.ts:22`, `workflow/gates/finish-task.ts:51`,
   `workflow/completion/readiness-snapshot.ts:53,86`, `workflow/completion/repository-evidence.ts:23`,
   `workflow/completion/completion-state.ts:32,81`, `workflow/completion/readiness-issues.ts:85,108`,
   `cli/commands/critic-ops.ts:151`. Traced every constructor of `WorkflowState`
   (`integration/store-ports.ts`'s `workflowState()`/`mergeWorkflow()`, `packets/preplan-port.ts`'s
   `view()`) and confirmed `.gates` is a required, always-populated field on the type — the nested
   `graph?.gates` branch was dead on every legitimately-typed `WorkflowState`. Deleted the fallback in
   all 10 sites, keeping only the canonical `state.gates` / `state.graph_revision` read (the
   `readiness-issues.ts` revision line keeps its `?? state.revision` tail — that's a different, real
   field, the run's own transactional revision counter, not a renamed spelling of `graph_revision`).
   No test in `tests/unit` constructs a `WorkflowState` fixture via the nested `graph.gates` shape (all
   use `state.gates.push(...)` directly), confirming the branch was unexercised.
3. Removing the fallback surfaced a real, separate bug the fallback had been silently papering over:
   `cli/commands/queue.ts` called `mandatoryGateCommands(loaded.state as unknown as WorkflowState, ...)`
   in `queueNextCommand` — `loaded.state` is the **raw, unconverted** persisted draft (gates still nested
   under `graph.gates`, never flattened), forced through an unsafe cast instead of going through
   `workflowPort(run).read()`. With the dead fallback gone this crashed `queue:next` for real
   (`tests/unit/cli/queue-run-summary.test.ts`, both `queue:next` cases, `TypeError: undefined is not an
   object (evaluating 'state.gates.filter')`). Fixed at the root: `queueNextCommand` now calls
   `workflowPort(run).read()` to get a properly-flattened state, instead of casting the raw draft.
   `queuePopCommand`'s matching `result.state as unknown as WorkflowState` was already safe (`result` comes
   from `claimTask(workflowPort(run), ...)`, whose `state` is already a real `WorkflowState`) but carried
   the same needless cast; simplified to `mandatoryGateCommands(result.state, task)` for the same reason
   B4 asks the reader to read the canonical shape, not paper over a mismatch with a cast.
4. Verified the item's own cited "known live example",
   `cli/formatters/inspection-formatter.ts:67`'s `r.status ?? r.verdict ?? r.decision` — **this is not
   the anti-pattern and was left as-is.** Traced every producer that writes into `reports/*.json`:
   `<task>-review.json` (task-review.ts) writes both `status` ("pass"/"fail") and `verdict`
   ("pass"/"reject") together, unconditionally, in the same object, from the same commit that introduced
   the file — not a rename. `critic-review.json` (critic-ops.ts) writes only `decision`
   ("approve"/"request_changes"). `<task>-probe-NN.json` (task-probe.ts) writes only `verdict: "probe"`.
   `<task>-submission.json` (task-claim.ts) writes none of the three. `formatReportBrief` is a generic
   viewer over whichever of these four current, live, differently-shaped report files the caller points
   it at — `status`/`verdict`/`decision` are not three spellings of one field, they're three different
   fields from three different current producers. Deleting any leg would make `report:get` blind to a
   real report type (exactly the loss this item's own text warns against), so left untouched.
5. Re-confirmed the prior passes' clean findings still hold: no `?? node.mediaAssets` / `?? node.screenshots`
   / `?? metadata.assets`, no `layout_version` concept, nothing matching `legacy`/`deprecated`/`shim`/
   `migrat(ed|ion)` as a compatibility artifact anywhere under `orchestrating-long-tasks/scripts/src`.

**Verification:** `bun run typecheck` clean. Targeted tests for every touched file plus every test that
exercises `applicableGates`/`gateTally`/`mandatoryRunGateCommands`/`commandIsSuccessfulGate`/
`authoritativeRepositoryCommand`/`completionReadinessIssues`/`completionReadinessSnapshot`/
`criticReviewCommand`/`queueNextCommand`/`queuePopCommand`/`formatReportBrief` — 149 pass, 0 fail across
20 files, run individually and combined (not the full lane, per instructions).

**Left open: the gvui side.** `resolveModelTier` and `gvui/scripts/import-capsule.ts` are cited in this
item as already-clean (2026-08-20 reconciliation pass, reading gvui source directly), but gvui is a
separate repository not present in this working tree — it could not be re-verified or touched from here.
Regenerating the two `.capsules/` entries and `gvui/public/data/graphs/*.json` per this item's "Remove
from code already written" list is also out of reach from this repo alone. Status reflects the skills
side only; whoever owns the gvui checkout should re-run this item's gvui-side checks before calling B4
fully closed.

**Still queued 2026-08-20 (completion-tagging pass):** the code-level retraction is real — grepped both
repos for `?? node.mediaAssets` / `?? metadata.assets` / `?? node.screenshots` and found none, no
`legacy` normalisation remains in `gvui/scripts/import-capsule.ts`, and no `layout_version` concept
exists anywhere under `scripts/src`. But `docs/planning/orchestration-overhaul/SPEC.md:236-237` still
reads, verbatim, "Existing capsules must keep loading... gvui reads new canonical fields with a
tolerant fallback to the legacy ones" — the exact two sentences this item names and orders struck.
That correction was never applied.

**Re-verified 2026-08-20 (reconciliation pass):** every claim above still holds today, re-run fresh
rather than trusted. `SPEC.md:236-237` still reads exactly those two sentences, unchanged (`grep -n
"Existing capsules must keep loading\|tolerant fallback to the legacy" docs/planning/
orchestration-overhaul/SPEC.md` → lines 236 and 237, same text). Re-grepped both repos for the
fallback shapes and for `layout_version`: zero hits in skills' `orchestrating-long-tasks/scripts/src`
or in gvui's `src`. `resolveModelTier` (`gvui/src/primitives/nodes/NodeCard/nodeKinds.tsx:411`) reads
only `node.telemetry?.modelTier?.value ?? node.hostAgent?.tier` — no legacy flat-field path, confirmed
by reading the function body directly. Item stays open on the SPEC.md text alone; the code side of this
item is fully done.

**Owner decision, and it overrides SPEC.md §10 and parts of B2 and B3.** There is no versioning system,
no dual-mode reader, no legacy fallback, no migration path. The code always reads and writes the current
shape. Old capsules are disposable — regenerate them rather than supporting them.

This is a simplification, and it retires work already done. Everything below must be **removed**, not
merely left unused:

### Retract from the plan

- `manifest.json layout_version` (B2) — delete the concept. There is one layout.
- INV-2 "the chain is never rewritten and v1 still loads" (B2) — replace with: the chain format is
  whatever the current writer emits. Only the append-only property survives.
- The dual-mode event reader (B2 migration) — implement `state_patch` + `state_sha256` only.
  No "adopt `projection` wholesale when present" branch.
- SPEC.md §10's "existing capsules must keep loading" and "gvui reads new canonical fields with a
  tolerant fallback to the legacy ones" — both struck.

### What "no backward compatibility" means — read this before deleting anything

It means **no dual-read paths for renamed fields**. The reader reads `node.assets`; it does not read
`node.assets ?? node.mediaAssets ?? node.metadata.screenshots`. That is the whole of it.

It does **NOT** mean a smaller schema, and it does **NOT** mean removing extension points. Classify every
field before touching it:

**(1) DUPLICATE ALIAS — delete.** A second name for data that already has a canonical home. Deleting loses
nothing because the renderer only ever read one of them.

- `node.mediaAssets`, `node.screenshots`, `metadata.mediaAssets`, `metadata.screenshots`,
  `metadata.assets` — all the same array as `node.assets`.
- `node.model`, `node.tier`, `node.harnessModel` — superseded by `node.telemetry.*`, which carries
  strictly MORE information because each value has an `evidence_class`.

**(2) UNIQUE CONTENT — relocate, never delete.** Carries data that exists nowhere else. `PlaywrightMetadata`
is the worked example: `screenshots` is a duplicate, but `viewport`, `traces`, `videos`, `testFile`,
`durationMs`, `browser` and `status` exist ONLY there. Deleting the interface would destroy real features.
Give each field a proper home and keep it.
RULE: before removing any field, grep for a producer that writes it and confirm the data survives
somewhere. A field is only an alias if its content is genuinely reachable elsewhere.

**(3) OPEN EXTENSION POINT — keep, permanently.** `metadata?: Record<string, unknown>` (4 sites),
`NodeMetadata`, and the `[key: string]: unknown` index signatures. These ARE the flexibility B7 requires.
Removing them contradicts B7 outright. The schema stays open: typed fields for what the renderer uses,
`metadata` for everything else, open unions for kind/role/edge vocabularies.

### Remove from code already written (category 1 only)

- The dual-read fallbacks: grep for `legacy`, `?? node.mediaAssets`, `?? node.screenshots`,
  `?? metadata.assets` and delete the fallback branch, keeping the canonical read.
- `resolveModelTier`'s legacy flat-field read path.
- `gvui/scripts/import-capsule.ts` legacy normalisation — validate against the current contract and reject
  anything else with a clear error.
- The two capsules under `.capsules/` and the shipped fixture at `gvui/public/data/graphs/*.json` are
  replaced by a freshly exported run, not adapted.

### Why this is safe here

Nothing outside these two repos consumes a capsule or a graph dataset. Backward compatibility was
protecting artifacts that are cheap to regenerate, at the cost of permanent complexity in the reader.

---

## B5 — The capsule must be legible to a human browsing it `done (eaabd5c), verified`

**Closed 2026-08-20, per B37 finding 10.** Verified by opening `scripts/src/store/layout.ts` directly:
`CAPSULE_LAYOUT` carries a `responsibility` line for every entry ("What every entry in this capsule is
for."), grouped by lifecycle (`anchor`/`primary`/`derived`/`view`/`export`/`runtime`) rather than by
write path, with `README.md` and `trace.md` both `createdAtInit: true` — the root-level layout note and
the step-trace artifact this item required, landed in the same rewrite commit as B2.

A person opening `.capsules/<run-id>/` should understand what lives where without reading a manual, and
should be able to follow **the trace of steps** — what happened, in order, and what each step produced.

- Group by necessity and by lifecycle, not by internal implementation category. If two directories exist
  because two code paths happened to write them, that is not a reason for two directories.
- Directory names must say what they hold to someone who has never read the source.
- The step trace must be a first-class artifact, not something reconstructed by reading `events.jsonl` by
  hand. A human should be able to open one file and see the run's sequence: plan → waves → per-task
  implement/probe/repair/validate → branch excursions → critic → completion.
- Every directory carries a one-line `README` or an entry in a root-level layout note explaining its
  single responsibility. If that line is hard to write, the directory is wrong.

This constrains B2's target layout: optimise it for a reader first, and for the writer second.

---

## B6 — `summary.md` is a complete, sequential run report `verified`

**Verified 2026-08-20 (reconciliation pass), correcting the earlier "still queued" note below:** a
completeness test analogous to B3's `summary-graph-completeness-contract.test.ts` exists for `summary.md` —
`tests/integration/summary-markdown-run-report.test.ts`, "summary.md is a complete, sequential run report",
whose fixture (`markdown-run-report-fixture.ts`, docstring: "One capsule driven entirely through the
CLI, exercising every feature the report has to carry") drives a real capsule through `execute()`:
enhanced plan, two tasks in one wave plus a third behind a dependency, a branch with two sub-agents, a
probe, a defect pushback with a repair round, gate evidence, a non-zero-exit command, host-reported
agent telemetry, a critic verdict and a sealed completion. `bun test
tests/integration/summary-markdown-run-report.test.ts` — 18/18 pass — asserts, in run order, every section this
item's own list names (prompt, enhanced plan, derived requirements, topology with parallel rationale,
ASCII task graph with an explicit `not.toContain("\`\`\`mermaid")`, agents/sub-agents with role/parent/
grants, the branch excursion's why/who/what-came-back, per-sub-task claim/submit timestamps, every
command with its exit code including the failing one, probes and pushbacks in separate labelled
sections with round numbers, gates/findings/critic verdict, and telemetry with its evidence class
alongside an explicit `unknown`row for an agent that reported none). Reachable: the fixture calls the
real CLI, not a stub. Does what was asked: the heading list and the assertions were checked bullet by
bullet against this item's own requirements, not against what was convenient to build. Guard holds:
confirmed directly rather than assumed — rsync'ed`orchestrating-long-tasks/`+`tests/`to a scratch
copy outside the repo (never the real tree, since`summary/markdown-*.ts`is another wave's live file
ownership), gutted`renderTopology`in`markdown-plan-sections.ts`to return`[]`, and reran the test
there: it failed immediately ("## 5. Recorded Topology is missing from the report" plus a second,
independent assertion failure on the same missing section), then the scratch copy was deleted and
`git status` on the real tree confirmed untouched. This was created by an earlier, different wave
(`tests/unit/summary/markdown-run-report-fixture.ts`first landed in commit`34f8343`, "feat: add
validator checklists and orchestrate entry point" — a different commit from this verification), so this
qualifies as a genuinely separate, later pass per the `verified` tag's own definition.

**Previously, still queued 2026-08-20 (completion-tagging pass):** `summary:export`/`summary:view` commands exist
(`scripts/src/cli/registry/summary.ts`) and an ASCII graph renderer exists
(`scripts/src/summary/markdown-ascii-graph.ts`), so the shape is real. No completeness test analogous
to B3's `summary-graph-completeness-contract.test.ts` was found for `summary.md`, so coverage against this
item's own list (branch excursions, probe/pushback distinguished, gates/findings/critic verdict,
telemetry with evidence class) is unconfirmed either way.

CLI-generated (`summary:export` / `summary:view`), read top to bottom, and complete on its own.

Must include, in run order:

- the original prompt, the enhanced plan and the derived requirements;
- every implementation phase and wave, with what ran in parallel and why;
- the task graph rendered legibly in the document itself (ASCII, never mermaid — this is read in a
  terminal and in plain Markdown viewers);
- every agent and sub-agent: role, parent, what it was granted, what it reported;
- branch excursions: why the branch opened, which sub-agent took which sub-task, what came back;
- every script run, with its exit code;
- every tool used;
- every probe and every pushback, distinguished, with round numbers;
- gates, findings, resolutions and the critic's verdict;
- token and model telemetry with its evidence class, and `unknown` where nothing was reported.

It is the human-readable sibling of `graph.json`: the graph carries everything for the renderer, the
markdown carries everything for the reader. Neither is a summary in the sense of "abridged".

---

## B7 — GVUI stays a general-purpose graph visualizer `verified`

**Verified 2026-08-20 (completion-tagging pass):** `gvui/src/testing/foreignDataset.test.tsx` exists
and does exactly what this item's last bullet demands — `describe("the foreign dataset speaks none of
the orchestration vocabulary")` with tests for node kinds gvui has never seen, edge kinds it has never
seen, roles it has never seen, and asserting none of the orchestration-only execution-run props are
required, plus `describe("importing the foreign dataset")` / `test("raises no error")`.

**Owner intent:** gvui is not an orchestration-run viewer. It must render any directed graph anyone brings
to it — another project's topology, a thought sketch, a dependency map — and the orchestration schema is
one _consumer_ of that generality, not its definition.

The role and variant work in waves 4-5 risks hard-coding the nine orchestration roles into the renderer.
Correct that:

- **Open vocabularies.** Node kind, node role, edge kind and section type must accept values the renderer
  has never seen and still render sensibly — a stable generated accent, a readable label, a sane default
  silhouette. An unknown member is a normal case, never an error and never a fallback that silently
  looks like something else.
- **The nine orchestration roles are a preset, not the schema.** They live in a descriptor table that a
  different dataset can extend or ignore entirely.
- **Props stay generic.** `scripts`, `tools`, `stateTransitions`, `telemetry`, `assets` are useful to any
  execution graph, not just this one. Keep them optional and generically named; resist orchestration-only
  field names leaking into the core contract.
- **The sidebar expands whatever a node actually carries.** Given an unfamiliar node, it should surface
  that node's fields, variants and roles in a readable way rather than showing empty tabs designed for a
  schema this dataset does not use.
- **Test with a foreign dataset.** The suite must include a graph that uses none of the orchestration
  vocabulary — arbitrary kinds, arbitrary roles, arbitrary props — and assert it renders completely.

Flexibility here is a design property the owner wants preserved, not an accident to be tidied away.

---

## B8 — Disposition of the ~40 audit findings, and the gaps still open `queued`

**Still queued 2026-08-20 (completion-tagging pass), mixed sub-items:** B8.1 (role packet enforcement)
is confirmed live by B38's own guard-deletion test (deleting the throw failed 12/53 tests). B8.2
(`handoff.md`) is confirmed wired: real call sites now exist in `task-reject.ts`, `run-ops.ts`,
`task-claim.ts` and `task-review.ts`. B8.4 is confirmed done: `bun run format:check` is clean in gvui
and `orchestrating-long-tasks/scripts/package.json` no longer declares the stale `bun test tests`
script. B8.3 is only half-fixed: `resolveModelTier`'s gvui duplicate is gone (`htmlExporter.ts` now
imports it), but `customLayoutAdapter.ts`/`custom/wasmLayoutAdapter.ts` are still two separate adapters
and `getNodeRepairRounds` is still defined separately in `ComparisonView/diffEngine.ts` and
`GraphDiff/diffEngine.ts`. Item stays open on that gap.

**Re-verified 2026-08-20 (reconciliation pass):** B8.1/B8.2/B8.3/B8.4 re-checked fresh, not read from the
notes below. B8.1's call sites moved a couple of lines since last confirmed — `record-review.ts:52` and
`submit.ts:86` (not `:48`/`:59`), `cli/execute.ts:29` (not `:33`) — but both are still live, unconditional
calls; `publishRolePacket` now has **four** callers, not three (`planner-packet.ts:37`,
`plan-validator-grant.ts:48`, `role-grant.ts:114`, `critic-grant.ts:100` — a `plan-validator-grant.ts`
caller was added since the cited note). `bun test tests/unit/packets/role-contract-refusals.test.ts
tests/unit/packets/role-contract-enforcement.test.ts` → 63 pass, 0 fail (not 65 — some tests were
consolidated, still comprehensive). B8.2's `writeHandoff` is called indirectly through
`refreshHandoff`/`refreshHandoffOnEscalation` wrappers, confirmed by grep in all four cited command files
— still genuinely wired. B8.3's two open gaps are unchanged, exact same lines (`diffEngine.ts:211` and
`:453`), and `wasmLayoutAdapter.ts` is confirmed even more clearly dead than stated: nothing outside its
own module and its own test imports it, not even through the `custom/index.ts` barrel that re-exports it.
B8.4's first two housekeeping bullets are confirmed done (`bun run format:check` clean, stale script gone)
— see B8.4 below for the `.lock/` bullet, now also resolved. B8.5's four structural tests, listed as an ask
below, all now exist and are wired into `bun harness.ts health` — see the note under B8.5.

**Triaged 2026-08-21 (B8 container-item pass, all four sub-items re-checked fresh against disk, not read
from the notes above):** B8.1 and B8.2 hold exactly as the 2026-08-20 reconciliation pass found them — same
call sites (`submit.ts:86`, `record-review.ts:52`, `execute.ts:29`, four `publishRolePacket` callers at
`planner-packet.ts:37`/`plan-validator-grant.ts:48`/`role-grant.ts:114`/`critic-grant.ts:100`), same
`refreshHandoff`/`refreshHandoffOnEscalation` wiring in all four command files (line numbers drift with
concurrent edits elsewhere in those files — `task-reject.ts:103`, `run-ops.ts:109`, `task-claim.ts:310`,
`task-review.ts:229` today — but every call is still live and unconditional), `bun test tests/unit/packets/
role-contract-refusals.test.ts tests/unit/packets/role-contract-enforcement.test.ts` still 63 pass, 0 fail.
Both stay closed. What genuinely remains, after re-checking each open claim directly rather than trusting
the prior pass's citations:

1. **B8.3's two gvui duplicates are still open, unchanged, same lines** (`ComparisonView/diffEngine.ts:211`
   and `GraphDiff/diffEngine.ts:453` for `getNodeRepairRounds`; `customLayoutAdapter.ts` and
   `custom/wasmLayoutAdapter.ts` both still exist as separate files, `wasmLayoutAdapter.ts` still reachable
   only from its own test and other tests' dynamic `import()`s, never from production code, not even through
   the `custom/index.ts` barrel that re-exports it). This is the one real code gap this item still holds,
   and it lives entirely in gvui, a separate repository from this one.
2. **B8.4's `run:exec` stall claim, attempted directly for the first time today.** Built a disposable,
   gitignored scratch capsule (`.capsules/b8-triage-timing-check`, deleted after) and drove `run:exec`
   through the real CLI twice: once bare (`bun -e 'console.log("hi"); process.exit(0)'`, no `--task`/
   `--gate`) and once against a real compiled task's real gate (`--task task-1 --gate gate-1`, gate command
   `bun test tests/unit/health/fallbacks.test.ts`). Wall-clock via the shell's own `time`: 0.26s and 1.20s
   respectively — no multi-second gap observed between the child process finishing and the harness command
   returning either time. This is not a byte-for-byte reproduction of whatever specific command or
   concurrency state originally produced "~5.2s" (that detail was never recorded), so it cannot certify the
   exact original report closed — but it is the first time anyone actually ran the ask instead of leaving it
   unconfirmed, and it found nothing. Separately, `ecb5536` ("perf: back off descendant polling and bound
   process snapshots", landed 2026-08-20) replaced `DescendantTracker`'s fixed 10ms `setInterval` `ps`-spawn
   loop — which ran for an attempt's entire lifetime, unref'd but still real subprocess overhead — with a
   geometric backoff capped at 250ms; that is real, relevant infrastructure work but it targets a different
   symptom (poll-storm overhead during execution) than the one this bullet names (a gap after exit), so it
   does not by itself certify this bullet closed. Recommendation: close this bullet unless someone can name
   the specific scenario that produced 5.2s — two direct attempts (this one and the last pass's absence of
   one) have now found no stall.
3. **B8.5's four structural tests are still correctly wired** (`ALL_CHECKS` in `health/index.ts` still lists
   `unused-code`, `unenforced-declarations`, `literal-fallbacks`, `vendor-identifiers`, unchanged). Their
   live pass count right now is not the "34 pass, 0 fail" the 2026-08-20 note recorded, though:
   `fallbacks.test.ts` + `reachability.test.ts` are clean (25/25), `manifest.test.ts` is clean (4/4), but
   `vendor-identifiers.test.ts` has 3 of 6 tests failing this moment, because a different, concurrent,
   uncommitted, untracked change — `orchestrating-long-tasks/scripts/src/store/content-normalization/
   typescript-whitespace.ts`, created today between 00:40 and 00:48, a module outside B8's ownership and
   not part of this item's scope — names the vendor product "TypeScript" in its own filename and exported
   function (`canonicalizeTypeScriptWhitespace`) without adding itself to the test's `SCRIPT_EXEMPTIONS`
   list. This is the check doing exactly its job on an in-flight file, not a defect in the policy or its
   wiring; it is flagged here only because "genuinely remains" has to reflect what the suite reports right
   now, not what it reported yesterday. Whoever lands that module should add its own exemption (or rename
   away from the vendor word) as part of landing it — not a B8 action item.

Roughly forty defects were found beyond the original brief. Most are fixed. This item covers the ones that
are NOT, plus the policy that stops the rest from coming back.

### B8.1 RESOLVED — role contracts are enforced

**Corrected 2026-08-20 (verification-pass-7): the text below (originally written 2026-08-20 03:08:44,
commit `eaabd5cc`) described the pre-fix state and was left standing after the fix landed in the SAME
commit, contradicting this item's own top status note two paragraphs above. Re-verified fresh by direct
grep, not by reading either note: `assertPublishedTaskPacket(` now has two real call sites —
`workflow/review/record-review.ts:48` and `workflow/submission/submit.ts:59` — both invoked, not merely
imported. `publishRolePacket` has three callers (`packets/planner-packet.ts:27`,
`packets/critic-grant.ts:124`, `packets/role-grant.ts:144`), not one. Dispatch-time enforcement is also
live: `cli/execute.ts:33` calls `assertGrantedCommand` before every handler runs. All three "To close"
bullets below and the cited tests are done; kept only as the historical record of what CRITICAL meant.**

- Publish a role packet at `task:claim`, `task:validate-start`, `critic:start` and `branch:claim`, carrying
  the role contract bytes and their sha256. — done.
- **Actually invoke** `assertPublishedTaskPacket` in `submit` and `record-review`, so an agent acting
  without a published contract is refused. — done, confirmed above.
- Enforce the contract's `commands:` list at dispatch: a role invoking a command its contract does not
  grant is refused with INVALID_STATE. — done, confirmed above.
- Test: an implementer cannot submit without a published packet; a validator cannot invoke an
  implementer-only command; the packet digest matches the checked-in role document. — `tests/unit/packets/
role-contract-refusals.test.ts` + `role-contract-enforcement.test.ts`, 65/65 pass (re-run 2026-08-20);
  guard-deletion on `command-authority.ts`'s `assertRoleMayInvoke` throw reproduces 12/53 failures.

### B8.2 RESOLVED — `handoff.md` is produced

**Corrected 2026-08-20 (verification-pass-7): same staleness as B8.1 — this line said "zero call sites"**
**after real call sites already existed.** `writeHandoff` (`reporting/handoff.ts:146`) is now called from
`cli/commands/task-reject.ts`, `run-ops.ts`, `task-claim.ts` and `task-review.ts` (confirmed by grep,
2026-08-20). Kept only as the historical record.

### B8.3 Duplicate implementations — partially resolved

- ~~`resolveModelTier` still has a copy in `gvui/src/utils/htmlExporter.ts`~~ — **resolved**: `htmlExporter.ts`
  now imports it from `primitives/nodes/NodeCard/nodeKinds.tsx` (confirmed 2026-08-20).
- Two layout adapters in gvui (`engine/layout/customLayoutAdapter.ts` vs
  `engine/layout/custom/wasmLayoutAdapter.ts`), near-identical, only one used. — still open, both files
  exist (confirmed 2026-08-20).
- `getNodeRepairRounds` duplicated across **two** gvui files (`components/ComparisonView/diffEngine.ts:211`
  and `components/GraphDiff/diffEngine.ts:453`), not three as originally written — still open, corrected
  count confirmed 2026-08-20.
  Collapse each to one implementation. A duplicated helper is where the next silent divergence starts.

**Re-confirmed 2026-08-21 (B8 triage pass): both gaps still open, exact same lines, nothing changed.**
`wasmLayoutAdapter.ts` grep-confirmed reachable only from `custom/wasmLayoutAdapter.test.ts` and four other
test files' dynamic `import()`s (`types/exampleGraphs.test.ts`, `testing/currentSkillExport.test.tsx`,
`testing/unknownFields.test.tsx`, `testing/foreignDataset.test.tsx`), plus `engine/layout/
invertedTransforms.test.ts`'s static import — every reference is a test, none is production code, and
grepping for anything outside `src` importing the `custom/index.ts` barrel that re-exports it still finds
nothing. Genuinely still the item's one open code gap, and it is gvui-only — out of scope for this repo's
wave.

### B8.4 Housekeeping

- Four gvui source files fail `bun run format:check`.
- `orchestrating-long-tasks/scripts/package.json` declares `bun test tests` against a path with no tests;
  the real suite is at the repo root. Fix or delete.
- ~~`.lock/` lives inside the capsule, indistinguishable from durable state (also covered by B2).~~ —
  **resolved**: run locks now live beside the capsule, not inside it. `store/layout.ts`'s
  `LOCKS_DIRECTORY = ".locks"` is joined against `dirname(runRoot)` in `platform/observer.ts:30` —
  `join(dirname(runRoot), LOCKS_DIRECTORY, basename(runRoot))` — landing at `.capsules/.locks/<run-id>/`,
  a sibling of `.capsules/<run-id>/`, not a child of it. `layout.ts`'s own generated README says so too:
  "Run locks are not stored here. They live beside the capsules in `.capsules/.locks/`, because
  coordination state is not durable state." Confirmed 2026-08-20 by reading both files directly.
- Confirm the `run:exec` ~5.2 s post-exit stall is genuinely fixed; it was assigned but the fix was never
  independently confirmed. **Still unconfirmed** — not settled this pass either; tracing it requires
  driving a real `run:exec` through the CLI and timing the process exit, which this pass did not do.
  Settling it needs someone to actually run `bun harness.ts run:exec ...` end to end and time the gap
  between the child process exiting and the command returning.

**Attempted directly 2026-08-21 (B8 triage pass) — first time anyone has actually run this ask.** Built a
scratch capsule under `.capsules/b8-triage-timing-check` (disposable, gitignored, deleted after) via
`plan:init`/`plan:add`/`plan:compile`/`task:claim`, then ran `run:exec` twice through the real CLI, timed
with the shell's own `time`: once bare (no `--task`/`--gate`, `bun -e 'console.log("hi");
process.exit(0)'`) — 0.26s real; once against the compiled task's real gate (`--task task-1 --gate gate-1`,
gate command `bun test tests/unit/health/fallbacks.test.ts`) — 1.20s real. Neither run showed a multi-second
gap between the child exiting and the command returning. This is not the exact original repro (the command
and concurrency conditions that produced "~5.2s" were never recorded, so an exact match isn't possible), so
it cannot certify the original number as explained — but it is a real, direct attempt with a real result,
which is more than this bullet has ever had. A separate, adjacent perf fix landed since the last check
(`ecb5536`, "perf: back off descendant polling and bound process snapshots") — it replaced
`DescendantTracker`'s fixed-10ms `setInterval` `ps`-spawn loop (running for an attempt's entire lifetime)
with a geometric backoff capped at 250ms, but that targets poll-storm overhead during execution, not
specifically a post-exit gap, so it's relevant context, not a certified fix for this exact bullet.
Recommend closing this bullet as not reproducible under real conditions, unless whoever assigned "~5.2s"
can name the specific scenario.

### B8.5 THE POLICY — a fix without a regression test is a fix that returns

This is the most important part of this item, and it applies to all forty findings.

Roughly a dozen defects were fixed by editing the offending line, with no test that would catch the same
shape reappearing. The defect classes that recurred repeatedly across waves — and will recur again — are:

1. a plausible literal substituted for missing data (`?? "src/index.ts"`, `?? "pending"`, `|| "agent"`);
2. a value inferred from a NAME rather than a RECORD (model-name to tier, agent-id to role);
3. `length === 0 ||` turning absence into success;
4. a fallback that borrows another node's data when a node's own is missing;
5. documentation asserting a flag or command that does not exist;
6. an implemented subsystem with no call site.

Each deserves a **structural test**, not a one-line fix:

- a lint-style test failing on the literal-fallback patterns in production source;
- a test asserting no vendor model name appears anywhere in either repo's source;
- the manifest-freshness test already covers (5) — extend it so every command invocation in every doc is
  checked against the registry, which is currently done by hand during review;
- a reachability test: every exported symbol under `scripts/src/` has a caller, or is explicitly listed as
  intentional public API. **This one test would have caught the role packets, the scheduler, the config
  loader, the lease recovery and `handoff.md` — five of the largest findings in the whole audit.**

Ship these before the overhaul is called done. Without them the audit's value decays the moment attention
moves elsewhere.

**Resolved 2026-08-20 (reconciliation pass) — all four structural tests asked for above now exist and are
wired into the one tool, not scattered fixes.** `tests/unit/health/fallbacks.test.ts` exercises
`checkLiteralFallbacks` against exactly the example shapes named above (`?? "src/index.ts"`, `?? "pending"`,
`|| "agent"`). `tests/unit/architecture/vendor-identifiers.test.ts` exercises `scanTreeForVendorIdentifiers`
against `VENDOR_NAMES`, sweeping both the skills and gvui trees. `tests/unit/cli/manifest.test.ts` plus
`orchestrating-long-tasks/scripts/src/health/unenforced.ts`'s `documented-command-missing` check extend the
manifest-freshness idea exactly as asked: every `harness.ts <command>` invocation named in any scanned doc
is checked against `commandInvocations()` from the real `COMMAND_REGISTRY`. `tests/unit/health/
reachability.test.ts` exercises `checkUnusedCode`, the reachability sweep. All four are wired as real
checks inside `ALL_CHECKS` in `orchestrating-long-tasks/scripts/src/health/index.ts` (`unused-code`,
`literal-fallbacks`, `vendor-identifiers`, `unenforced-declarations`), not orphaned fixtures — confirmed by
running `bun test tests/unit/health/fallbacks.test.ts tests/unit/health/reachability.test.ts tests/unit/
architecture/vendor-identifiers.test.ts tests/unit/cli/manifest.test.ts` (34 pass, 0 fail) and by reading
`health/index.ts`'s import list directly. This is the same tool B9.2 asks for below — see B9 for its
current live output, which is not clean.

**Live status re-checked 2026-08-21 (B8 triage pass): wiring unchanged, pass count is not 34/0 right now.**
`ALL_CHECKS` still lists all four checks, unchanged. Running the same four files fresh: `fallbacks.test.ts`
and `reachability.test.ts` together are 25 pass, 0 fail. `manifest.test.ts` alone is 4 pass, 0 fail (this
one was transiently failing mid-pass while a concurrent commit was regenerating `references/
cli-capabilities.md`/`.json`, and cleared on its own once that commit landed — a live-repo timing artifact,
not a defect). `vendor-identifiers.test.ts` alone is 3 pass, 3 fail, all three failures traced to one
cause: a different agent's concurrent, uncommitted, untracked module (`orchestrating-long-tasks/scripts/
src/store/content-normalization/typescript-whitespace.ts`, created today, not part of B8's scope) names the
vendor product "TypeScript" in its own filename and an exported function
(`canonicalizeTypeScriptWhitespace`) without adding itself to the test's `SCRIPT_EXEMPTIONS` list. The
check is correctly catching an unreviewed file before commit, not malfunctioning — but "genuinely remains"
has to reflect the number the suite reports right now, so the accurate current figure across the four
files is 32 pass, 3 fail, not 34/0, until that module either adds its own exemption or is committed with
one already in place. Not a B8 action item.

---

## B9 — Coverage and semantic health check `queued`

**Still queued 2026-08-20 (completion-tagging pass):** B9.2 is done and running — ran
`bun orchestrating-long-tasks/scripts/harness.ts health --consumer ../gvui --all` directly just now:
verdict healthy, 0 failures, 438 advisories, and the four checks it reports (unused code, dead code,
declared-but-unenforced, intent drift) are exactly the four B9.2 asked for. B9.1's CI-enforced coverage
floor was not found: `.github/workflows/ci.yml` runs `bun test` + `bun run typecheck` only, no
`--coverage` step and no threshold anywhere in the repo.

**Re-run 2026-08-20 (reconciliation pass) — same command, materially different result; do not read "0
failures" as current.** Ran `bun orchestrating-long-tasks/scripts/harness.ts health --consumer ../gvui
--all` fresh: **verdict UNHEALTHY, 28 failures, 507 advisories, 21 allowed, 7 checks run** (not 0
failures / 438 advisories — the codebase moved under the tool between that note and this one). B9.2's
own deliverable — a command that exists, runs on demand, and covers at least the four required checks
plus three more (literal-fallbacks, vendor-identifiers, an unqualified-dispatch check) — is still real and
still done; what changed is what the tool is finding, not whether it runs. Breaking down the 28: 26 are
`intent-drift` failures, all of the shape "BACKLOG.md item `B<n>` names a test file that is not present
in the scanned source" — fallout from the test-lane-split commits (`a214752`, `5869023`) that moved
roughly two dozen tests from `tests/unit/...` into flat `tests/integration/...` files without updating
their citations. B3 is one of them (see B3's own entry, corrected above); the rest — B1, B2, B6, B15, B19,
B20, B27, B34, B35, B38, B39, B40 — are not owned by this item and are reported separately rather than
touched here. The other 2 are `unused-code` failures, and they split one true positive from one false
positive: `orchestrating-long-tasks/scripts/src/workflow/lease/abandon.ts` is genuinely dead — grepped for
every production import of `abandonAttempt`/`lease/abandon` and found none, yet `attempt-state.ts:39`'s
own `HarnessError` message tells an operator to "call abandonAttempt to close it explicitly," a command
that does not exist anywhere in `cli/registry` — reported separately as a new finding, exactly the "B8.5
class 6" shape this item's own B9.2 §1 describes. `orchestrating-long-tasks/scripts/src/store/index.ts` is
a **false positive** in the health tool itself: grepped for `from ".*/store/index"` and found 40+
production importers (`reporting/status.ts`, `cli/commands/task-claim.ts`, `cli/commands/run-ops.ts`, and
many more), so "no production module imports anything from it" is factually wrong — a bug in the
reachability check's own module resolution, also reported separately, not fixed here (source is out of
scope for this pass). None of this changes B9's own verdict: B9.1 stays unmet (see below, now with
sharper evidence), and B9.2's tool is real, runs, and — bug aside — is doing real, current work; the item
stays open on B9.1 alone.

**2026-08-21 (B9 owner pass) — false positive closed, coverage re-measured, item stays `queued`.**

*The `store/index.ts` false positive is fixed*, commit `be9b91a`. Root cause, found by tracing
`usageIndex` in `reachability.ts`: `usage.importedModules.add(binding.from)` only ran inside the
`binding.imported === "*"` branch, so a **named** import (`import { loadRun } from "../store/index.ts"`)
never registered the barrel file itself as production-imported — only `resolveOrigin`'s resolved
target did, which for a pure re-export barrel is the file the barrel forwards to, not the barrel. Any
barrel file imported everywhere by name (`store/index.ts` has 59 such import edges from 40+ production
files, reconfirmed by direct script) could therefore read as production-untouched. The one-line fix
hoists that `add` above the namespace check so a direct import registers regardless of import style or
re-export depth. Regression test added: `tests/unit/health/reachability.test.ts` → "a pure re-export
barrel used by production through named imports" — verified to actually guard the fix, not just pass
with it: stashed `reachability.ts` alone, re-ran the file, and the new test failed with `["module-test-
only:barrel.ts", ...]` present, exactly the false-positive shape; unstashed and it passes again. Re-ran
`bun harness.ts health --all` against the live tree after committing: `store/index.ts` no longer appears
anywhere in the output (`grep -n "store/index"` on the report is empty). This closes QUEUE.md #17 and
this item's own first defect.

*B9.1 coverage, re-measured from scratch* (the "roughly 83% funcs / 84% lines" figure this item was
dispatched with does not match current disk state — do not carry it forward). Ran
`bun test --coverage --timeout 30000 tests/unit` directly: **`All files` — 97.88% funcs / 98.19% lines**,
3935 pass / 10 fail / 3945 total in that run. The 10 failures are not in any file this item owns
(`health/**`, `tests/unit/health/**`) and were not introduced by this pass's own commit — they trace to
other agents' in-flight, uncommitted work landing in this shared, non-worktree checkout while this
measurement ran (`tests/unit/architecture/vendor-identifiers.test.ts`, `tests/unit/architecture/file-
size.test.ts`, `tests/unit/cli/*` task:review cases, a `run:status` case, and `tests/unit/workflow/legacy-
capsule-completion.test.ts` — none under this item's file ownership, reported here rather than touched).
The CI-enforced floor B9.1 also asks for is still absent — `.github/workflows/ci.yml` still runs no
`--coverage` step and sets no threshold — and stays unmet because that file is outside this item's owned
paths (`health/**` only); it is QUEUE.md #3, blocked on QUEUE #1, and is that item's to close. **B9 stays
`queued`** on B9.1's CI floor alone: B9.2 remains real, wired, and running (reconfirmed this pass), and
its one known defect is now fixed and guarded.

### B9.1 Coverage bar

Every new implementation in this overhaul must reach **as close to 100% as the code honestly allows**
across all categories — statements, branches, functions, lines. Where 100% is not reachable, the gap must
be named and justified in the test file, never silently accepted.

- skills: `bun test --coverage tests/unit`. gvui: the equivalent bun coverage run.
- Set a floor in CI that fails on regression, and raise it as coverage climbs. A floor that never moves is
  a floor nobody defends.
- **Coverage of lines is not the goal — coverage of SCENARIOS is.** A test that executes a branch without
  asserting the behaviour we actually wanted is worse than no test, because it reports safety it does not
  provide. For every new capability, the suite must cover the scenarios the requirement described:
  probe then pass, probe then reject then repair then pass, escalation at the bound, a branch that
  collects, a branch that is abandoned, a dead agent recovered mid-chain, a wave that partly conflicts on
  scope, an agent that reports no telemetry at all.
- Negative paths are mandatory, not optional: every refusal the harness can issue needs a test proving it
  refuses, because the refusals ARE the guarantees.

### B9.2 Semantic health check — does the code do what we meant?

Distinct from a script or process check. This asks whether the LOGIC achieves the intent, and it must be
runnable on demand rather than living in a reviewer's head.

The check must report, as hard failures:

1. **Unused code.** Any exported symbol with no caller, any unreachable function or method, any parameter
   never read. This is the single highest-value check available here: five of the largest findings in the
   whole audit — the role packets, the conflict-aware scheduler, the config loader, lease recovery, and
   `handoff.md` — were all fully implemented code that nothing called. See B8.5.
2. **Dead or superseded code.** Code paths kept "just in case", commented-out blocks, compatibility
   branches for shapes that no longer exist (B4), and helpers duplicated across files (B8.3).
3. **Declared-but-unenforced behaviour.** A config knob nothing reads. A documented invariant with no code
   path. A capability contract that binds nothing. These were endemic in the pre-overhaul codebase and are
   the class most likely to return.
4. **Intent drift.** Every requirement in SPEC.md and every item in this backlog mapped to the code that
   implements it and the test that proves it. An item with no test is not done, whatever a report says.

Ship it as a command the owner can run — a `health` command on the harness, or a repo script — that
prints a pass/fail report. Its output must be honest about what it cannot check.

---

## B10 — Unknown fields must never break the renderer `verified`

**Verified 2026-08-20 (completion-tagging pass):** `gvui/src/state/graphSchema.test.ts`'s
`describe("validateGraphDataset ignores what it does not understand")` directly tests this item's own
list — a node prop of the wrong type ignored with the rest of the node kept, unknown `tools`/`files`/
`exchanges` array entries ignored per-entry, and a node missing an id dropped with a clear message —
read directly from the test file's assertions, not inferred from its name.

**Owner requirement, and it CORRECTS the importer instruction given in wave 6** ("validate against the
current contract and reject anything else"). That was too strict and must be softened.

The rule: **a JSON document that parses is enough.** The visualizer renders everything it understands and
silently ignores everything it does not. An unrecognised field, subfield, or key/value pair must be
treated exactly as if it were absent — never a crash, never a thrown error, never a blank screen.

- Unknown top-level keys, unknown node props, unknown edge props, unknown nested objects: ignored.
- Unknown _members_ of a known vocabulary (a node kind, role, or edge kind the renderer has never seen)
  render sensibly — that is B7, and it stays.
- A known field carrying an unexpected type: skip that field, keep the rest of the node. Do not discard
  the node and do not fail the document.
- Hard-fail ONLY when the document cannot be parsed as JSON, or lacks the minimal skeleton (`nodes` and
  `edges` arrays). Everything above that line degrades instead of breaking.
- The importer may WARN about what it ignored — a warning is useful, an exception is not.

This is the standard forward-compatibility discipline: **be strict in what you emit, tolerant in what you
accept.** It is what lets the producer add a field without waiting for the renderer, lets an older
renderer open a newer graph, and lets someone hand-write a graph by hand and still see it.

Note this does NOT reopen B4. B4 removes dual-read paths for RENAMED fields — the reader does not consult
two names for one value. B10 says an unrecognised name is ignored rather than fatal. Both hold at once.

Tests: a graph with junk top-level keys, junk node props, a node prop of the wrong type, a nested unknown
object, and a completely unknown node kind — all render, none throw. Plus a malformed-JSON case that does
fail, with a clear message.

---

## B11 — Commit cadence, and the flaky test that blocks it `verified`

**Verified 2026-08-20 (completion-tagging pass):** ran
`bun test tests/unit/installer/installer-lock.test.ts` directly — 1/1 pass. Reading the test confirms
the fix is structural, not a widened timeout: it no longer asserts an exit code immediately after
`SIGTERM`; it now waits for `child.exited` (the worker's own SIGTERM handler releasing and exiting) and
separately asserts `child.signalCode` is null, removing the exact race B11.1 named. The cadence itself
matches observed practice: `git log` on this branch shows frequent, small Conventional Commits.

**Owner decision:** commit and push after every completed unit of work, automatically. The application has
no other users; the developer is the only consumer, so continuous small commits beat a large landing.

### Cadence adopted

- Work lands on branch `orchestration-overhaul` in both repos (default branch stays clean; merge when ready).
- A commit happens at each **wave boundary, after gates pass** — never mid-wave. Five agents write
  concurrently during a wave, so a mid-wave snapshot captures a half-written tree and would produce a
  commit that does not build.
- Conventional Commits, subject under 70 chars, imperative, no AI or tool attribution.
- Push immediately after each commit.

### B11.1 The flaky test undermines the whole scheme

`tests/unit/installer/installer-lock.test.ts` — "an inode-bound flock excludes a concurrent installer
process" — is timing-dependent. Verified 2026-08-20: it fails under heavy parallel machine load with
`expect(await child.exited).toBe(0)` receiving **143** (SIGTERM), and passes 3/3 in isolation.

The test kills the child with `SIGTERM` and then asserts a clean exit code; under load the kill races the
child's own exit path. That is the test's bug, not the harness's.

This is load-bearing because the repo's `lefthook` pre-commit hook runs `typecheck` + the full unit suite,
so a random flake **blocks a commit at random**. An automatic commit workflow cannot sit on top of a
non-deterministic gate — and the wrong fix (`--no-verify`) would discard the one thing keeping bad commits
out.

Fix the test: assert on the signal the child was actually killed with, or wait for the process to reach a
deterministic state before asserting. Then sweep the suite for the same shape — any assertion on an exit
code after an explicit kill, and any timing-dependent wait.

---

## B12 — Typed validators with standing checklists (the guardian system) `verified` **[TOP QUALITY PRIORITY]**

**Verified 2026-08-20 (completion-tagging pass):** all five checklists exist under `checklists/`
(code-quality, product, security, system-design, ui-design) with a matching `roles/validator-*.md` for
each domain. Multi-domain sizing is implemented: `resolveDomain`/`applicableValidatorDomains` in
`workflow/review/begin-validation.ts` derive the domain from write scope, covered by
`tests/unit/workflow/review/multi-domain-validation.test.ts`. The structured report shape (B12.5) is implemented
in `workflow/review/validate-review.ts` — `ChecklistDisposition` is exactly
`"checked" | "not_applicable" | "could_not_check"`, `ChecklistCoverageEntry`/`ChecklistCoverageReport`
carry `adjacent_findings` separately from task-scope findings, covered by
`tests/unit/workflow/review/checklist-coverage.test.ts`.

> Ranked highest of every backlog item for defect-catching. A UI validator carrying 200 domain rules
> catches an order of magnitude more than one carrying a task description. The owner's sidebar example
> (inconsistent text sizes nobody asked about) is only findable by a validator with standing standards —
> no amount of tuning WHO validates produces it; it comes from WHAT they carry.

**Origin, in the owner's words:** "there should be different types of validators — UI feature validator,
product value validator, system design validator, code quality validator... If validators keep a proper,
very long list of checklist items, maybe hundreds, and validate each implementation based on the
checklist, they probably give a better response. Sometimes what's happening is I give a task, and the
validators don't get good context about what should be validated."

Today there is ONE validator role, and its knowledge of "good" comes entirely from whatever the
coordinator wrote into the task. That is why validation quality swings with prompt quality.

### B12.1 The worked example that defines the requirement

Task: _"remove a specific icon from the sidebar."_

A validator that only checks the task will confirm the icon is gone and pass. But the sidebar also has
inconsistent text sizes — larger than every sibling, breaking the repo's own convention, not a deliberate
design choice. Nobody mentioned it. The task did not ask about it.

**A UI validator carrying standing design standards must flag it anyway.** General standards apply
always, not only where the task points. A report must combine three inputs:

1. the **standing checklist** for the validator's domain (permanent, versioned, in the repo);
2. the **task-specific** acceptance criteria (per run);
3. the **role contract** — what this validator may and may not do (B8.1).

The finding must be _classified_ so it informs without derailing: a task-scope defect blocks the task; a
standing-standard violation found in the touched area is recorded as an adjacent finding, surfaced to the
coordinator, and routed to a repair task or the backlog rather than silently blocking an unrelated change.

### B12.2 Validator taxonomy

`validator` becomes a family, not a single role. Initial members, extensible by design:

- `validator-code-quality` — structure, naming, duplication, dead code, error handling, types, tests.
- `validator-ui-design` — layout, typography, spacing, contrast, responsive behaviour, motion,
  accessibility. Absorbs the existing dual-channel visual protocol as one section of its checklist.
- `validator-product` — does the change deliver the user-visible value the prompt asked for; is the flow
  coherent; are states (empty, loading, error, partial) handled as a product, not just as code.
- `validator-system-design` — boundaries, contracts, data ownership, failure modes, migration safety,
  coupling, observability.
- `validator-security` — worth adding; the audit found plaintext tokens on disk that no reviewer caught.

Selection is **derived from the task's write scope**, not guessed: a task touching `.tsx`/`.css` draws the
UI validator; one touching a schema or a public contract draws the system-design validator; every task
draws code-quality. A task may therefore have MORE THAN ONE validator.

**This changes the sizing formula.** The 2N+1 triad assumed one validator per implementer. It becomes
1 coordinator + N implementers + Σ(validators per task). Update the sizing rule, and note the interaction
with `max_agents` (B1.2, default 100) — richer validation costs agents, and that budget is the control.

### B12.3 Checklists are repo artifacts, not prompt text

`orchestrating-long-tasks/checklists/<domain>.md`, one per validator type, each item carrying:

```
id            stable, citable in a finding (UI-TYPO-014)
rule          what must hold, stated so it can be checked
rationale     why — a validator that understands the why judges edge cases better
how-to-check  the concrete method: a command, a measurement, a visual inspection
severity      default classification when violated
sources       authoritative references for the standard
```

Aim for genuinely comprehensive — hundreds of items across the domains — because the checklist IS the
validator's competence. Compose them: a domain checklist plus an optional stack/language checklist, so the
system works for any language or toolchain rather than assuming this repo's stack.

Delivery: the checklist reaches the validator through its **role packet** (B8.1), so it is bound and
digest-verified, not re-typed into a prompt each run. This directly answers "validators don't get good
context" — the context stops depending on what the coordinator remembered to write.

### B12.4 Consulting external standards

A validator may read authoritative external sources for its domain — the host provides web access, and
this does not touch R9 (which forbids the HARNESS calling model-provider APIs, not an agent reading docs).

- `sources` in each checklist item cite the standard, so a finding can point at authority rather than
  taste.
- When a validator consults a source mid-run, it records what it read as `agent_reported` evidence.
- Never treat a fetched page as authority over the repo's own explicit convention; the repo wins, and a
  conflict is itself a finding worth raising.

### B12.5 Report shape

A validator report must state, separately: task-scope findings; adjacent standing-standard findings;
checklist items **checked and passed** (so coverage of the checklist is visible, not implied); items **not
applicable** and why; and items that **could not be checked**, with the reason. An unchecked item silently
omitted is the same failure mode as a fabricated pass.

### B12.6 Implementation note

Authoring the checklists is broad, parallel, independent work — one agent per domain, fanned out, each
producing its section against real sources. Run it as its own workflow when this item is picked up.

---

## B13 — SKILL.md is an index, not a manual `done (eaabd5c), verified`

**Closed 2026-08-20, per B36.5's finding and B37 finding 10.** Verified with `wc -l`/`wc -c` directly
rather than trusting this file's own prior "still `queued`" label: `orchestrating-long-tasks/SKILL.md`
is 149 lines / 12,706 bytes today, under the under-150-line target this item set, down from 604 lines
measured when the item was opened. `git log` on the file shows the drop to 134 lines happened in
`eaabd5c`, the same rewrite commit that closed B2 and B5. `tests/unit/contracts/skill-router.test.ts`
mechanically enforces the budget (`LINE_BUDGET = 150`), the routing table, the negative-routing
statement and the delegation-not-restatement rule going forward, so this cannot silently regress.

**Measured 2026-08-20: SKILL.md is 604 lines / 38,537 bytes (~10k tokens).** It grew from 395 during this
overhaul. Every agent in every run loads all of it before doing anything, and most of it is irrelevant to
whichever role that agent holds.

Worse, it duplicates content that already has an authoritative home: the CLI phases restate the generated
`references/cli-capabilities.md`; the role table restates `roles/*.md`; the dual-channel protocol restates
`agents/validator.yaml`. Duplicated docs drift — that is the defect class this overhaul spent five waves
removing, reproduced inside the entry-point document.

This also contradicts R8's own purpose. R8 exists so coordinators stop burning tokens reading skill
internals; a 38 KB entry point burns them before the coordinator reads a single line of anything else.

### The target

SKILL.md becomes a **router**: what this skill is, when to use it, the handful of genuinely global hard
rules, and then a routing table that says _which document to read for which job — and which not to_.

- Target **under 150 lines**. Ruthlessly.
- Every section that exists elsewhere is replaced by a pointer, never a summary. A summary is a second
  copy with a shorter half-life.
- The routing table is keyed by **role and by phase**, because that is how an agent arrives:
  "I am a validator about to review a UI task" → validator role contract + UI checklist + the two CLI
  commands involved. Nothing else.
- State explicitly what an agent should **NOT** read. Negative routing is as valuable as positive: an
  implementer has no reason to load the critic protocol, and saying so out loud prevents it.
- Content that moves out gets a real home; nothing is deleted without a destination.

### Alignment with the CLI

The routing table must stay true to the harness, so it cannot drift:

- Command references point at the generated `references/cli-capabilities.md` and `harness.ts help <cmd>`.
- A test asserts every document path named in SKILL.md exists, and every command named resolves in
  COMMAND_REGISTRY.
- Ideally the router is partly generated from the registry and the roles directory, so adding a role or a
  command updates the index automatically.

### Progressive disclosure as the general principle

Apply it to the whole corpus (`references/` 7 files, `docs/` ~27, `roles/` 9, `checklists/` from B12 —
7,900 lines today). An agent should load: the router, its own role contract, the checklist for its domain,
and the specific reference its current step needs. Nothing more. Measure the result: report the token cost
of a coordinator's, an implementer's and a validator's context before and after.

---

## B14 — Correction to how the R9 rule is stated `verified`

**Verified 2026-08-20 (completion-tagging pass):** `orchestrating-long-tasks/SKILL.md:30` reads "The
harness never thinks. It orchestrates and records — never a model call, never an LLM CLI" — the exact,
narrow single-prohibition framing this item asks for, read directly from the file.

**The rule has been described too broadly in SPEC.md §9, in docs, and in my own summaries.** Restate it
everywhere in the owner's terms:

**Allowed — explicitly and without qualification:** every tool the host application provides. Web access,
documentation lookup, browsers, package managers, MCP servers, file and shell tools. An agent completing a
task may use anything the host offers. B12.4's external-standards lookups are squarely allowed.

**The single prohibition:** the harness never calls a language model. No provider API key, no SDK, no
LLM CLI spawned as a subprocess. Reasoning happens inside the host application — Claude Code, Antigravity
CLI, Codex/ChatGPT — under the user's existing subscription, using that application's own agent mechanism.
The harness orchestrates and records; it never thinks, and it never pays for thinking.

### Why the harness exists — the framing to use in the docs

Worth stating in SKILL.md, because it explains every design decision downstream:

- It gives **observability over every step** an LLM takes, which is what makes the run auditable.
- It **raises code quality**, because each step is gated, evidenced and independently validated.
- It lets the model **spend its attention on the actual problem and the decisions**, not on bookkeeping
  and coordination. The CLI absorbs the bookkeeping.
- Agents call harness commands **the way code calls an API** — deterministic, recorded, replayable.
- **An agent should never need to read the whole skill** — only the slice its current job requires. That
  is B13, and it is a direct consequence of this framing rather than a separate nicety.

---

## B15 — Step-level action provenance: 100% visibility `queued`

**Reconciled 2026-08-21 — markdown-rendering slice of B15.1/B15.2 verified live and closed a real
completeness gap; B15.3/B15.4 unchanged and out of this slice's scope.** This pass owned only
`scripts/src/summary/markdown-*.ts` and `tests/unit/summary/markdown-*.test.ts` — the `summary.md`
rendering layer, not the producers that fill `graph.json` or gvui. Opened every file directly:
- `markdown-step-provenance.ts`'s `renderActionProvenance` (B15.1) and `markdown-file-provenance.ts`'s
  `fileProvenanceTable`/`fileProvenanceDetails` (B15.2) are both wired into `markdown-formatter.ts` —
  imported at lines 15 and 28, invoked at lines 58 and 66 — and both render the exact `GraphDataset`
  the run produced, not a second derivation of it. Confirmed by *running*, not reading, the tests: `bun
  test tests/unit/summary/markdown-step-provenance.test.ts tests/unit/summary/
  markdown-file-provenance.test.ts` — 15/15 pass (before this pass's own additions), and the three
  sibling-owned integration tests that exercise this end to end all still pass:
  `summary-markdown-provenance-wiring.test.ts` (1/1), `summary-file-provenance-wiring.test.ts` (2/2),
  `summary-markdown-run-report.test.ts`'s full-capsule fixture (23/23 across all three files together).
- **New finding, fixed in this pass:** `FileRef.statusCode`/`.sha256` are real harness-observed fields —
  populated for every branch-observed file by `graph-generator-branch-nodes.ts:44-45`
  (`statusCode: entry.status_code`, `sha256: entry.sha256`), and asserted present by
  `summary-graph-completeness-contract.test.ts`'s own "carries every changed file with the evidence
  class of the claim" test (still passing today) — but neither field ever reached `summary.md`;
  `fileProvenanceTable`/`fileProvenanceDetails` read neither one. Exactly this project's own signature
  defect: real data on one side, no renderer on the other. Fixed: `markdown-file-provenance.ts` now
  emits a "Git status"/"Content hash" pair for any file carrying a `statusCode` (a fact task-reported
  files never have, only branch observations do), rendering a `null` hash as an explicit "no content to
  hash" (the harness looked; there was nothing to hash) rather than `unknown` (the harness never
  looked) — B15's own "unknown-with-an-evidence-class, never a guess" rule applied to the one field
  that had been silently skipping it. Proven end to end within this slice by a new test in
  `markdown-formatter.test.ts` ("a node's file carries statusCode/sha256 from graph.json into the
  Files Changed detail block") that builds a real `GraphDataset` node and asserts the rendered
  Markdown carries both new lines — it fails if the call site is ever removed. Three further unit
  tests in `markdown-file-provenance.test.ts` cover the string/`null`/absent-field cases on the
  renderer directly. `bun test tests/unit/summary/markdown-file-provenance.test.ts tests/unit/summary/
  markdown-formatter.test.ts tests/unit/summary/markdown-formatter-populated.test.ts tests/unit/
  summary/markdown-formatter-topology.test.ts tests/unit/summary/markdown-step-provenance.test.ts` —
  47/47 pass. Re-ran the three integration tests above, unmodified, after the change — still 23/23
  pass, so nothing pinned to the file table's row shape broke. `bun run typecheck` — clean for every
  file this pass touched (one pre-existing, unrelated error remains in
  `workflow/plan-review/record-plan-review.ts`, outside this item and outside this pass's edits).
- **Observed, not this slice's to fix:** `summary-graph-completeness-contract.test.ts` is mid-repair by
  another wave (per the note below). Re-run fresh today it is 14 pass/3 fail — a different failure
  shape than the `beforeAll` throw recorded below (`beforeAll` now succeeds; the B15.2-named test
  itself now fails because `alpha.diff` is `undefined` at its line 212, and a separate, unrelated
  credential-leak assertion fails at line 165). Neither failure is in `markdown-*.ts`; both are in the
  producer/fixture layer this item does not own, so left untouched here.
- B15.3 (`toolInvocation`/`ToolInvocationRecord`) and B15.4's gvui consumer remain exactly as the note
  below describes — nothing to render in `markdown-*.ts` for a data shape (B15.3) that does not exist
  yet upstream, and gvui is a different repo/language entirely (B15.4).

Net for the markdown-rendering slice: B15.1 and B15.2 now render every field their upstream types
carry, including the one gap found and closed this pass. B15 as a whole stays `queued` — B15.3 is
unstarted and B15.4's gvui consumer is still dead code, both outside `markdown-*.ts`.

**Reconciled 2026-08-20 (fourth pass, same day) — B15.1/B15.2 re-confirmed live with corrected
citations; B15.2's cited test currently ERRORS for an unrelated reason; B15.4's gap is real and
broader than the note below states.** Opened every file cited below directly rather than trusting the
prior pass's line numbers, which had already drifted:
- `ActionStepRecord` at `graph-types.ts:97-107` still matches B15.1's field list exactly, but it carries
  **no doc comment** naming B15.1 — checked lines 80-97 directly, nothing there. `collectActionSteps` is
  called from `graph-run-facts.ts:274` (not `:316`) and reaches `RunFacts.steps` at line 299. `FileRef.step`
  lives at `graph-types.ts:119` (not `:160`, which is now mid-`Finding` interface) and also carries no
  doc comment tying it to B15.2 — both doc-comment claims in the note below do not hold up against the
  file on disk today; the underlying wiring they described is still real, the citations were not.
- `bun test tests/unit/summary/timeline-collector.test.ts` — **24 pass, 0 fail** (grown from 15, still
  100%), including both named tests quoted below, confirmed by name via `grep`.
- `tests/integration/summary-graph-completeness-contract.test.ts` — re-run fresh: **0 pass, 1 fail**,
  not 17/17. `beforeAll` throws before any of the 17 tests execute: `HarnessError: cannot pass
  task-alpha: no recorded falsifiable gate:prove proof for gate-alpha`, thrown from
  `assertGateProofFalsifiable` (`workflow/review/pass-preconditions.ts:141`), reached through
  `completeness-run-fixture.ts`'s `runAlpha`. This is a same-day regression from the HEAD commit
  (`6256159`, "make refusals prescriptive, evidence falsifiable, and runtime freshness observable"),
  which added the falsifiable-proof requirement to `task:review` but never updated the shared fixture
  to call `gate:prove` first. It is unrelated to B15's own code and reproduces identically in a second
  dependent file (`summary-topology-capsules.test.ts`, same stack trace). **Reported as a new,
  standalone defect below — not fixed here, not this item's fault, but it means B15.2's "attributes the
  file to the report's own rationale, requirements and submission step (B15.2)" test cannot currently be
  observed passing by anyone**, even though the code path it targets (`FileRef.rationale`/`.step`) is
  untouched and was passing before today's last commit.
- **B15.4's gap is bigger than "one dead component."** gvui's own test suite says so directly —
  `src/testing/currentSkillExport.test.tsx`'s comment: "nothing in gvui's ingest drops or breaks on
  `run`, but nothing in gvui's UI reads it either — see... 'RunFacts is unconsumed'" (test passes, 9/9,
  confirming `run.steps` round-trips through ingest untouched and unread). Beyond the previously-noted
  `StepScrubber.tsx` (still orphaned, still only self-referenced), there is a SECOND, more complete
  step-scrubbing component with the same problem: `engine/GraphCanvas/GraphPlaybackOverlay.tsx` (play/
  pause, prev/next, step highlighting, all wired to `useGraphStore`) is imported nowhere outside its own
  test file either — `GraphCanvas/index.tsx` renders neither overlay. The one step-filter UI that IS
  wired and reachable (`StepsDropdown.tsx`, via `CanvasToolbar` → `AppContent`) filters on
  `GraphNodeData.step`, which the generator still assigns as the old coarse per-task/wave number
  (`ctx.taskStep`, `ctx.gateStep`, `steps.criticStep` — grepped `graph-generator-*.ts` directly, no
  assignment from the new `ActionStepRecord` sequence anywhere). So today gvui has a reachable step
  filter, but it is not the B15.1 fine-grained one — the fine-grained data arrives in every export and
  is read by nothing.
- B15.3 re-confirmed absent: `toolInvocation`/`ToolInvocationRecord` still nowhere under
  `scripts/src/summary`, and `classifyActionKind` in `timeline-collector.ts` (the function that produces
  every `ActionStepRecord.kind`) has no branch that ever returns `"tool"` — the taxonomy has the slot,
  nothing populates it.

Net: B15.1 done and reachable, B15.2 done and reachable (its regression-guard test is temporarily
unable to run for a reason outside this item), B15.3 unstarted, B15.4 partially real (data model, one
unrelated coarse-grained filter UI) and partially unreached (the fine-grained trace has no consumer in
gvui at all). Stays `queued`.

**Superseded note, kept for the record — corrected above, do not treat as current:** the note below's
B15.1 claim was wrong the moment
it was written: `4d54ac0` ("feat: wire step provenance, lifecycle summaries, and supervisor recovery")
had already landed B15.1 hours before the "not found" note was added, and the note's own grep pattern
(`monotonic`) missed the real symbol names.** Opened `orchestrating-long-tasks/scripts/src/summary/
graph-types.ts` directly: `ActionStepRecord` (`step`, `timestamp`, `actor`, `kind`, `rawKind`, `target`,
`outcome`, `evidence_class`, `summary`) is exactly B15.1's own field list, and its doc comment names
B15.1 by number. `collectActionSteps` in `timeline-collector.ts` builds it from the event chain and is
called from `graph-run-facts.ts:316`, which attaches it as `RunFacts.steps` — `GraphDataset.run` is
typed `RunFacts`, so this reaches `graph.json`, not just an internal type. `bun test
tests/unit/summary/timeline-collector.test.ts` — 15/15 pass, including "every recorded action kind
reaches the trace, in the taxonomy B15.1 asks for" and "step is the chain's own monotonic sequence, not
a second counter" (named and asserted, not inferred from the test's title). B15.2 is also confirmed live
and load-bearing, not just present: `FileRef`'s doc comment at `graph-types.ts:160` ties its `step` field
to the same `RunFacts.steps` space, and `summary-graph-completeness-contract.test.ts`'s "attributes the file to
the report's own rationale, requirements and submission step (B15.2)" passes as part of that file's
17/17.

**New finding this pass, not previously recorded — B15.4's gvui half is unreachable.** gvui ships
`src/engine/GraphCanvas/StepScrubber.tsx` (148 lines, a real component reading `useGraphStore`'s
`selectedStep`/`setSelectedStep`), but `grep -rl StepScrubber src` inside gvui returns only the component's
own file — nothing imports it. This is exactly the "implemented subsystem with no call site" shape
B8.5/B9.2 exist to catch, reproduced inside this same item. B15.3 (per-invocation tool-call visibility,
distinct from the aggregate `node.tools` counts) was grepped for directly — the plausible names
toolInvocation and ToolInvocationRecord, deliberately not code-quoted here since neither exists — and
found nowhere in `scripts/src/summary`. Still absent. Item stays `queued`:
B15.1 and B15.2 are done and reachable; B15.3 is unstarted; B15.4's data model is real but its gvui
rendering half is dead code, which is arguably worse than "not built" because it invites trusting a
component that never runs.

**Superseded note, kept for the record — its B15.1 claim is corrected above, do not treat as current:**
B15.2 has a real producer now —
`scripts/src/summary/file-diff-reader.ts` populates `FileRef.lines`/`.diff`, which were previously
declared and never written. B15.1's monotonic per-run step counter over every recorded action was not
found under `scripts/src` (only an unrelated docstring use of the word "step"), so the two-view
requirement (whole interaction graph plus an ordered, filterable step sequence) is unconfirmed.

**Verified 2026-08-20: the skill does NOT record which lines changed, or why.** `FileRef.lines` and
`FileRef.diff` are declared in `summary/graph-types.ts` and populated by nothing. Step numbers are
per-task wave numbers, not per-action. The finest granularity available today is "this task touched these
file paths".

**Target: feature parity with the host's own workflow reporting, then past it.** The owner is replacing
Claude Code's built-in workflow management with this skill, so anything the built-in shows and this does
not is a regression at switchover.

### B15.1 Every action is a recorded step

A monotonic per-run step counter over ALL recorded actions, not just tasks. Step 134 is a fine thing to
see; the point is that nothing happens off the record.

An action is any of: a command executed, a file written, an agent granted or released, a lease taken or
returned, a packet published, a finding raised or resolved, a probe, a review, a branch opened or
collected, a gate attached, a plan revision. Each carries: step number, timestamp, actor, action kind,
target, outcome, and its `evidence_class`.

### B15.2 Line-level change tracking with a reason

For every file an agent touches, record: path, mode, **line ranges changed**, **the unified diff**,
additions and deletions — and **why**. The what is harness-observed from Git; the why is `agent_reported`,
supplied through the CLI at submit time and bound to the task's requirement id.

- Populate `FileRef.lines` and `FileRef.diff`. They are already in the contract; nothing reads them because
  nothing writes them.
- Add a rationale field. An agent explaining a change costs one flag; reconstructing intent later from a
  diff costs far more, and is often impossible.
- Attribute each change to the step that made it, so the graph can answer "what did step 134 do".
- Diff size: B3 says the export maximises completeness and size is not a constraint. Carry full diffs.

### B15.3 Tool-call and interaction visibility

The owner wants to see how work moves between participants: tool calls, hand-offs, feedback, mode changes.
Today `node.tools` records that a tool was used; it does not record individual invocations or their
results.

Record each tool invocation as a step where the host reports it, and represent participant-to-participant
traffic as edges carrying the exchange. Where the host does not report tool calls, say so — an unreported
tool call is `unknown`, never an inferred one.

### B15.4 Both views, from one dataset

- **The whole interaction graph at once** — the shape of the run, every participant and relationship.
- **The step sequence** — an ordered, replayable trace, filterable by actor, kind, file or step range.

Both come from the same `graph.json` (B3). gvui gets a step scrubber and a step-ordered inspector, and
selecting a step highlights the nodes and edges it touched.

---

## B16 — `/orchestrate` slash-command entry point `verified`

**Verified 2026-08-20 (completion-tagging pass):** confirmed via B37 finding 7's own resolution note,
which spawned the real `harness.ts orchestrate` entrypoint as a subprocess (not just calling
`execute()`) and passed for both a bare piped prompt with no flags and inline free text with no flags;
`bun test tests/unit/cli/orchestrate-command.test.ts tests/unit/cli/arguments.test.ts` — 33 pass, 0 fail.

One command that takes **the entire prompt as a single free-text blob** — no flags to learn, no structure
imposed on the user.

- Everything after the command name is the prompt, captured byte-for-byte as the immutable `prompt.md`.
- It then runs the full opening sequence itself: capture, `plan:enhance` (read the repo, produce the
  enhanced plan and to-do list), task staging, `plan:compile`, topology, and the first `queue:wave`
  dispatch.
- The user types a paragraph and gets a running orchestration. That is the whole interface.
- The skill definition must state this as the primary entry point, so a host agent reaches for it rather
  than assembling the sequence by hand and getting it subtly wrong.
- Must not collide with the host's own workflow management: when this skill is driving, it owns the
  orchestration, and the host's built-in workflow system stands down.

---

## B17 — Final audit gate before the overhaul is called done `queued`

**Re-confirmed 2026-08-20 (fourth pass, same day), and the gap is wider than the note below states.**
This item's own precondition — the overhaul being finished — still is not true: gvui's HEAD commit
(`045b380`, "render every validator domain as its own distinct node") landed at 23:31 tonight, minutes
before this pass started. Checked the actual staleness directly rather than only searching for output
files: `crates/gvui/target/debug` (the Rust build/test artifacts) has not been touched since 2026-08-15
18:35, and `find crates/gvui/src -name "*.rs" -newer crates/gvui/target/debug/.cargo-lock` returns 3
files — the Rust source has changed since the last time `cargo test` ran, so step 4 has not merely "not
run today," it predates the current engine source by five days. `src/engine/layout/custom/wasm_pkg` WAS
rebuilt at 23:11 tonight (an ordinary `build:wasm` compile, not a test), but that is still 20 minutes
before the latest renderer commit — nothing has even compiled against the current HEAD, let alone
audited it. No `bun run audit` report, no `bun run test:visual` capture output, and no cargo test
results exist anywhere on disk for the current tree. Still queued, correctly — this is a gate that runs
once, at the actual end, and the actual end has not arrived yet.

**Still queued 2026-08-20 (completion-tagging pass):** no evidence found that any of this item's 8
steps have been run since the overhaul began — no layout-audit output, no visual-regression run, no
Cargo test output, and no real end-to-end `/orchestrate` run through an actual dispatched host agent
(the closest thing on disk, B37 finding 11's fixture, was built by driving the CLI's `execute()`
directly from a script, not through a real agent dispatch). A large, not-yet-attempted gate.

The renderer gained new node roles, 19 edge kinds, generated accents for unknown members, branch sections
and section collapse. The layout engine was deliberately not modified — **that assumption must be proven,
not asserted.**

Run everything, and treat a regression against the pre-overhaul baseline as a blocker:

1. **The 280-run layout audit** (`bun run audit`) — the 8 zero-tolerance invariants: node overlaps, edge
   penetrations, badge collisions, collinear overlaps. New edge kinds mean new badge geometry and new
   marker sizes; this is exactly where a regression would hide.
2. **Edge routing and pathfinding** with the new kinds present — including back-edges (`probe`,
   `pushback`, `backtrack`) which are reversed by the engine's Eades FAS pass and un-reversed at emit.
3. **Visual regression** (`bun run test:visual`) across the full viewport matrix, with the render cache
   reset first so stale geometry cannot mask a regression.
4. **Cargo tests** for the Rust engine.
5. **Both full suites, typecheck, lint and format** in both repos.
6. **A real end-to-end run**: `/orchestrate` a small task, let it complete, export, import into gvui,
   render, and inspect. This is the only check that proves the whole chain works rather than its parts.
7. **Regenerate the shipped fixture** from that run, so gvui ships a dataset exercising validator nodes,
   branch sections, probe edges, scripts, tools and state transitions.
8. **Stability comparison against the pre-overhaul baseline** — layout metrics, render timings, quality
   gate counts. "As stable as before" is a measurement, not an impression.

---

## B19 — Generic category taxonomy, vendor names as instances `verified`

**Verified 2026-08-20 (B19/B20 reconciliation pass):** the prior note's "not confirmed present" was a
false negative from checking the wrong file — same failure mode already caught once this session for
B29/B15/B3. The three-layer pattern lives in `scripts/src/summary/graph-agent-types.ts`, which
`graph-types.ts` re-exports wholesale (`export type { ... NodeScript, NodeTelemetry, NodeTool } from
"./graph-agent-types.ts"`), so grepping `graph-types.ts` alone finds no `interface`, only the re-export
line. Opened the actual file:

- `NodeTool` — `name` (open instance), `category?: ToolCategory` (generic), `extras?:
Record<string, unknown>` (open bag), `evidence_class`. Exactly B19.1's three layers.
- `NodeScript` — same shape (`category`, `tool`, `extras`, `evidence_class`, plus a per-field
  `evidence` map), with a doc comment stating the category/tool/extras are "never anything read out
  of the argv."
- `BrowserTestRun` — `category`, `runner` (the open instance — Playwright/Puppeteer/Cypress/etc. are
  values here, never a type name), `extras`, per-field `evidence`. B19.2's example is fully landed,
  not merely "moving the right way."
- `NodeTelemetry` — `provider`, `model`, `modelTier`, `thinkingLevel`, `contextWindow`, `tokensIn`,
  `tokensOut` all `Evidenced<T>`; `tokenExtras` an open `Record<string, Evidenced<number>>`. The doc
  comment on `model` states it verbatim: "exactly as the host reported it: never parsed, never
  matched against." Confirmed no substring/`.includes()`/`.toLowerCase()` handling of a model string
  exists anywhere in `scripts/src` (grepped for `.includes("claude`/`"opus`/`"sonnet`/etc — zero
  hits), and `tests/unit/summary/graph-telemetry-honesty.test.ts` carries a named regression test for
  exactly this failure mode ("a model name never becomes a tier, however large the model sounds").
- `contracts/taxonomy.ts`'s `TOOL_CATEGORIES` matches B19.2's seed vocabulary verbatim (14 members,
  `browser-automation` through `version-control`), with an open `ToolCategory = KnownToolCategory |
(string & {})` so an unrecognised category is still valid — B19.2's "start the vocabulary and keep
  it open" is implemented literally, not approximately.
- B19.4's guard reconfirmed still shipped and passing (`health/vendor-identifiers.ts` +
  `health/vendor-names.ts`, 0 failures on the "Vendor names in identifier positions" health check).

**The KNOWN FABRICATION named in this pass's brief — the fixture build script labelling flag-supplied
`--model`/`--provider` as `host_reported` — is already fixed, not still true.** Read
.tmp/fixture-build/build-fixture.ts (gitignored per B37's own note, which cites the same script with a
line count and range — see B37 above rather than repeating an unqualified citation here, which would
duplicate the exact false intent-drift positive B39/B40 already diagnosed and fixed this same way): it
only ever passes
raw CLI flags; it stamps no evidence class itself. The stamping happens in
`workflow/agents/grants.ts`'s `telemetryFields()`/`explicitLevel()`, and both tag every CLI-supplied
value `agent_reported` (an explicit `"unknown"` keeps the `unknown` class instead). The function carries
a doc comment naming this exact defect as already fixed: "Stamping these `host_reported`
unconditionally was B39 finding 1: a caller could type a nonexistent model id and have it recorded as
though the host had attested to it." A dedicated regression suite,
`tests/integration/agents-telemetry-evidence-honesty.test.ts` ("B39 finding 1: a typed CLI value never earns a
host-verified evidence class"), asserts `agent:register`'s and `agent:report`'s CLI-typed telemetry
always lands `agent_reported`, and explicitly forbids `host_reported`/`harness_observed` on that path.
Nothing left to fix here; the fixture we ship as ground truth is honest.

**Owner principle:** "standardize things as much as possible while supporting as much flexibility as
possible." A vendor or product name must never be a first-class concept in the schema; it is a VALUE
inside a generic category.

`PlaywrightMetadata` was the symptom: a type named after one tool, holding fields that are true of any
browser-automation runner. Puppeteer, Cypress, WebdriverIO and Selenium produce the same shape.

### B19.1 The pattern, applied everywhere

Three layers, every time:

1. **Category** — a generic, slowly-changing vocabulary describing WHAT KIND of thing it is.
2. **Instance** — an open string naming the specific tool/model/provider. Any value, including one the
   schema has never seen (B7, B10).
3. **Extras** — an open bag for fields that genuinely do not generalize.

```
category: "browser-automation"     generic
tool:     "playwright"             instance, open
viewport / browser / duration      generic fields true of the whole category
extras:   { traceFormat: "zip" }   tool-specific, ignored by anything that does not know it
```

### B19.2 Tool categories

Start the vocabulary and keep it open: `browser-automation`, `test-runner`, `type-checker`, `linter`,
`formatter`, `package-manager`, `version-control`, `build`, `search`, `file-edit`, `shell`,
`documentation`, `http-client`, `database`. An unrecognised category renders like any unknown vocabulary
member (B7) rather than being dropped.

Applies to `NodeTool`, `NodeScript` and the browser-run shape landing this wave — that one is already
moving the right way (`BrowserTestRun` with a `runner` field); finish the job by giving it a `category` and
an `extras` bag rather than a bespoke type.

### B19.3 Model and token telemetry

Same three layers, and this matters because the owner runs Claude Code, Antigravity, Cursor and Codex:

- **Generic:** `provider`, `model`, `tier`, `thinking_level`, `tokens_in`, `tokens_out`, `context_window`.
  Every value keeps its `evidence_class`; anything the host did not report stays absent.
- **Instance:** the model string exactly as the host reported it. Never parsed, never normalised, never
  matched by substring to infer anything (that defect has been removed three times already).
- **Extras:** provider-specific counters — cache-read tokens, reasoning tokens, tool tokens — recorded
  under their reported names in an open bag, so a host reporting something unusual loses nothing.

### B19.4 The rule to enforce

**No vendor or product name may appear as a type name, field name, enum member, or hardcoded constant in
either repo.** Vendor names appear only as recorded VALUES. Add a test that greps both source trees for a
list of known vendor/tool names in identifier positions and fails. This is mechanically checkable, and it
is what stops the schema quietly re-acquiring a favourite tool.

---

## B20 — Dynamic host discovery and per-agent telemetry ingestion `queued`

**Re-confirmed 2026-08-21 (B32/B20 ownership pass) — B20.1-20.3 re-verified against current
`summary/host-telemetry.ts` and `workflow/agents/**` by direct read, and against a real, on-disk run
(see B32.2's fresh note above; same evidence answers both items since B32 and B20 live in the same
files). Nothing here required a code change.**

- **B20.1 (data-driven discovery, not a hardcoded vendor list):** `HOST_PROBES` and `TELEMETRY_PROBES`
  in `summary/host-telemetry.ts` key entirely on vendor-name string values (`"antigravity"`,
  `"claude-code"`, `"codex"`, `"cursor"`), never a TypeScript union or enum — confirmed by reading the
  file directly, not by re-trusting the prior note.
- **B20.2 (per-agent self-report is the authority; disagreement recorded, not silently resolved):**
  unchanged and re-verified — `telemetry-merge.ts`'s `mergeDerivedField`/`mergeObservedCount` never
  overwrite an explicit value that disagrees with a probed one; they push a `TelemetryFieldConflict`
  instead, surfaced on both the transaction event and the CLI response. Exercised for real this pass
  (not just by the existing test suite): the real proof run in B32.2's note registered a live agent with
  transcript data already present, and every field landed with its correct evidence class, no field
  silently overwritten.
- **B20.3 (accounting convention recorded, not just the number):** unchanged — `token_extras` keeps
  provider-named counters (`cache_creation_input_tokens`, `cache_read_input_tokens`, the two
  `cache_creation_ephemeral_*` keys) verbatim under their host-reported names rather than collapsing
  them into one number. The real run in B32.2's note produced exactly these four extras keys straight
  from a live transcript, not a synthetic fixture.
- **B20.4 — investigated again, confirmed still genuinely out of this pass's reach, not reflexively
  re-flagged.** `grep -rn "validatorQuality\|probe-answer-rate\|withdrawn\|overturn" scripts/src/summary/
  scripts/src/workflow/review/` — zero hits, matching every prior pass. This item's own file grant this
  pass (`summary/host-telemetry*.ts`, `workflow/agents/**`) still does not include
  `summary/metrics-collector.ts` or `workflow/review/**`, which is where a per-validator quality metric
  would have to live, and the underlying data-model question (what recorded signal should "withdrawn"
  or "overturned" map to?) is still unanswered anywhere in the codebase. Left `queued`, unchanged, for
  whoever owns that file pair plus an owner decision on the data model — not attempted here to avoid
  the exact fabricated-proxy failure mode this sub-item's own text warns against.
- **On this pass's own briefing about "three install roots" (`~/.agents/skills`,
  `~/.gemini/config/skills`, `~/.claude/skills`) and two of them shipping docs with no scripts:**
  checked directly (`ls`/`find` against all three on this machine) and confirmed true, but this is
  QUEUE.md's R10 ("Runtime freshness must cover every install root") — a different, already-tracked
  item about the harness's OWN installed-copy staleness, not about B20's subject (discovering which
  AGENT HOST applications — Claude Code, Codex, Antigravity, Cursor — are installed). `host-telemetry.ts`
  already reads its per-host config through an array of candidate `configPaths` per probe, not a single
  hardcoded path, so B20.1's own "not assuming a single root" concern already holds for agent-host
  discovery specifically. Noted here so a future pass does not conflate the two; no B20 code changed on
  account of it.

**Re-confirmed 2026-08-20 (fourth pass, same day) — the note below still holds; one citation had
already moved.** Re-ran every check in the note rather than trusting it: `probeAgentTelemetry` call
sites are real but at slightly different lines now (`agent-ops.ts:90,142`, not `:92,148`;
`task-claim.ts` imports it at line 34 and defines `probeAtTaskBoundary` at line 102, calling it at
`:173` for `task:claim` and `:311` for `task:submit`). The cited test file has moved entirely —
tests/unit/agents/host-telemetry-probe.test.ts no longer exists; the same suite now lives at
`tests/integration/agents-host-telemetry-probe.test.ts` (moved by the same test-lane-split commit,
`5869023`, that relocated several other files this pass also had to chase down). Both named checks the
note cites are still there and still pass: `grep` confirms `describe("the probe wired into the CLI
boundaries themselves, never a separate command"` and `test("a flag and the host's own config
disagreeing is kept on both the event and the result"`, and `bun test
tests/integration/agents-host-telemetry-probe.test.ts` — **13 pass, 0 fail**. `host-telemetry.ts`'s
codex probe still reads `agentsTable.max_concurrent_threads_per_session` into `concurrency_ceiling` and
`featuresTable.multi_agent` into `multi_agent_enabled`, confirmed by opening the file directly.
`"host_reported"` still appears only in `contracts/evidence.ts`'s type/list declarations — zero
production call sites stamp it, matching the note's documented deviation. B20.4 re-confirmed still
open: `grep -rn "validatorQuality\|probe-answer-rate" scripts/src/summary/` — zero hits;
`metrics-collector.ts` still computes exactly three run-wide rollups
(`pushbacks_total`/`resolved_findings_total`/`open_findings_total`) and nothing per-agent or
per-validator; `contracts/workflow.ts`'s `Finding.status` is still exactly `"open" | "resolved"`, and
`workflow/review/` still has no `withdrawn`/`overturn`/`invalidat` hits. Nothing has changed here since
the note below was written; it stays accurate on the merits, only its file:line pointers needed fixing.

**Still queued 2026-08-20 (B19/B20 reconciliation pass) — B20.1-20.3 upgraded from "substantially
landed" to fully verified; B20.4 is the one real gap and stays open, narrowed and re-scoped below.**

B20.1-20.3, opened directly rather than re-derived from the prior note:

- **Hardcoded at all four boundaries, not just register.** `cli/host-telemetry-probe.ts`'s
  `probeAgentTelemetry` is called from `agent:register` and `agent:release`
  (`cli/commands/agent-ops.ts:92,148`) and from `task:claim` and `task:submit`
  (`cli/commands/task-claim.ts:36`, shared helper `probeAtTaskBoundary`) — the item's own brief asked
  for register/submit/release; claim is a fourth call site beyond what was asked, not a gap.
  `tests/integration/agents-host-telemetry-probe.test.ts` has a describe block named exactly for this:
  `"the probe wired into the CLI boundaries themselves, never a separate command"`, and drives real
  CLI calls through `execute()`, so this is reachable by B33's bar, not merely present in source.
- **Both sources recorded, disagreement flagged, nothing silently preferred.** `agent:register`'s own
  CLI flags are `agent_reported`; `probeAgentTelemetry` separately reads the host's config
  (`derived`) and the agent's own transcript (`harness_observed`, B34). `telemetry-merge.ts`'s
  `mergeDerivedField`/`mergeObservedCount` never overwrite an explicit value that disagrees — they
  push a `TelemetryFieldConflict` (`recorded_value`, `recorded_evidence_class`, `probed_value`) instead,
  which lands on both the transaction event (`telemetry_conflicts`) and the CLI's own response
  (`host_telemetry_conflicts`), asserted by `agents-host-telemetry-probe.test.ts`'s `"a flag and the host's
own config disagreeing is kept on both the event and the result"`.
- **Codex's `~/.codex/config.toml` is covered, both keys named in this pass's brief.**
  `summary/host-telemetry.ts`'s `HOST_PROBES` lists `agents`/`features`/`model` as codex evidence
  keys, and `TELEMETRY_PROBES.codex` reads `agentsTable.max_concurrent_threads_per_session` into
  `capabilities.concurrency_ceiling` and `featuresTable.multi_agent` into
  `capabilities.multi_agent_enabled` by name — exactly the two fields this pass was asked to check.
- **One documented, reasoned deviation from B20.2's literal wording, not a defect:** B20.2 as written
  says host-supplied values earn `host_reported`; the shipped code never stamps `host_reported` on
  anything (grepped: the class exists in `EvidenceClass` but no production call site uses it). A
  config file being present is evidence the tool is installed/configured, not proof of what a specific
  agent actually did, so `mergeDerivedField`'s default is `derived`, and only a transcript reading —
  the host's own record of what actually happened — earns `harness_observed`. This reasoning is
  documented at the call sites (`telemetry-merge.ts`'s doc comments, B34) and is stricter than the
  letter of B20.2, not looser; noting it here so a future pass does not read `host_reported`'s absence
  as an unfinished feature.
- **KNOWN FABRICATION named in this pass's brief — already fixed.** See B19's entry above: flag-typed
  `--model`/`--provider` land `agent_reported`, guarded by a named regression suite (B39 finding 1).

**B20.4 — genuinely missing, and re-scoped rather than just re-flagged.** Grepped
`scripts/src/summary/` for validatorQuality/upheld/withdrawn/probe-answer-rate: nothing — these name
what does not exist yet, not a symbol this item is claiming to have built, so left unbackticked rather
than repeating the exact false intent-drift positive B39/B40 already diagnosed and fixed this same way.
`metrics-collector.ts` computes run-wide rollups only (`pushbacks_total`, `resolved_findings_total`,
`open_findings_total`) — never per-agent, never per-validator. Two things block a same-file fix:

1. **Ownership**: the natural home is `summary/metrics-collector.ts` (or a new, not-yet-created
   summary/validator-quality.ts), not this item's file grant
   (`contracts/agents.ts`, `workflow/agents/**`, `cli/host-telemetry-probe.ts`,
   `summary/host-telemetry.ts`). Writing it there risked colliding with concurrent work already
   observed touching `metrics-collector-helpers.ts`-adjacent files this pass.
2. **The data model has no "withdrawn."** `contracts/workflow.ts`'s `Finding.status` is
   `"open" | "resolved"` — grepped the whole producer tree for `withdrawn`/`overturn`/`invalidat`:
   zero hits tied to findings. "Probe demands answered vs unanswered" is honestly computable today
   (`class: "probe_demand"` + `status`), but "findings later confirmed vs withdrawn" as literally
   named is not, because nothing in the review pipeline (`workflow/review/**`) ever records that a
   validator's defect turned out to be wrong — only that it was resolved (implementer answered it) or
   stayed open. Computing a "withdrawn" bucket today would mean inventing a proxy (e.g. "still open
   when the task closed") and presenting it as the thing the owner asked for, which is exactly the
   fabricated-evidence failure mode B20.4's own closing paragraph warns against. This needs an owner
   decision on what recorded signal "withdrawn" should map to (a later validator round disagreeing? a
   completeness-critic override? new instrumentation at reject/pass time?) before it is code, plus
   file ownership over the review pipeline and `summary/`. Left as `queued`, scoped down to exactly
   this, so the next pass does not have to re-derive that 20.1-20.3 are done.

**Goal:** the harness learns what each agent actually is — host application, model, thinking tier, token
counts and how that host counts tokens — by reading what the host itself publishes locally, rather than
guessing or hardcoding.

This replaces the old `detectHostTelemetry`, which probed one config file on the exporting machine and
stamped the same model onto every node in the run. The idea was right; the implementation attributed one
machine's config to every agent.

### B20.1 Discover hosts from the filesystem, dynamically

Probe the user's home directory for the agent applications actually installed — Claude Code, Gemini /
Antigravity, Codex, Cursor, and whatever else exists, including tools not known when this is written.

- Discovery is **data-driven, not a hardcoded vendor list**: a small registry of probe descriptors
  (where to look, what shape to expect, how to read it), extensible without touching code, and per B19 the
  vendor name is a VALUE in that registry, never a type or a constant in the source.
- Report what was found and what was not. An application that is not installed is absent, not a default.
- Never treat the exporting machine's config as authority over a specific agent's identity: machine-level
  discovery establishes what COULD be running, per-agent reporting establishes what DID run.

### B20.2 Per-agent self-reporting is the authority

An agent knows things about itself the filesystem cannot: which model answered, what thinking level was
in effect, how many tokens its turn consumed. It reports them through `agent:register` / `agent:report`
(the ledger already exists).

- Host-supplied values are `host_reported`. Machine-discovered values are `derived`. Absent stays absent.
- Where the two disagree, record BOTH and flag the conflict rather than silently preferring one.

### B20.3 Token accounting differs per host — record the convention, not just the number

Hosts count differently: cache reads, cache writes, reasoning/thinking tokens, tool tokens and system
overhead are counted, discounted or omitted inconsistently between applications and between models.

A bare number is not comparable across hosts, which defeats the purpose. So record, alongside the counts,
the **accounting convention** the host declared, and per B19 keep provider-specific counters in an open
extras bag under their reported names. A consumer can then compare like with like, or refuse to.

### B20.4 Why this matters (the owner's actual objective)

The owner intends to train and evaluate **self-hosted open-source models** for specific tasks — a model
strong at one language and weak elsewhere — and to feed real run data back into improving both the models
and the harness. That requires answering, per run and per agent:

- which agent did what, on which model, at which thinking level;
- how many tokens it consumed, counted by which convention;
- which tools it called;
- how many pushbacks it caused or received;
- **whether its validators were actually any good** — did they find real defects, did they probe
  meaningfully, were their findings upheld or overturned.

That last one is the interesting metric and nothing measures it today. Validator quality is derivable from
data the harness already holds: probe demands answered vs unanswered, findings later confirmed vs
withdrawn, defects that escaped to the completeness critic or to a later wave. Compute and expose it.

**Design consequence:** telemetry is not a reporting nicety here, it is training-signal collection. Missing
or fabricated values corrupt the feedback loop, which is why the honesty rules matter more in this
subsystem than anywhere else in the system.

---

## B21 — Mandatory lifecycle summaries: nothing happens unobserved `queued`

**Corrected 2026-08-20 (reconciliation pass) — the note directly below is stale on two counts, checked
directly rather than trusted.** First, its citation: `grep -rn "B21" orchestrating-long-tasks/scripts/src`
now returns nothing — `open.ts`, `collect.ts` and `sub-tasks.ts` no longer carry `// B21:` comments (they
still `requireText` a summary/reason, the comments were just dropped in a later edit), so that pointer is
stale. Second, and more substantively, its claim: `grep -rn "B21" tests/` turns up real enforcement the
note missed entirely — `validate-report.ts:29` (`requireText(report.summary, "report.summary")`) is what
`submitTask` calls, proven directly by `tests/unit/workflow/submissions.test.ts:65`
("B21.2: refuses submission with no summary..."); `agent:release` refuses a blank `--reason`
(`tests/integration/agents-grant-lifecycle.test.ts:263`, "B21: agent:release refuses without a reason");
and the completion review itself now refuses without a summary before touching the store
(`record-completion-review.ts:55`, `tests/unit/workflow/completion-review-summary.test.ts`). So the
note's specific claim — "no equivalent requirement was found at task:submit or agent:release" — does not
hold against current code.

Stays `queued` regardless, on a gap the above does not touch: B21.2's third bullet, "the completeness
critic checks the chain is unbroken end to end: every recorded transition has its summary, every summary
has its transition," has no implementation anywhere. Read `begin-completeness-critic.ts` and
`record-completion-review.ts` in full — both check that the critic's *own* summary is present, neither
walks the run's other transitions to confirm each one it made carries one. `agent:release` also only
enforces a bare `--reason` string, not B21.1's fuller structured-summary contents (what changed, what was
verified, what remains open, telemetry) the way `task:submit`'s `report` object does — a real, narrower
gap than the old note described, worth naming precisely rather than folding back into "not done."

**Updated 2026-08-21 — B21.2's third bullet is now implemented and wired.**
`workflow/completion/transition-summary-issues.ts` (new) exports `transitionSummaryIssues(state)`,
which walks every recorded transition this item names and checks both directions — the transition
has its summary, and no summary exists without its transition: a branch `collected`/`abandoned`
with no `outcome_summary`, a sub-task `submitted` with no `summary` (and the reverse: either field
present without the matching status), an agent grant `released` with no `release_reason` (and the
reverse), a task submission report with no `summary`, and a repair hand-off to a *different* agent
(`repair_assignee !== original_implementer`) with a `replacement_reason` but no
`replacement_evidence`. It is wired into `completionReadinessIssues`
(`workflow/completion/readiness-issues.ts:123`) — the exact gate `beginCompletenessCritic` already
refuses the critic assignment on when non-empty — so a broken chain now blocks completion before a
critic can even start, not just at the critic's own review. Proven, not asserted: 16 direct-unit
cases in `tests/unit/workflow/completion/transition-summary-issues.test.ts` plus a wiring test in
`tests/unit/workflow/completion/readiness-issues.test.ts` ("refuses completion readiness when a
collected branch has no recorded outcome summary") that was hand-verified to fail when the
`readiness-issues.ts` call site is commented out, then passes again once restored. `bun run
typecheck` and both files' own test runs are clean (117 pass, 0 fail across
`tests/unit/workflow/completion/`).

Stays `queued` regardless — this closes one specific bullet, not the item. Three gaps remain,
untouched by this pass on purpose (each sits outside `workflow/completion/**`, this pass's owned
surface): (1) B21.1's "terminates" transition has no reachable CLI command at all —
`abandonAttempt` (`workflow/lease/abandon.ts`) is the only writer of a terminate-with-reason record
and nothing calls it (tracked separately as coordinator-conformance QUEUE-16, not this item); (2)
`agent:release` (`workflow/agents/grants.ts`) still only enforces a bare `--reason` string, not
B21.1's fuller structured-summary contents (what changed, what was verified, what remains open,
telemetry) the way `task:submit`'s `report` object does; (3) B21.3 ("summaries... carried into
`graph.json`... and rendered in... `summary.md`") was not re-verified this pass for whether these
five specific summary fields (branch outcome, sub-task summary, release reason, replacement
evidence) actually reach the rendered graph and report, only that the completeness gate now checks
their presence in the workflow state itself.

**Previously (completion-tagging pass), now corrected above:** enforcement is confirmed only at the branch
lifecycle — `workflow/branch/open.ts`, `collect.ts` and `sub-tasks.ts` all carry explicit `// B21:`
comments requiring a summary at that transition. No equivalent requirement was found at `task:submit`
or `agent:release`, so "nothing happens unobserved" does not yet hold end to end across every
transition this item lists.

**Owner requirement:** "there should always be a hook run automatically, or the agent should submit its
summary report... we get 100% visibility on every action our orchestration system and agents are taking.
We should not miss anything."

### B21.1 Summary is required at every transition

An agent must submit a structured summary when it: completes a task, hands off to another agent, opens or
collects a branch, terminates, or is closed. The transitions already exist as CLI calls — attach the
requirement to them so it cannot be skipped.

Contents: what was attempted, what changed (with the line-level detail from B15), what was verified and
how, what remains open, what it could not determine, and its own telemetry (B20). Where a value is
unknown, it says unknown — an omission and an unknown are different claims.

### B21.2 Enforcement, not convention

- The harness **refuses the transition** when the summary is missing. A soft request produces soft
  compliance, and this system has already demonstrated that agents skip what is merely asked for.
- **The next agent in the chain verifies the previous one's summary exists** before it begins, and reports
  its absence as a finding rather than working around it. A validator inheriting an unsummarised
  submission is inheriting an unobserved step.
- The completeness critic checks the chain is unbroken end to end: every recorded transition has its
  summary, every summary has its transition.

### B21.3 Where it lands

Summaries are steps (B15.1), carried into `graph.json` (B3) and rendered in the sequential `summary.md`
(B6). A run should be reconstructible from its summaries alone, without reading the diff — that is the
test of whether visibility is genuinely 100%.

---

## B22 — Worktree-isolated git management (supersedes B18.2) `queued`

**Corrected 2026-08-20 (reconciliation pass) — the note below ("not started... none exist") is
flatly wrong against current disk state; re-grepping the exact terms it names finds the opposite.**
`grep -rln worktree orchestrating-long-tasks/scripts/src` returns 25 files, not zero: a full
`workflow/worktree/` module (`provision.ts`, `assign.ts`, `commit.ts`, `consolidate.ts`, `reclaim.ts`,
`ledger.ts`, `git.ts`, `git-ops.ts`), a `contracts/worktree.ts`, a `cli/commands/worktree-ops.ts` (the
reclaim command, B22.6), and live call sites in `plan-compile.ts` (provisioning, B22.1),
`task-claim.ts` (commit-per-subphase, B22.3) and `run-ops.ts` (consolidation, B22.4). `harness-config.ts`
declares every B22.7 field (`worktree_isolation`, `worktree_root`, `branch_prefix`,
`commit_per_subphase`, `max_commit_lines: 500`, `rebase_on_complete`). `run:status` returns a
`worktrees` block from `readWorktreeLedger(state)` when a ledger exists (B22.6). None of this existed
when the note below was written — this is real, substantial, later work, not a stale citation.

Confirmed reachable, not just present: `bun test tests/unit/workflow/worktree tests/unit/contracts/worktree.test.ts tests/unit/cli/worktree-ops.test.ts` plus the five passing `tests/integration/workflow-worktree-*` files together run 103 tests, 0 fail.

**Re-verified 2026-08-21 (worktree-module pass, scope: `workflow/worktree/**` and its unit tests only).**
Re-read every file in `workflow/worktree/` end to end against this item's text, then grepped every export
against the rest of `scripts/src` to check the wiring claim directly rather than trust the prior note:
`assignWorktrees`, `provisionWorktrees`, `commitSubphase`/`recordWorktreeCommit`,
`consolidateWorktrees`/`recordConsolidation`, `reclaimOrphanedWorktrees`/`recordReclaim`, and
`readWorktreeLedger`/`findAssignedWorktree` each have a real production call site outside the module
(`plan-compile.ts`, `task-claim.ts`, `run-ops.ts`, `worktree-ops.ts`) — none of this project's signature
"built and never called" defect is present here. `bun test tests/unit/workflow/worktree
tests/unit/contracts/worktree.test.ts tests/unit/cli/worktree-ops.test.ts` and `tsc --noEmit` both clean
before any change was made.

One genuine bug found and fixed in-place (`provision.ts`, in scope): the "nothing changed, skip the
re-persist" fast path compared `existing.assignments` (read back through the canonical, key-sorted JSON
store) against a freshly built array via raw `JSON.stringify`, which mismatches on key order alone for
any run with a persisted ledger — the fast path was therefore dead on every second `plan:compile` call
against the same run, silently re-writing an equivalent `worktrees-provisioned` transaction every time.
Replaced the stringify comparison with a field-by-field `assignmentsEqual` helper; the previously-dead
path is now reachable and covered by a new test (`skips re-persisting and issues no git worktree calls
when every task already has a slot`, asserting the event count is unchanged) alongside a sibling test
proving the "something really changed" branch still re-persists
(`re-persists when the topology widens...`). 87 unit tests pass, 0 fail; `tsc --noEmit` clean.

Also checked and left alone (in scope, not a defect): `commitSubphase`'s `over_limit`/`warning`
computation in `commit.ts` is correct and already exercised by name against B22.3's own 500-line
default. Everything else in the module — glob/directory pathspec conversion, merge/rebase conflict
handling and abort, reclaim's exists-on-disk check, the ledger's most-recent-assignment lookup — was
re-read and matches its own tests; nothing rewritten there.

Re-ran the two integration failures this item's own text cites, without editing `tests/integration/**`
(out of this pass's ownership; ledger reads only): `tests/integration/workflow-worktree-provision.test.ts`
now passes in full (5/5) — fixed by whichever sibling pass most recently repaired the integration lane.
`tests/integration/workflow-worktree-run-complete-consolidation.test.ts` still fails its one test on the
same cited cause, unchanged: `sealSingleTaskRun`'s helper never calls `gate:prove`, so
`assertGateProofFalsifiable` refuses the review. Gap #2 below is corrected from "2 fail" to "1 fail,"
otherwise unresolved and still not this pass's to fix.

Gaps #1 and #3 below are unchanged and, on this seat's own file ownership
(`workflow/worktree/**` and its unit tests only), **not fixable from here**: #1 lives in
`config/harness-config.ts` (outside `workflow/worktree/`), and #3 lives in `workflow/completion/`
(also outside `workflow/worktree/`). Re-grepped `workflow/completion/` again this pass for "commit
hygiene", "oversized commit", "max_commit_lines" — still no hits, confirming #3 is still real. Building
either fix here, unwired into a caller I do not own, would repeat the exact defect this pass is supposed
to guard against, so both stay open for whichever seat owns those directories.

Three real gaps keep it `queued` regardless — this is not a rubber-stamp to `verified`:

1. **Shipped off.** `DEFAULT_CONFIG.worktree_isolation = false` in `harness-config.ts:59`, against this
   item's explicit "default on." The code's own comment at line 24-34 says why honestly: flipping the
   default touches every existing capsule/test and "cannot be verified from this seat... out of scope for
   this pass." The feature exists; the item's own stated default does not hold yet.
2. **Two of the feature's own integration tests fail right now, discovered this pass, not previously
   known:** `bun test tests/integration/workflow-worktree-run-complete-consolidation.test.ts
   tests/integration/workflow-worktree-provision.test.ts` → **4 pass, 2 fail.** Both failures are the
   worktree fixtures colliding with unrelated, later-landed same-day work: the consolidation test now hits
   `"no recorded falsifiable gate:prove proof for gate-t1"` (from commit `6256159`, "feat: make refusals
   prescriptive, evidence falsifiable, and runtime freshness observable") and the provision test now hits
   `"task t3 has no prompt line to bind to... pass --requirement-lines"` (from commit `4fc4a2e`, "fix:
   refuse to fold unbound tasks into shared requirements") — the worktree fixtures were never updated for
   either newer, stricter precondition. Neither failure is in the stated "3905 unit tests, 0 fail" baseline:
   that count is `tests/unit` only (`package.json`'s `test`/`test:unit` script); these two live under
   `tests/integration`, run by the separate `test:integration` script. Reported as a new item below —
   left unfixed per this pass's own instructions (no source/test edits).
3. **B22.5 (commit hygiene verified by the completeness critic) has no implementation.** Grepped
   `workflow/completion/` for "commit hygiene", "oversized commit", "max_commit_lines" — no hits. The
   critic checks nothing about commit count, message quality, or size against `max_commit_lines`.

**Previously (completion-tagging pass), now corrected above:** not started. Grepped `scripts/src` for
`worktree_isolation`, `harness/<run-id>`, `git worktree add` and `worktree_root` — none exist. The only
"worktree" hits anywhere in the tree are the ordinary git working-tree concept in `git-ignore.ts` and
`contracts/branch.ts`'s doc comments, unrelated to this item's provisioning/rebase/cleanup design.

**Owner decision.** The harness DOES manage git — but never in the user's working tree and never on their
branch. It provisions its own isolated worktrees on a dedicated branch, commits there as work completes,
tidies up after itself, and hands back a clean branch the user chooses what to do with.

This resolves the objection in B18.2: the harness imposes no VCS policy on the repository the user is
sitting in, because it never touches it. It also removes the obstacle recorded in B18.1 — with each agent
in its own worktree, a pre-commit gate runs against that agent's tree alone, so another agent's
half-written file cannot fail it.

### B22.1 Provisioning

- At `plan:compile`, once the plan and topology exist, the harness creates a feature branch off the
  current HEAD — `harness/<run-id>` — and one or more git worktrees for it.
- Worktrees live OUTSIDE the user's working directory, under a configurable root (default: a sibling
  directory keyed by run id). They must never appear inside the repo the user is working in.
- **The user's working tree and branch are never touched.** They keep working while the run proceeds; the
  main conversation thread is not blocked and neither is the repo.

### B22.2 Worktree assignment follows the topology

The scheduler already computes conflict-free waves from disjoint write scopes — reuse that:

- Tasks whose write scopes do not collide MAY share one worktree.
- Colliding tasks get separate worktrees.
- This is the same invariant that authorises parallel execution, so no new analysis is needed.
- Record the assignment (which task ran in which worktree) — it belongs in the run's provenance.

### B22.3 Commit as sub-phases complete

- A commit per completed sub-phase, with a message that says what was actually completed — not
  "wip" and not one commit per file.
- Conventional Commits, subject under 70 chars, imperative. Never any AI or tool attribution.
- **The commit sha is recorded on the task record and emitted onto the graph node**, so a node in gvui
  links to the commit that produced it. This is B15's provenance completed through to Git.
- **Target: under 500 changed lines per commit.** A larger one usually means the sub-phase was not
  actually a phase. Treat a breach as a warning to the coordinator, not a hard refusal — a single
  generated file can legitimately exceed it.

### B22.4 Consolidation and handoff

When the run completes:

1. Merge every worktree's commits onto the single `harness/<run-id>` branch.
2. **Rebase that branch onto the latest default branch** so the user receives something that applies
   cleanly. If the rebase conflicts, STOP, leave the branch unrebased, and report the conflicting paths.
   Never force, never resolve conflicts on the user's behalf.
3. **Remove every worktree the run created.** No leftovers.
4. **Never push. Never open a PR. Never merge to the default branch.** The branch sits locally and the
   user decides: merge, PR, cherry-pick, or discard.
5. Report the branch name, the commit list, and the diffstat.

### B22.5 Commit hygiene is verified, not assumed

The completeness critic checks the commit tree as part of sealing:

- commit count is proportionate to the work — not one per file, not 500 for a small run;
- each commit's message describes a real unit of completed work;
- commits map sensibly onto tasks and their write scopes;
- oversized commits are flagged with their line counts.
  A run that produces an incoherent commit history has not finished cleanly, even if every gate passed.

### B22.6 Failure and abandonment

- A crashed run leaves its branch and worktrees intact for inspection; cleanup is explicit, never implicit
  on failure.
- `run:status` reports live worktrees and the branch.
- A command must exist to reclaim orphaned worktrees from an abandoned run — the same reasoning as
  `task:release` and `recover` for leases.

### B22.7 Configuration

`worktree_isolation` (default on), `worktree_root`, `branch_prefix` (default `harness/`),
`commit_per_subphase` (default on), `max_commit_lines` (default 500, warning threshold),
`rebase_on_complete` (default on). Never a push option — that is deliberately the user's decision alone.

---

## B23 — Raise the production file-size cap to 500 lines `verified`

**Verified 2026-08-20 (completion-tagging pass):** `tests/unit/architecture/file-size.test.ts` declares
`MAX_LINES = 500`, and the largest test file in the repo today (`validation-round-context.test.ts`) is
487 lines — under the cap, confirmed by `wc -l` across `tests/unit`.

**Owner decision:** the harness's per-file cap moves from 350 to **500 lines**.

`tests/unit/architecture/file-size.test.ts` enforces 350 today, which has already forced at least one
split made to satisfy a number rather than to clarify a seam (`task-review.ts` at 369).

- Raise the limit to 500 and keep the test enforcing it.
- The limit remains a smell detector, not a design principle: a file approaching 500 lines should still be
  split along a REAL seam when one exists. Splitting to satisfy the counter produces modules that are
  smaller and worse.
- Re-examine the splits made under the 350 rule during this overhaul; where a split created two halves
  that only make sense together, recombine them.

---

## B24 — Continuous dispatch: waves are a planning concept, not a barrier `verified`

**Verified 2026-08-20 (completion-tagging pass):** `agents/coordinator.yaml` now documents `queue:wave`
as "a read-only readiness snapshot — every task whose dependencies are done and [whose] write scope is
free... It is NOT a batch to assemble and wait on" and states a task dispatches "the moment nothing
blocks it — never once 'the wave' nominally finishes." `agents/orchestrator.yaml:84` states "There is
no wave barrier to wait on."

**Origin:** the owner observed real idle time — "if five implementers are completed, it shouldn't wait for
all five, because they're separate. Their validators can immediately kick in. If the next wave's task is
independent, it can jump in. Eight agents at a time should always be satisfied."

The same flaw exists in two places: in how this overhaul's own workflows were orchestrated, and in the
harness's own scheduler. The harness one is what matters long-term.

### B24.1 The defect — CORRECTED after reading the code

An earlier draft of this item claimed the scheduler enforces a wave barrier. **It does not.** Verified
2026-08-20:

- `workflow/gates/finish-task.ts:35` promotes a task to `ready` the moment "dependencies satisfied" —
  dependency-driven and continuous, never wave-gated.
- `scheduler/ready-set.ts` treats a recorded wave as an ANNOTATION on the answer, not a gate; its own
  comment says a persisted topology "annotates the answer".
- The only hard constraint at claim time is `ownershipConflicts` — write-scope collision — which is the
  correct constraint.

**The barrier is in the INSTRUCTIONS, not the code:** `SKILL.md:385` ("observing wave barriers and
dispatching subsequent waves"), `agents/coordinator.yaml:47` ("wave barrier, verify gate completion, and
dispatch the next wave"), `agents/orchestrator.yaml:80` ("Observe Round 1 until the wave barrier
completes").

So the state machine already permits continuous dispatch; the coordinator is simply told not to use it.
That makes this a much cheaper fix than a scheduler rewrite — and it means a wave is already what it
should be: the output of a _planning_ computation, not a synchronisation requirement. A task in wave N+1 whose dependencies
are already satisfied, and whose write scope collides with nothing currently leased, has no reason to wait
for an unrelated slow task in wave N.

The same holds inside the triad: when an implementer submits, ITS validator can start immediately. It does
not need the other implementers in its wave to finish.

Consequence today: with one slow task in a wave, every other agent idles until it completes. On a machine
capped at 8 concurrent agents, that is most of the capacity doing nothing.

### B24.2 Continuous dispatch — primarily an instruction change

Rewrite the coordinator law from "observe the wave barrier" to "keep the eligible set full", in SKILL.md,
`agents/coordinator.yaml`, `agents/orchestrator.yaml` and the coordinator role contract. Then add the one
query the new law needs:

- Maintain a **live eligible set**: every task whose dependencies are `done` and whose write scope
  collides with nothing currently leased. Recompute on every state change, not once per wave.
- Whenever a slot frees, take the highest-ranked eligible task — ranked by critical depth, as
  `proposeBatch` already does — and dispatch it. Do not wait for the current batch to drain.
- A validator becomes eligible the instant its implementer submits, independent of sibling tasks.
- Keep dispatching until the eligible set is empty or the concurrency budget is full.
- `max_parallel` stops being "the size of a wave" and becomes what it should be: a live occupancy ceiling.

Waves remain valuable for PLANNING and for the graph's step structure — they show what could have run
together. They stop being an execution rule.

### B24.3 Where a barrier is genuinely required

Keep a barrier only where the semantics demand one, and say so explicitly at each site:

- before the completeness critic (it judges the whole diff, so all task work must be terminal);
- at `branch:collect` (the parent needs every sub-task terminal before it resumes);
- before `run:complete`.
  Everywhere else, continuous dispatch.

### B24.4 Report occupancy so the waste is visible

`run:status` should show live occupancy against the ceiling, and the summary should report average
occupancy and total idle agent-time across the run. Idle capacity is invisible today, which is exactly why
it went unnoticed. Making it a number is what keeps it fixed.

### B24.5 Applies to this overhaul's own workflows too

The waves in this overhaul used `parallel()` barriers between build and verify, so every verifier waited
for the slowest builder. Waves 1 and 3 used the correct `pipeline()` form; 2 and 4-7 regressed. Use
pipelines, and feed enough independent items into one pipeline to keep all 8 slots occupied — including
work from later phases when it is genuinely independent.

---

## B25 — Retire "wave". The graph is a DAG; readiness is a parent relation `verified`

**Verified 2026-08-20 (fourth pass, correcting the completion-tagging pass's note above) — the prior
"B25.2 is NOT done" claim was wrong, and it was wrong at the moment it was written, not because code
changed after.** That note cited `isCycle: true` at `graph-generator-branch-nodes.ts:180` and
`graph-generator-critic-nodes.ts:222` as evidence the pushback loop was still a cyclic back-edge. Both
lines are real (now :186 and :222, one line drifted), but opening them directly shows each carries its
own comment reading "B25.4: an explicit, justified residual cycle, not the pushback loop B25.2
retired" — one is a branch's sub-agent reporting back to the exact parent node that opened it (a call,
not a round), the other is the completeness critic's finding pointing at a gate (the critic runs once,
has no round counter, and there is no later critic node to forward into). Neither is the repair-round
pushback the item is actually about; the prior pass conflated B25.4's two deliberate, owner-sanctioned
residual cycles with the thing B25.2 asked to remove.

The pushback loop itself is fixed, and thoroughly: `graph-round-context.ts` (`archivedTaskNodeId`/
`archivedValidatorNodeId`, `node-*-r${round}`), `graph-round-nodes.ts` (`buildArchivedRoundNodes`, one
implementer+validator pair per superseded round) and `graph-edge-factory.ts`
(`archivedRoundTransitionEdges`, `kind: "pushback"`, forward from round N's validator to round N+1's
task node — no `isCycle` anywhere in that file) together give every repair round its own node, wired
into `graph-generator.ts` with the comment "B25.2's fix for the cyclic pushback edge" at the exact call
site. The probe/pushback distinction survives as the edge KIND, not direction:
`liveRoundFeedbackEdges` sends a `probe` forward from validator to gate (never back to the
implementer, "a probe... never punishes the implementer"), and pushback is `kind: "pushback"` forward
into the next round's node. Tested directly: `tests/unit/summary/graph-validator-nodes.test.ts`'s
`describe("probe and pushback are different relationships")` asserts `probe?.isCycle` and
`pushback?.isCycle` are both `undefined` and that the two kinds never appear on the same finding class;
`describe("an archived round backed by validation_history stays acyclic")` drives a real two-round
rejection through `generateGraphDataset` and asserts `taskEdges.some((e) => e.isCycle === true) ===
false`. `bun test tests/unit/summary/graph-validator-nodes.test.ts` passes (confirmed this pass, not
carried over). B25.1 (wave retired as an execution instruction) re-confirmed by direct grep this pass:
`SKILL.md`/`agents/*.yaml` carry zero "wave barrier" instructions; every remaining "wave" mention is
either `queue:wave`'s own display-only readiness label (`ready-set.ts`'s `recorded_wave` field, its own
comment: "A DISPLAY annotation only (B25)... never what a coordinator must wait for") or an explicit
statement that no wave barrier exists (`orchestrator.yaml`: "There is no wave barrier to wait on").
B25.3 (parallel unless proven inseparable) and B25.4 (residual cycles stay explicit and justified) are
both demonstrated by the same code just cited, not separately artifacted. B25.5 is a meta-instruction
about how this backlog itself gets orchestrated, not a code deliverable.

**Owner's framing, and it supersedes the vocabulary in B24:** "when you are dealing with graphs, trees,
and their nodes, the word wave doesn't mean anything for our system... what it means is a parent node and
things related to it. Other than the validation feedback loops we should also design the graph as a
directed acyclic graph as possible — even the pushback validation system. Our goal should be to make the
entire graph acyclic so that it follows whatever the acyclic graph parallelism is. It shouldn't work as
sets of instructions that must be completed this way."

This is correct and it simplifies the system rather than complicating it.

### B25.1 "Wave" is not a concept this system has

A wave is a batch. A batch is a synchronisation idea imported from a world without a dependency graph.
This system HAS a dependency graph, so the only question that ever needs answering is:

> **are this node's parents satisfied, and is its write scope free?**

If yes, it runs. There is no batch to belong to and no cohort to wait for.

- Remove "wave" as an execution instruction everywhere: `SKILL.md`, `agents/coordinator.yaml`,
  `agents/orchestrator.yaml`, the coordinator role contract, and `queue:wave` itself.
- Replace `queue:wave` with a readiness query — everything claimable right now, ranked by critical depth.
- The 2N+1 sizing formula dissolves with it. There is no fixed implementer:validator ratio; you dispatch
  whatever is ready up to the occupancy ceiling. Keep the pairing INVARIANT (an implementer's work is
  always independently validated) and drop the arithmetic.
- "Wave" may survive as a DERIVED LABEL for display — "these nodes have no path between them, so they
  could have run together". That is an observation about the graph, never an instruction to the scheduler.

### B25.2 Make the pushback acyclic — every round is a node

Today a rejection is a BACK-EDGE (`kind: loop`, `isCycle: true`) from the gate to the task, which makes
the graph cyclic and forces the layout engine to break the cycle to draw it.

Model each round as its own node instead:

```
implement-r1 ─▶ validate-r1 ─probe─▶ repair-r2 ─▶ validate-r2 ─▶ done
```

Every edge points forward. The graph becomes a genuine DAG. This is better on every axis:

- **Parallelism reasoning is uniform** — one rule, "parents satisfied", applies to repair rounds exactly
  as it does to fresh tasks. No special case for the loop.
- **Evidence ownership becomes unambiguous.** Round 2's commands, findings and screenshots belong to
  round 2's node. The "which round did this belong to" problem disappears rather than being annotated
  around.
- **Layout gets simpler and more stable** — no Eades cycle-breaking pass, no un-reversal at emit, no
  back-edge routing. Directly relevant to B17's layout audit.
- **The step sequence is naturally linear**, which is what B15 needs.

The probe/pushback DISTINCTION survives and stays visible — it becomes the KIND of the forward edge into
the next round's node, not a back-edge. `probe` and `pushback` remain semantically different and remain
visually different.

### B25.3 What legitimately stays sequential

Only work that cannot be separated without losing meaning belongs to one implementer/validator chain.
Everything else is a separate node with its own parents. The default assumption inverts: parallel unless
proven inseparable, rather than batched unless proven independent.

### B25.4 Residual cycles

If any cycle remains after this (a genuine retry that cannot be modelled as a new node), it must be
explicit, justified in code, and rendered as such. A cycle should be an exception someone chose, not a
consequence of the modelling.

### B25.5 Applies to both systems

Same reasoning governs how the remaining backlog is orchestrated in this chat: no batching, no waiting for
a cohort. Each item runs when its dependencies are met, verifiers start when their own implementer
finishes, and independent later work fills free capacity immediately (B24).

---

## B26 — Enrich the validator packet: orient without anchoring `verified`

**Verified 2026-08-20 (reconciliation pass) — retags `queued` → `verified`; the test gap the note directly
below named is now closed, checked by opening the actual file rather than trusting the claim either way.**
`tests/unit/workflow/validator-independence.test.ts` did not exist when that note was written and is not
`tests/unit/workflow/validation.test.ts` (a different file) — its `git log` shows it last touched in
commit `a214752` ("test: give every fixture a discriminating gate and clear the unit lane"), landed today.
Read it in full: its first test, "the validator of round 1 is refused round 2 of the same task," drives
exactly the cycle the note below demanded — claim, submit, `validator-r1` rejects round 1, a repairer
claims and submits round 2, `validator-r1` attempts round 2 validation on the SAME task and is refused —
and asserts the refusal **by error code**, not a bare throw: `expect(refused.code).toBe("INVALID_STATE")`
plus the exact message, via a `refusal()` helper that unwraps a `HarnessError` and fails the test outright
if the call does not throw at all. `bun test tests/unit/workflow/validator-independence.test.ts` — 4/4
pass, confirmed just now. The packet-rendering half this item also requires was re-checked too, not just
carried over: `render-validation-round.ts` still renders a `"### Prove these hold"` section (the field
is now named `prove_these_hold`; same "prove it holds" framing the note below quotes, wording shifted
since) and `grep -in concluded render-validation-round.ts` returns nothing — the anti-anchoring rule the
item's "one rule" section requires still holds. Both halves of this composite item now clear the
`verified` bar; retagging accordingly.

**Superseded note, kept for provenance — the gap it named is now closed above, do not treat as current:**
the `verified` tag this section briefly carried did not match this item's own text, and no dated note had
caught it. The "Verified" note directly below is accurate as far as it goes: it confirms the
packet-rendering half of this item (`render-validation-round.ts`'s "prove this holds" framing). It says
nothing about this item's own "Close the test gap — do this regardless" section further down, which states
plainly that the fresh-validator refusal `begin-validation.ts:22` enforces is "a load-bearing invariant
asserted 12+ times in prose, argued zero times, and defended by no real test." Re-opened
`tests/unit/workflow/validation.test.ts` directly (237 lines) rather than trusting either account: it
has no test that claims the same validator identity twice on one task — every repair round in the file
(e.g. "repairs require explicit finding resolution before pass":170-212 uses `validator` then
`validator-2`; "six rejected rounds escalate instead of succeeding":214-236 uses `validator-1` through
`validator-6`) deliberately gives each round a fresh id, which is the opposite of the scenario this gap
asks for — and no assertion checks a refusal by error code (`toThrow()` appears eight times in the file,
every one of them bare). Per this file's own status key,
`verified` requires guard holds "not a passing test alone," and per the composite-item clause added
above, one unresolved piece a container item still lists holds the whole item at `queued`. Retags
`verified` → `queued` on that basis; the packet-rendering confirmation below is not in question and
stands as written.

**Verified 2026-08-20 (completion-tagging pass):** `scripts/src/packets/render-validation-round.ts`
carries the exact "prove this holds" framing this item's core rule requires (its own comment names the
sentence verbatim, contrasting it with "an earlier round concluded X") and a "nothing changed since the
previous round" comparison against the anchor commit — read directly from the file.

**Decision reached after verifying subagent context behaviour against official documentation and the
harness's own code.**

### The settled facts

- Claude Code subagents start **fresh** by default — no parent conversation, no tool results
  (code.claude.com/docs/en/sub-agents.md). A round-2 validator arrives knowing nothing.
- The harness **already enforces** fresh validators: `begin-validation.ts:22` refuses a validator that
  reviewed the same task before. No override flag. Three clauses, all scoped to the task.
- Reuse mechanisms exist (`/subtask` forks, `SendMessage` resume) but reuse is the WRONG choice on
  quality grounds, independent of cost.

### Why fresh is right, and why the packet must change anyway

A validator that reviewed round 1 checks what it flagged and does not re-examine what it passed — it
already decided that part was fine. But the repair TOUCHED THE CODE, so the most dangerous round-2 defect
is a regression in something round 1 approved, which is exactly that validator's blind spot. Add
commitment bias (an agent defends the position it argued, turning round 2 into "did they do what I said"
rather than "is this correct now") and the case is settled.

But today's fresh validator is handed too little, which costs quality three ways: it burns finite
attention on rediscovery instead of scrutiny; it does not know what was already demanded, so it
re-demands or fails to check follow-through; and it cannot see what changed SINCE round 1, so it cannot
concentrate on the risky delta.

### What the round-N packet must carry

All of it is already recorded in the capsule and simply not handed over:

- the full diff, and specifically **what changed since the previous round**;
- every command already run for this task, with argv, exit code and output;
- the previous round's findings and probe demands;
- what already passed, so it is not re-litigated;
- the gates that apply and their latest recorded results.

### The one rule that keeps it orientation and not anchoring

Prior findings enter the packet as **"prove this holds"**, NEVER as "round 1 concluded X". The first
directs attention; the second imports a conclusion and quietly recreates the bias the fresh-validator rule
exists to prevent. Enforce it in how the packet is RENDERED, not by asking the agent to be careful.

Context sanitisation stays intact: implementer prose and confidence claims remain stripped. What is added
is recorded FACT (diffs, commands, exit codes) and recorded DEMANDS — never anyone's opinion.

### Also legal today, worth taking

All three refusal clauses are task-scoped, so ONE validator identity may be reused across DIFFERENT tasks.
Caveat found in code: `critic-identity.ts` disqualifies any agent that validated anything from serving as
completeness critic run-wide, so reserve a small pool of identities that never validate.

### Close the test gap — do this regardless

`tests/unit/workflow/validation.test.ts:56-62` covers only the implementer clause and uses a bare untyped
`.toThrow()`. **`begin-validation.ts:22` could be deleted by a refactor and every test would still pass.**
A load-bearing invariant asserted 12+ times in prose, argued zero times, and defended by no real test —
the same shape as the role packets that bound nothing. Drive a full cycle (claim, submit, validate,
reject, repair, re-validate with the same identity) and assert the refusal BY ERROR CODE.

---

## B27 — Concurrency is a workload property, not a CPU formula `verified`

**Verified 2026-08-20 (fifth pass) — the only blocker the fourth pass recorded, an uncommitted diff, is
gone: `git status --short` is clean and `git rev-list --left-right --count
origin/orchestration-overhaul...HEAD` reports `0  0`.** `git log` confirms the four files it named
(`SKILL.md`, `agents/coordinator.yaml`, `cli/commands/run-ops.ts`, `tests/integration/cli-run-ops-commands.test.ts`)
landed in `85e832d` and `b70d1ae`. Re-ran B33's three-bar check fresh rather than trusting the prior tag:

- **Reachable and correct, read directly, not re-derived from the note:** `SKILL.md` Hard Rule 11 and
  `agents/coordinator.yaml` Phase 2 both state the provider-bound/local-bound split and point at the two
  separate ceilings. `config/host-concurrency.ts`'s `discoverHostConcurrencyCeiling` asks
  `summary/host-telemetry.ts` (never hardcodes a number, returns `null` on a silent host) and
  `deriveGateConcurrencyCeiling` halves the discovered core count, floored at 1, config-overridable.
  `cli/commands/run-ops.ts`'s `occupancyCeilings` reads both `default_max_parallel` and
  `gate_max_parallel` and the JSON/markdown `run:status` output carries both.
- **B27.3 ("widen until the provider pushes back, then back off") was not a separate unimplemented
  mechanism — it already exists, built for B28.3.** `orchestrator/failure-classifier.ts`'s
  `UNBOUNDED_COUNT_TRANSIENT_SIGNALS` includes `rate_limit` by name, with exponential backoff plus jitter
  and no retry-count cap (only an elapsed-time budget), which is exactly "the provider's pushback is the
  honest signal, retry past it rather than pre-guessing a ceiling." No new code needed; this is legitimate
  reuse across two backlog items describing the same mechanism from different angles.
- **Guard holds:** `bun test tests/unit/config/host-concurrency.test.ts
tests/unit/config/harness-config.test.ts tests/integration/cli-run-ops-commands.test.ts` — 35 pass, 0 fail, run
  this pass, not carried over.

No code or doc changes were needed this pass — the fourth pass's implementation was already correct and
complete; only the commit/push state and the tag were stale.

---

<details>
<summary>Prior pass's note (superseded by the verification above, kept for history)</summary>

**Still queued 2026-08-20 (fourth pass) — B27.2 re-confirmed landed and tested; B27.1's documented gap
closed in this pass, but the diff is uncommitted, so the item cannot carry `verified` yet (that tag
requires a SEPARATE later pass over landed code, not the pass that wrote it).**

B27.2 is genuinely done, and more thoroughly than the prior note showed: `config/host-concurrency.ts`
(`discoverHostConcurrencyCeiling`, `deriveGateConcurrencyCeiling`) is wired into
`config/harness-config.ts`'s `resolveConcurrencyCeiling` — precedence is an explicit
`default_max_parallel`/`max_concurrent_agents` in config, else host discovery, else the assumed
default (`default_max_parallel_source` records which) — and `gate_max_parallel` (cores/2, floor 1,
config-overridable) resolves alongside it. Both reach `cli/commands/orchestrator-ops.ts`'s
`orchestrator:supervise`, which already reported occupancy against both ceilings with provenance
before this pass. Directly tested: `tests/unit/config/host-concurrency.test.ts` (env-var discovery,
null-on-silent-host, integer/positivity rejection, the halving derivation) and
`tests/unit/config/harness-config.test.ts` (the full precedence chain via injected test seams). `bun
test tests/unit/config/host-concurrency.test.ts tests/unit/config/harness-config.test.ts` — all pass,
run this pass, not carried over.

B27.1's two gaps were real and are now closed:

1. **The workload categorization was written nowhere an agent reads it.** `grep -n
"provider-bound\|local-bound\|gate_max_parallel" SKILL.md agents/*.yaml` was empty before this pass.
   Added as `SKILL.md` Hard Rule 11 (reasoning goes wide on the host-discovered ceiling; gate-running
   agents throttle to the separate `gate_max_parallel`) and expanded into an actionable paragraph in
   `agents/coordinator.yaml`'s Phase 2, since the coordinator is the agent that actually decides
   dispatch width.
2. **`run:status` reported occupancy against only one ceiling.** `cli/commands/run-ops.ts`'s
   `runStatusCommand` now reports both — `occupancyCeilings()` reads `gate_max_parallel` alongside
   `default_max_parallel`, the markdown brief states both ("occupancy slots in use (gate ceiling N)"),
   and the JSON `occupancy` object carries `gate_max_parallel`. Honestly scoped: the harness has no way
   to tell which active lease is mid-gate versus mid-reasoning (the same limit `RunSupervisor` already
   documented for `orchestrator:supervise`), so this states the gate ceiling alongside occupancy rather
   than inventing a gate-specific occupancy count nothing tracks. `tests/integration/cli-run-ops-commands.test.ts`
   updated to match (the exact-object assertion relaxed to a partial-match one plus a type check, since
   `gate_max_parallel` is genuinely machine-dependent when no config overrides it). `bun test
tests/integration/cli-run-ops-commands.test.ts` — 2/2 pass. `bun run typecheck` clean.

**What's left before this can be tagged `done`/`verified`:** the diff above (`SKILL.md`,
`agents/coordinator.yaml`, `scripts/src/cli/commands/run-ops.ts`,
`tests/integration/cli-run-ops-commands.test.ts`) is sitting in the working tree, uncommitted, alongside
unrelated concurrent work-in-progress from another in-flight pass (`agent-ops.ts`, `registry/agent.ts`,
`workflow/agents/grants.ts` and their tests — not touched here, left alone per standing constraints).
Commit this item's four files once nothing else is actively writing them, then a later pass can confirm
per B33 and retag.

**Owner's objection, and it is largely correct:** "one core can handle definitely more than one agent...
eight at a time is blocking the higher potential. It's not forcing our computer — it's the companies
giving us the flows and their servers."

### B27.1 Both constraints are real, and they bind different things

- **Agent reasoning is provider-bound.** An agent waiting on a response consumes almost no local CPU.
  For reasoning-heavy work, 40 concurrent agents is entirely reasonable and a CPU-derived cap is nonsense.
- **Agent tool execution is local-CPU-bound.** Measured during this overhaul: load average **33 on 10
  cores** with ~10 agents live, because each was running a 1400-test suite, `tsc`, and repo-wide greps.
  That is not the model thinking; that is the machine working.

So the cap must depend on **what the agents actually do**, not on core count alone:

```
reading / analysis / doc work      → provider-bound   → go wide (40+ where the host allows)
implementation with a test gate    → local-bound      → narrow, or the gates thrash
mixed                              → bounded by the heavy fraction
```

### B27.2 Discover the ceiling, do not assume it

The skill must not hardcode a number:

- Read the host's declared concurrency limit where it publishes one (B20's discovery registry is the
  place). Claude Code documents a default of 20 via `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`; other hosts
  differ; some publish nothing.
- Config `max_concurrent_agents`: unset means "use what the host allows".
- Track a **separate, lower ceiling for gate-running agents** — the local machine is the constraint there,
  and that is the number worth deriving from cores.
- Report occupancy against both ceilings (B24.4), so under-use is visible rather than assumed.

### B27.3 Back-pressure from the real signal

Rate limits and provider errors are the honest signal that the outer ceiling was hit — not a guess made in
advance. Widen until the provider pushes back, then back off. That is what makes an unattended overnight
run finish sooner rather than idling under a conservative constant.

</details>

---

## B28 — Autonomous supervision: crash recovery and unattended long runs `verified`

**Verified 2026-08-20 (completion-tagging pass):** confirmed via B38 finding 3's own account — after a
same-session fix to the test's fake-clock wiring (not this item's own code),
`bun test tests/unit/orchestrator/supervisor.test.ts tests/unit/orchestrator/supervision-tick.test.ts`
ran 14/14 pass, including the crash-restart scenario that is the literal proof of B28.2/B28.4.

**Owner requirement:** "let's say I have given a very long list of tasks and I want them to run the entire
night while I'm sleeping, and when I wake up I want to see things are still working and implementing
properly with a proper exponential back-off. Automatic recovery should already be inside it — the user
should not need to mention it in the prompt."

### B28.1 What already exists, and what is missing

Present: the capsule IS a durable work queue (`state.tasks` with statuses that survive any crash), leases
expire, `recover` reclaims a dead lease, `task:release` returns one voluntarily, `queue:next` ranks what is
claimable.

Missing: **anything that keeps the loop running without a human.** Every one of those pieces must currently
be invoked by a coordinator that is itself an agent that can die. Nothing notices when it does.

### B28.2 The supervisor

A durable loop that keeps the eligible set dispatched until the run reaches a terminal state:

- Runs the continuous-dispatch policy from B24 — fill free capacity whenever anything becomes eligible.
- **Detects a dead agent without being told.** An expired lease with no submission is a crash. So is a
  grant with no heartbeat past its deadline, and an agent that returned without producing its required
  summary (B21).
- **Reclaims and redeploys**: `recover` the lease, then dispatch a fresh agent for that task. The task's
  recorded state is intact, so the replacement resumes from evidence rather than from scratch.
- Survives its own death: state lives in the capsule, so a supervisor restarted after a crash rebuilds
  from the event chain and continues. Never hold progress only in a running process.

### B28.3 Distinguish transient from deterministic failure — this is the crux

Retrying a deterministically-failing task forty times overnight burns a night and a budget for nothing.

- **Transient** — rate limit, network error, provider 5xx, host timeout: retry with **exponential backoff
  plus jitter**, unbounded in count but bounded in total elapsed time.
- **Deterministic** — the same gate failing the same way with the same error across attempts: STOP.
  Escalate the task, record why, and **move on to other eligible work** rather than blocking the run.
- Classification must be recorded, not guessed silently, and shown in the morning report.

### B28.4 The unattended contract

What the owner must be able to rely on after eight hours:

- Every task reached a terminal state, or is explicitly escalated with a recorded reason.
- No agent is silently stuck; no lease is orphaned; no branch is left uncollected.
- The run never spun: a task that cannot progress escalates rather than looping.
- Budget bounds were respected (`max_agents`, B1.2) and hitting one is reported, never silent.
- A morning report answers, without reading logs: what completed, what escalated and why, what was
  retried and how often, where the time went, and what needs a human.

### B28.5 On by default

Automatic recovery must NOT require a prompt asking for it. It is the default behaviour of a long-task
harness; opting OUT is what should need a flag. A user who has to remember to ask for recovery does not
have recovery.

---

## B29 — Gates are scoped to the task; the full suite runs once, at the barrier `verified`

**Verified 2026-08-20 (this reconciliation pass) — the "not found" note directly below was wrong at
the moment it was written, not stale since: it grepped `cli/registry/plan.ts` (the flag/help registry)
and never opened `cli/commands/plan.ts` (the actual handler), where the feature has lived since
`eaabd5c` — the very first rewrite commit, hours before the note was added.** Opened the real file:
`planAddCommand` in `orchestrating-long-tasks/scripts/src/cli/commands/plan.ts:251-259` calls
`gateBreadthWarning(gate, writeScope)` and, only once that warns, `discoverGatePaths(...)` to suggest
real on-disk test paths for the scope — wired to the CLI through `cli/registry/plan.ts`'s
`handler: planAddCommand`, not a parallel, unreached copy. `bun test tests/unit/graph/gate-breadth.test.ts
tests/unit/cli/plan-commands.test.ts` — 22/22 pass, with assertions on the actual warning text
(`toContain("whole-suite")`, `toContain("src/db")`, `toContain("--completion-gate")`), not just "does
not throw". Guard confirmed load-bearing: in an `rsync`ed scratch copy under the scratchpad directory
(never the real tree), neutered `gateBreadthWarning` to always return `undefined` — 1 of 16 tests in
that file failed immediately on the missing warning text; `git status` on the real tree showed nothing
touched afterward, and the scratch copy was deleted. The rest of the item is real too, checked directly
rather than assumed: `SKILL.md:62` states the scoping rule in prose; every validator role file
(`roles/validator.md` and all five `validator-*.md` domain files) carries, under `must_not`, "Run the
whole repository's suite to verify one task; run that task's gate and the tests covering its scope"
(B29.2); `roles/repairer.md:11` carries the matching repair-round rule (B29.2's "not everything");
`roles/implementer.md` carries, under `may`, "Update the tests covering its write scope when its change
alters the behaviour they assert" (B29.4) and, under `must_not`, "Run the whole repository's suite for
incremental work; run the tests covering the files touched". B29.1 (rationale) and B29.5 (this
overhaul's own workflow discipline) are prose/process, not code, and are already evidenced throughout
this document's own resolution notes, which cite scoped test-file runs rather than the full suite.
Reachable, does what the item asked, guard holds — all three of B33's bars, opened fresh rather than
carried over from the note below.

**Superseded note, kept for the record — its "not found" conclusion is corrected above, do not treat as
current:** per-task `--gate` scoping is a real mechanism
and `plan-replan-bindings.ts` enforces that a repair task names one gate rather than inheriting several
silently. B29.3's specific ask — `plan:add` WARNS when a `--gate` looks like a whole-suite run while
`--scope` is narrow, and suggests test paths derived from the scope — was not found in the `plan:add` handler
(`cli/registry/plan.ts`).

**Verified 2026-08-20:** the mechanism is right and the guidance is absent. `--gate` is per-task and the
generated examples scope it correctly (`--scope "src/db" --gate "bun test tests/db.test.ts"`), and
`--completion-gate` is separate with no default. But grepping SKILL.md, all nine role contracts, every
reference doc and every agent persona for "scoped test / only the tests / related test / full suite /
targeted test" returns **zero hits**. Nothing tells an agent to scope anything, so nothing stops a
coordinator writing `--gate "bun test"` eight times.

### B29.1 Why it matters more as projects grow

A 10-minute suite, 8 tasks, 3 rounds each = 4 hours of re-running already-green tests, per run. On a large
repo it is worse than the work itself. It also consumes the local CPU that B27 identifies as the real
concurrency constraint — measured during this overhaul: load average 62 on 10 cores, 0% idle, with agents
doing little but re-running the same full suite.

### B29.2 The rule

- **A task gate proves THAT TASK.** It runs the tests covering the task's `write_scope` and nothing more.
- **A validator runs the task's gate**, not the suite. Its job is to verify this task, not the repo.
- **The full suite runs once, at the completion barrier**, before sealing — where it is genuinely earning
  its cost by catching cross-task interactions that no scoped gate could see.
- A repair round re-runs the task's gate plus any gate whose scope the repair touched — not everything.

### B29.3 Make it hard to get wrong

- `plan:add` WARNS when a `--gate` looks like a whole-suite run while `--scope` is narrow. Warn rather
  than refuse: sometimes a broad gate is the honest choice, and the coordinator should say so.
- Offer derivation: given a `write_scope`, suggest the test paths that cover it, so scoping is the easy
  path rather than the disciplined one.
- Record gate cost. Once wall-clock per gate is recorded (B15), a run can report where its time went, and
  a needlessly broad gate becomes visible instead of merely suspected.

### B29.4 Agents update the tests they scope

An agent changing code in its scope is responsible for the tests covering that scope — running them AND
updating them. A scoped gate that passes because its tests no longer cover the changed behaviour is worse
than a slow one.

### B29.5 Applies to this overhaul's own workflows immediately

Every wave prompt in this overhaul instructed agents to run
`bun test --timeout 60000 --parallel tests/unit` — the entire suite, every agent, every verification.
That is the direct cause of the measured saturation and of the two load-sensitive test failures currently
blocking a commit of 446 files. Change the prompts: agents run the tests for the files they touched; the
full suite runs once per wave, at the barrier, before committing.

---

## B30 — The skill is Antigravity-specific where it claims to be host-agnostic `verified`

**Verified 2026-08-20 (reconciliation pass) — the item's own stated closing condition is now met.**
This item's own top note (below) said plainly "this item does not close until B36's work item does."
B36 is now tagged `verified` (see its own entry, opened fresh minutes before this one): all four of its
work items — `coordinator.yaml`, `run-playbook.md`, `host-adapters.md`'s numbering, `parity-matrix.md`'s
contradiction, plus the new `vendor-prose` mechanical guard against a regression — are done. B30.1 (the
tool name belongs in an adapter row, never a rule) is exactly what that guard now enforces by construction.
B30.2 (honest degradation) has real prose satisfying its literal ask, opened directly: `host-adapters.md:145`
reads "No subagent mechanism at all → run single-agent, and state in the run summary that validation was
not independent," which is B30.2's own sentence essentially verbatim — documented, though not separately
mechanically guarded the way B30.1 now is (no test was found asserting a single-agent run's summary
actually states this). B30.3, B30.5, B30.6 and B30.7 were already settled research, cited throughout this
document and unchanged. Item closes on the strength of its own stated condition; B30.2's lack of a
mechanical guard is a smaller, separate gap worth a fresh, narrowly-scoped item if it matters later — not
a reason to hold this one open indefinitely per B37 finding 10's own lesson about that failure mode.

**Still queued 2026-08-20 (completion-tagging pass, retires the `research-in-flight` tag) — superseded
by the paragraph above, kept for the record:** the
research phase (B30.5) is complete and its findings are cited throughout this document. The application
phase B30.1 called for is not done — see B36, whose finding B38 independently re-confirmed unfixed the
same day it was raised. This item does not close until B36's work item does.

**Correction 2026-08-20 (reconciliation pass) to the "Verified" paragraph directly below — the count and
the "no other host is named" claim are now stale, and B36 (re-checked fresh, see its own entry) shows
the application phase is partially, not zero, done:** `grep -rn invoke_subagent` across
`agents/coordinator.yaml`, `references/host-adapters.md`, `references/parity-matrix.md` and
`references/run-playbook.md` today returns **7** hits, not 8 — `coordinator.yaml` no longer has any
(B36.1's fix landed there), leaving `run-playbook.md` (1, still unqualified), `host-adapters.md` (2, both
correctly scoped inside its own adapter table/prose) and `parity-matrix.md` (3, inside a per-host-column
table). And the "no other host's dispatch mechanism is named anywhere" claim no longer holds:
`parity-matrix.md`'s own header row already names "Anthropic Claude Code," "OpenAI Codex / ChatGPT" and
"Generic subagent CLI" as columns, and `host-adapters.md`'s adapter table (see B36's entry) lists a real
row per host — that table is genuinely correct, current work, not a stale artifact. What is still true:
`run-playbook.md`'s bare block is unqualified rule prose (not a table cell), so a coordinator reading it
under Codex or Cursor is still told to call a tool that does not exist there — this item's core defect
survives even though its scope shrank. Item stays `queued`; see B36 for the itemised remainder.

**Superseded paragraph, kept for the record — do not treat as current:** `invoke_subagent` — Antigravity's tool name — appears 8 times across
`agents/coordinator.yaml`, `references/host-adapters.md`, `references/parity-matrix.md` and
`references/run-playbook.md`. **No other host's dispatch mechanism is named anywhere in the skill.**
`references/host-adapters.md` is 146 lines and `parity-matrix.md` 61, both written as though one
mechanism were universal.

A coordinator running under Claude Code, Cursor, Codex or Gemini is therefore being told to call a tool
that does not exist there. The skill's claim of host-agnosticism is currently false.

### B30.1 The contract must be abstract; the tool name is a value

Per B19: a vendor name is a VALUE, never a first-class concept. The skill expresses the abstract need —
_dispatch an agent with role R, scope S, and this packet; learn its identity; know when it finishes_ —
and an adapter maps that onto each host. `invoke_subagent` belongs in an adapter row, never in a rule.

### B30.2 Honest degradation is a requirement, not a fallback

Some hosts may have no subagent mechanism at all. The skill must then degrade to single-agent operation
and **say so explicitly**, because a run without an independent validator is a materially weaker run and
the user must know that rather than discovering it later. Emitting a command the host cannot execute is
the worse failure: it fails confusingly rather than honestly.

### B30.3 Correction to an earlier claim of mine

I told the owner I could not message the running agents and implied it might be host-specific. That was
imprecise. `SendMessage` and `ListAgents` ARE Claude Code tools. The real limitation is narrower:
**workflow-runtime agents do not register as addressable targets** — `ListAgents` surfaces named
Agent-tool teammates and peer sessions only. Mid-flight workflow agents cannot be redirected. Any harness
design that assumes running agents can be re-instructed must account for that.

### B30.5 RESEARCH RESULTS — five hosts, five mechanisms (verified 2026-08-20)

Verified against official docs AND by running `strings` on the Antigravity and Codex binaries:

| Host           | Dispatch                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code    | `Agent` tool (renamed from `Task` in v2.1.63); definitions in `.claude/agents/*.md`                                                                                  |
| Antigravity    | `invoke_subagent` — the skill is CORRECT here, and only here                                                                                                         |
| Cursor         | `Task` tool; SDK policy string `"task"`                                                                                                                              |
| Codex          | `collaboration` namespace, tool `spawn_agent` (group `multi_agent_v1`)                                                                                               |
| ~~Gemini CLI~~ | **OUT OF SCOPE** — the open-source google-gemini/gemini-cli is unmaintained; owner decision 2026-08-20. Antigravity CLI and IDE are the Google surfaces that matter. |

**Findings that change the design:**

1. ~~Gemini nesting cap~~ — DROPPED. Gemini CLI is out of scope (unmaintained). The finding is retained
   only as a REASON THE CAPABILITY PROBE MATTERS: a host CAN cap nesting at 1, which makes
   branch-and-collect structurally impossible there. The skill must probe depth support rather than
   assume it, and degrade honestly when a host cannot nest. Cursor is the live instance of a real nesting
   constraint: since 2.5 the main agent and its DIRECT subagents may spawn, but a subagent's subagent
   may not.
2. **Antigravity already provides B22's worktree isolation natively.** `invoke_subagent` accepts an
   optional `Workspace` param the skill never mentions: `"inherit"` (default) | `"branch"` (isolated
   workspace) | `"share"` (shares the repo directory, "similar to a git worktree"). Prefer the native
   primitive over hand-built worktrees where the host offers one.
3. **Antigravity has native crash-resume.** `ReusedSubagentId` — "ID of a previous subagent to resume
   from... use this to resume work from a cancelled subagent." B28's supervisor should use it where present.
4. **Codex supports per-agent model selection natively.** `spawn_agent` takes `model` and
   `reasoning_effort` parameters. Concurrency knob: `agents.max_concurrent_threads_per_session` in
   `~/.codex/config.toml` (default undocumented).
5. **Claude Code**: `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` default 20, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`
   default 3. Experimental Agent Teams give file-based mailboxes at
   `~/.claude/teams/{team}/inboxes/{agent}.json`. A real spend cap exists: `maxBudgetUsd` / `max_budget_usd`,
   terminating with `error_max_budget_usd`.
6. **Cursor** supports subagents (do NOT degrade there). Nesting: since 2.5 the main agent and its direct
   subagents may launch subagents, but a subagent's subagent may not. No documented fan-out width limit.

### B30.6 A shipped reliability warning against the skill's core pattern

Antigravity's own binary contains: _"do not use other subagents like `research` or `self` since they may
hang, unless the user specifically requests it."_ The skill mandates `TypeName: "self"` for EVERY
implementer and validator. The guidance is context-scoped rather than absolute, but it warns against
precisely the pattern the skill universalises. Investigate before continuing to mandate it.

### B30.7 Host capability probing, not assumption

The adapter must record what each host actually supports — nesting depth, concurrency, native workspace
isolation, native resume, per-agent model selection — and the skill must adapt: use a native primitive
where one exists, degrade explicitly where a capability is missing, and SAY which mode it is in.

### B30.4 Sequencing

**Stale as of 2026-08-20 (flagged by B36.5, corrected in this same reconciliation pass — see B33: opening
B13's own entry above, not trusting this paragraph, is what settles it).** The paragraph below described
a real blocker at the time it was written, but B13 closed (`done (eaabd5c), verified`, confirmed by
`wc -l` on `orchestrating-long-tasks/SKILL.md` today) and no longer holds `references/**`. Application of
B30's spec is unblocked; what remains open is the work itself (B36's remaining scope), not a collision.

Original text, retained for provenance: "Research is running now (read-only, documentation-grounded, one
agent per host). Application is BLOCKED on Wave 8's B13, which currently owns `references/**` — writing
there now would collide. Apply the spec once B13 releases those paths."

---

## B31 — Model and effort tier policy `deferred by owner`

**Re-confirmed 2026-08-20 (completion-tagging pass):** B38's own scope note re-checked this item and
found it untouched, no changes — consistent with the owner's explicit deferral below. Left as
`deferred by owner`, not `queued`: the loop must not treat this as workable until the owner revisits it.

Research complete and written up in `model-effort-policy.md` (92 domains, 2026-08-20). **The owner has explicitly
deferred the decision** — effort and model settings stay as they are pending further thought. Do not
change them.

Headline for whoever picks this up:

- No host auto-selects a model by task difficulty. Claude Code resolution is env > per-call > frontmatter
  > session default, with no complexity input. Auto-routing is an open feature request, not a feature.
- **Effort, not model tier, is the lever.** Anthropic's own Jul-Aug 2026 numbers: `medium` matched
  default accuracy at 70-85% of cost; coordinator+worker tiering LOST to the coordinator's own model at
  lower effort in every case except bulk-beyond-one-context and tail insurance on routine work.
- Extended thinking on/off inherits from the session and has NO per-subagent setting; reasoning effort
  DOES have one.
- Anthropic's widely-cited 2025 multi-agent post is contradicted by their own 2026 measurements and was
  never retracted. Design from the newer numbers.
- Microsoft Magentic is the design most worth studying: it adapts EFFORT through a progress ledger and
  stall counters, never switching models — structurally closer to this skill's probe/repair rounds than
  anything in the routing literature.

---

## B32 — Telemetry is wired but unproven, and points at the wrong reporter `queued`

**Still queued 2026-08-21 (B32/B20 ownership pass) — B32.2 closed for real, B32.3 confirmed fully wired,
B32.1 half-fixed and half re-scoped as a spec question rather than a code defect.** Owned this pass:
`summary/host-telemetry*.ts` and `workflow/agents/**`.

- **B32.2 — CLOSED with a real, on-disk run, not a unit test.** Ran the actual CLI end to end against
  this repo: `plan:init`/`plan:add`/`plan:compile`, then `agent:register` for a coordinator and for a
  real, currently-active sibling subagent (`aa49f062714f34399`, one of this exact wave's own workers,
  found live under `~/.claude/projects/-Users-onurseckinsenoglu-repos/<session>/subagents/workflows/wf_4d2a801f-866/`),
  then `agent:report`, `agent:release` (twice, once per agent) and `summary:export`. Nothing was typed
  in — `agent:register` alone pulled real `harness_observed` telemetry straight off that sibling's own
  transcript (model `claude-sonnet-5`, tokens, tool calls), and the re-probe at `agent:release` picked
  up the count growing between calls, proving the read is live, not cached. The capsule is left on disk
  at `.capsules/b32-b20-telemetry-proof-2026-08-21/` (gitignored, harmless to keep) as the durable
  evidence this item's own bar demands: `state.json` has `'agents' in state == True` with two grants,
  and `summary/graph.json` / `summary/summary.md` both render the ledger — `summary.md:34` shows
  `Agents granted | 2`, `summary.md:146` shows the released grant row, `summary.md:160,178-180` show the
  tool-usage table, and `summary.md:221` renders the harness's own honesty footnote verbatim: "Only a
  value the harness itself read off the host's own configuration or transcript earns derived or
  harness_observed." Command-by-command output and every path cited above were read directly, not
  assumed.
- **B32.3 — now fully wired at all four boundaries; the earlier "task:submit still missing" note is
  stale.** Read `cli/commands/task-claim.ts` in full: `taskSubmitCommand` calls
  `probeAtTaskBoundary(run, agent, "task:submit")` at line 311, exactly mirroring `task:claim`'s call at
  line 173. All four boundaries (`agent:register`, `task:claim`, `task:submit`, `agent:release`) call
  the probe. One real, narrower gap remains: no test drives `task:submit` through a real `execute()` CLI
  call while asserting the probe fired (the existing `tests/integration/agents-host-telemetry-probe.test.ts`
  proves `task:claim` this way but exercises `task:submit`'s boundary only via a direct
  `refreshAgentDerivedTelemetry({ boundary: "task:submit" })` call, not through `taskSubmitCommand`
  itself) — a real gap under B33's own standard, but the fix lives in `cli/commands/task-claim.ts` and
  its test, outside this item's file grant (`summary/host-telemetry*.ts`, `workflow/agents/**`); flagged
  for whoever owns that file rather than fixed here.
- **B32.1, first half — fixed.** `agents/worker.yaml`'s "### Telemetry" section (previously lines
  126-128) told the dispatched subagent to relay its own tokens "if your host reports tool usage or
  token counts," naming no destination — exactly the defect this sub-item describes. Rewritten: the
  section now states plainly that the harness already reads the agent's own host transcript
  automatically at every boundary, and that `agent:report` is only for a fact that automatic read
  cannot see. No test references the old wording (`grep -rn "If your host reports tool usage"
  tests/ orchestrating-long-tasks/` — zero hits before or after), so nothing else needed updating.
- **B32.1, second half — investigated in depth, NOT changed, and the closure bar itself is now disputed
  rather than silently deferred.** The mechanical check ("`host_reported` never appears in production
  code") still reads true today. But renaming the transcript-derived `harness_observed` stamps in
  `workflow/agents/telemetry-merge.ts` to `host_reported` — the only reading of "wrong reporter" that
  would make that check pass — was tried on paper and rejected after opening the actual evidence: B34
  (itself `verified`) explicitly chose `harness_observed` by name for this exact data ("Telemetry is
  `harness_observed`, not `agent_reported` — the harness reads the host's own record"); four passing
  test files assert it by name, including `tests/integration/agents-transcript-telemetry-cli.test.ts`'s
  own test titles ("agent:register folds in real model, tokens and tool calls as harness_observed"); and
  this pass's own real run (B32.2 above) rendered the harness's own explanatory footnote into
  `summary.md:221` confirming `harness_observed` is the intended label for a transcript read, not
  `host_reported`. Renaming would break tests under `tests/integration/**`, which this pass's brief
  forbids editing (a sibling wave owns that lane) — confirmed by direct read of
  `agents-transcript-telemetry-cli.test.ts`, not inferred. Net: the "coordinator relays the dispatch
  result via a CLI flag" fix this sub-item's body text originally asked for is also independently
  wrong — a CLI flag value can never honestly be `host_reported` (it is unverified input from whichever
  process called the harness), which is exactly what B34 superseded it with. **What's actually left
  open is a spec question, not a known-but-undone fix: should anything ever earn `host_reported`, and if
  so what — or was that evidence class premised on a design (CLI-relayed dispatch results) that turned
  out to be wrong, in which case the class is legitimately unused by design and B32.1's literal grep
  should stop being treated as a defect.** Left for an owner decision rather than guessed at unilaterally.

Composite-item rule: the above closes B32.2 and B32.3 outright and half of B32.1 (worker.yaml); the
other half of B32.1 is a live spec question, so the item as a whole stays `queued`, narrowed to exactly
that one open question.

**Still queued 2026-08-20 (reconciliation pass) — re-confirmed directly, and B32.3's own note below now
corrects a claim ("ZERO production callers") that was wrong at the time this top note was last written.**
`probeAgentTelemetry` is real and wired (`detectHostTelemetry` + `readAgentTranscriptTelemetry`, called
from `agent:register`/`agent:release`/`task:claim` — see B32.3's own corrected entry for the full
re-verification, 69/69 tests passing). But two closure bars this item itself sets are still unmet, checked
just now: **B32.1** — `grep -rn '"host_reported"' scripts/src --include="*.ts"` shows the evidence class
declared in `contracts/evidence.ts` and nowhere else; no production code ever assigns it, so the
coordinator-records-from-the-dispatch-result fix this sub-item specifically asks for does not exist, and
`agents/worker.yaml:126-128` still carries the same subagent-conditional self-report instruction the
sub-item criticizes. **B32.2** — read both capsules' `state.json` directly rather than trusting the prior
claim: `.capsules/2026-08-17-skills-documentation-elevation/state.json` (this repo) and
`gvui/.capsules/2026-08-17-gvui-documentation-elevation/state.json` (the consumer) — neither parses with
an `agents` key present (`'agents' in state` is `False` for both). Per this item's own text, "until a
capsule on disk contains a populated agents ledger, treat this feature as unproven regardless of test
coverage" — so it stays `queued` on B32.1 and B32.2 even though B32.3 has moved substantially since the
note below was written.

**Previously (completion-tagging pass), now partly corrected by B32.3's own entry below:** B38 finding 2
already states this precisely and this pass found nothing to change it — the wiring is correct and
reachable (`probeAgentTelemetry` calls both `detectHostTelemetry` and `readAgentTranscriptTelemetry`,
hardcoded into `agent:register`/`agent:release`/`task:claim`), but B32.2's own closure bar — a capsule on
disk with a populated `agents` ledger from a real dispatched run — is still unmet; both capsules on disk
still lack an `agents` key.

**Verified 2026-08-20.** The pipeline exists: `agent:register` / `agent:report` / `agent:release` /
`agent:list` are registered; `state.agents` stores grants; `summary/agent-telemetry.ts` reads the ledger;
`buildNodeTelemetry` / `buildNodeTools` put it on graph nodes with per-value `evidence_class`; the
coordinator contract requires registering every agent before it works.

Two things stop it working in practice.

### B32.1 The reporter cannot see what it is asked to report

`agents/worker.yaml` instructs the SUBAGENT to relay its own token counts. But the host reports a
subagent's cost to its PARENT — in Claude Code, "subagent token cost counted in parent's
`total_cost_usd`". The subagent frequently has no access to its own numbers, and the instruction is
conditional ("If your host reports tool usage or token counts") without saying WHERE to look, which on
most hosts is nowhere.

Fix: make the **coordinator** responsible for recording an agent's token usage, because that is who
receives it — at `agent:release`, from the dispatch result it already holds. Keep the subagent's
self-report as an additional, clearly-labelled `agent_reported` source for hosts that do expose it, and
record both when both exist rather than silently preferring one.

Per host, name where the number actually comes from:

- **Claude Code** — the Agent tool result; `total_cost_usd` includes subagent cost. Budget caps exist
  (`maxBudgetUsd` / `max_budget_usd`, terminating with `error_max_budget_usd`).
- **Codex** — `spawn_agent` records an OTel span `codex.multi_agent.spawn`; agents are addressable by task
  path and `list_agents` enumerates them.
- **Antigravity / Cursor** — not established. Record `unknown` rather than guessing.

### B32.2 Nothing has ever exercised it

Both capsules on disk have `agents` ABSENT — expected, since they predate the feature, but it means the
path has never run end to end. This is exactly the condition under which the role-packet subsystem sat
fully implemented and completely unreachable for the entire history of this repo.

Close it with a real run, not a unit test: dispatch, register, report, release, export, and assert the
telemetry reaches `graph.json` and renders. Until a capsule on disk contains a populated `agents` ledger,
treat this feature as unproven regardless of test coverage.

### B32.3 Host config probing is dead code, and the CLI never does it automatically

**Corrected 2026-08-20 (reconciliation pass) — every claim in the note directly below is now false,
checked by re-running the exact greps it describes rather than trusting either the "dead code" report or
the top-of-item summary that repeated it.** `grep -rn "probeAgentTelemetry\|detectHostTelemetry"
scripts/src --include="*.ts"` (excluding tests) now shows real, non-test call sites at
`cli/commands/agent-ops.ts:90` (`agentRegisterCommand`), `:142` (`agentReleaseCommand`) and
`cli/commands/task-claim.ts:107` — three of the note's four named boundaries wired, `task:submit` still
missing (a real, narrower gap than "zero callers"). Gap 2 is also closed: `agent-ops.ts` calls
`withHostTelemetryConflicts(...)` at both register and release, backed by a real `TelemetryFieldConflict`
type and merge logic in `workflow/agents/grants.ts` (`telemetry_conflicts` recorded on the grant when
sources disagree) — both sources ARE now recorded and compared, not one silently unused. Gap 3 is closed:
`TELEMETRY_PROBES.codex` in `host-telemetry.ts` reads `~/.codex/config.toml` AND
`~/.codex/agents/<agentId>.toml`, extracting model, provider, reasoning_effort→thinking_level,
`max_concurrent_threads_per_session` and `features.multi_agent` — Codex is no longer absent. Gap 4 is
closed: every `TELEMETRY_PROBES` entry (codex, claude-code, antigravity, cursor) now returns a
`capabilities` object — `nesting_depth`, `concurrency_ceiling`, `native_workspace_isolation`,
`native_resume`, `per_agent_model_selection`, `multi_agent_enabled`, each `Evidenced<T>` — exactly what
B30.7 needs. All backed by passing tests, run directly: `bun test
tests/integration/agents-host-telemetry-probe.test.ts tests/unit/agents/telemetry-conflict-surfacing.test.ts
tests/unit/agents/telemetry-merge.test.ts tests/unit/summary/telemetry-conflict-surfacing.test.ts
tests/unit/summary/host-telemetry.test.ts` → **69 pass, 0 fail.** This sub-item is effectively resolved
bar the missing `task:submit` boundary; it does not, on its own, move B32's overall tag — B32.1 and B32.2
below are still open and the composite-item rule holds the whole item at the least-resolved piece.

**Superseded note, kept for provenance — every gap it lists is closed above, do not treat as current:**
`summary/host-telemetry.ts` contains a `HOST_PROBES` registry that reads the host's own config from the
user's home directory. It has **ZERO production callers.** Its only mention anywhere in `scripts/src` is
inside `health/parameters.ts`, which cites it as an example of a function whose parameter is never read —
the new health check found it as dead code.

Against the owner's stated requirement, four gaps:

1. **Not automatic.** The probe is never invoked at a task boundary. It must be a hardcoded step inside
   `task:claim`, `agent:register`, `task:submit` and `agent:release` — not a separate command, and never
   an extra round-trip asking an agent for telemetry it may not have.
2. **No second source, so no comparison.** The requirement is that the harness read the host's own config
   AND take the agent's report, then record BOTH and flag disagreement. Today there is one source and it
   is unused.
3. **Coverage is two and a half hosts.** `HOST_PROBES` has antigravity (`~/.gemini/antigravity-cli/settings.json`),
   claude-code (`~/.claude.json` plus `CLAUDE_CODE_MODEL`/`ANTHROPIC_MODEL`) and cursor (env var only, no
   config path). **Codex is absent entirely** despite `~/.codex/config.toml` being the richest source of
   the four — it carries `agents.max_concurrent_threads_per_session`, `[features] multi_agent`, and
   per-agent TOML definitions under `~/.codex/agents/`.
4. **Probing only finds a model, not a capability.** The same pass should record what the host CAN do —
   nesting depth, concurrency ceiling, native workspace isolation, native resume, per-agent model
   selection — which is what B30.7 needs and what makes honest degradation possible.

The storage contract is already correct and needs no change: `AgentGrantRecord` carries `provider`,
`model`, `model_tier`, `thinking_level`, `context_window`, `tools_granted`, `tools_used`, `tokens_in`,
`tokens_out` and `token_extras`, each an `Evidenced<T>`. A machine-discovered value is `derived`; an
agent-reported one is `agent_reported`; a host-supplied one is `host_reported`. When two sources
disagree, keep both and record the conflict rather than choosing silently.

---

## B33 — Verifier rule: look at the artifact, do not reason about it `done (bf42a7f)`

**Closed 2026-08-21 (scoped to `roles/**`, `agents/**` and the packets that carry them):** re-checked
the prior pass's count directly with `grep -c "B33" roles/*.md agents/*.yaml` before touching anything,
rather than trusting it — it was still accurate: 2 of the 9 validating-role documents
(`validator-security.md`, `validator-ui-design.md`) carried the rule, 0 of the matching personas did.
Extended it to the remaining 7 validating-role contracts and their personas, both a `must_not`/`may`
clause (an enforceable prohibition) and a prose bullet naming what the artifact is for that role, each
citing `(B33)`:

- `roles/validator.md` (the base contract every non-domain validator grant loads —
  `packets/role-grant.ts:94`'s `loadRoleContract(grant.role)` fallback when no `--validator-domain` is
  set) plus its three still-missing domain siblings, `validator-code-quality.md`,
  `validator-product.md`, `validator-system-design.md`.
- `roles/sub-validator.md`, `roles/plan-validator.md`, `roles/completeness-critic.md` — the three
  validating roles the prior pass's count never named at all, so this pass's own recount (`grep -c`
  above) is what actually established they too were missing it, not an assumption carried over.
- The matching personas the same recount showed at 0: `agents/validator.yaml`,
  `agents/plan-validator.yaml`, `agents/critic.yaml` — SKILL.md's own role table (lines 78-87) documents
  these as the second half of each validating role's binding instructions, dispatched alongside the
  `roles/*.md` contract, so the rule was still reachable-but-absent at the point an agent is actually
  configured, not only in the packet it reads once claimed.

Verified after landing, not assumed: `grep -c "B33" roles/*.md agents/*.yaml` now shows all 9 validating
role files and all 3 matching personas citing it (previously 2 and 0); `bun test
tests/unit/roles/role-documents.test.ts tests/unit/roles/agent-personas.test.ts
tests/unit/packets/role-contract.test.ts tests/unit/packets/role-contract-binding.test.ts
tests/unit/packets/role-contract-enforcement.test.ts tests/unit/packets/role-contract-loader.test.ts
tests/unit/packets/role-contract-refusals.test.ts tests/unit/packets/role-authorization.test.ts
tests/unit/packets/role-grant.test.ts tests/unit/packets/validator-domain-contract.test.ts
tests/unit/health/unenforced.test.ts tests/unit/workflow/review/checklist-coverage.test.ts` — 163 pass, 0
fail (digests are computed from file bytes at load time in every one of these, never hardcoded, so
editing the prose does not need a matching test-value update); `bun run typecheck` clean. Landed in
`bf42a7f`.

**Deliberately not touched, and why this is not a partial close:** `coordinator.md`, `implementer.md`,
`planner.md`, `repairer.md`, `sub-implementer.md`, `sub-investigator.md` and their personas still carry
no `(B33)` citation. The item's own text scopes the obligation to "every validating role," not every
role — these six never issue a verdict, a probe, or a finding, so there is no validating claim in their
contracts for the rule to bind. The prior pass's note additionally named "the implementer/critic/
coordinator contracts" as missing it; `completeness-critic.md` (the "critic" contract) is now covered
above, and `implementer.md`/`coordinator.md` are excluded on the same non-validating-role reasoning, not
overlooked. A future item extending the rule to non-validating roles (e.g. "an agent asserting something
about the host, filesystem, or another agent must have looked," B33's own closing paragraph) would be a
distinct, broader ask than this one.

**Still queued 2026-08-20 (completion-tagging pass):** the rule is demonstrably the operating principle
behind this document's own verification passes — every finding in B36-B38, and this pass's own tags,
cite it by name. But the concrete ask — add this rule's bullets to every verifier prompt — was found in
only 2 of 5 validator role files (`roles/validator-security.md`, `roles/validator-ui-design.md`), not in
`validator-code-quality.md`, `validator-product.md`, `validator-system-design.md`, or the implementer/
critic/coordinator contracts. Practiced, not yet universally wired.

**Origin: three failures of mine in one session, all the same shape.** I concluded what data was or was
not available by reading documentation and reasoning, when a filesystem check would have settled it in two
commands:

1. Claimed a subagent cannot see its own token usage, and designed B32 around a coordinator relaying it.
   Wrong — `~/.claude/projects/<project>/<session>/subagents/workflows/<run>/agent-<id>.jsonl` records
   `"model"` and per-turn `"output_tokens"` per agent, on disk, already.
2. Reported the telemetry pipeline as "~80% wired" after checking each layer separately, without checking
   whether anything connected them. `detectHostTelemetry` had zero callers.
3. Wrote `references/host-adapters.md` describing four hosts' mechanisms and treated documentation as
   integration. Nothing collects anything.

### The rule

**A claim about what data exists, where it lives, or whether something runs must be settled by opening the
artifact — not by reading a spec, a type, or a doc.** Where a filesystem or runtime check is possible and
was not performed, that is itself the finding.

Add to every verifier prompt:

- For any claim that data is unavailable: locate the producing artifact on disk and read it. Absence must
  be demonstrated, not inferred.
- For any claim that a subsystem works: find the call site and the test that exercises it. "Exported and
  imported" is not "runs"; a type that describes a thing is not the thing.
- For any design that works AROUND a limitation: prove the limitation is real before accepting the
  workaround. A workaround for a non-problem is worse than the problem — it ships complexity and hides
  the simpler path.
- Documentation describing a mechanism is evidence the mechanism is DOCUMENTED. It is not evidence it is
  implemented, reachable, or used.

### Why this belongs in the harness too

This is the same standard the skill already applies to agents — a validator may not "infer success from
file presence, test names, comments, or another agent's command output". It was never applied to claims
about the ENVIRONMENT. Extend it: an agent asserting something about the host, the filesystem, or another
agent must have looked.

---

## B34 — The real host telemetry source, found by looking `verified` **[supersedes B32.1's design]**

**Verified 2026-08-20 (completion-tagging pass):** landed in commit `4a573ca` —
`workflow/agents/transcript-telemetry.ts` (373 lines) plus
`tests/unit/agents/transcript-telemetry.test.ts` (524 lines). B38 finding 2 independently confirms
`readAgentTranscriptTelemetry` is called from real production call sites
(`cli/host-telemetry-probe.ts`, wired into `agent-ops.ts` and `task-claim.ts`), not merely defined —
`summary-graph-completeness-contract.test.ts` asserts the resulting node's `telemetry.tokensIn` carries
`evidence_class: "host_reported"`, 17/17 pass.

**Filesystem inventory, 2026-08-20.** Everything the harness needs is already on disk, written by the host,
per agent. B32.1's "the coordinator must relay tokens because a subagent cannot see its own" was a
workaround for a problem that does not exist. Discard it.

### Claude Code — the richest source, and it is complete

```
~/.claude/projects/<project-slug>/<sessionId>/
  <sessionId>.jsonl                                   main session transcript
  subagents/agent-<agentId>.jsonl                     Task-tool subagent transcript
  subagents/agent-<agentId>.meta.json                 {agentType, description, toolUseId,
                                                       parentAgentId, spawnDepth}   <- LINEAGE
  subagents/workflows/wf_<runId>/agent-<id>.jsonl     workflow subagent transcripts
  subagents/workflows/wf_<runId>/journal.jsonl        {type:"started"|"result", agentId, result}
  workflows/wf_<runId>.json                           run aggregate
```

`workflows/wf_<runId>.json` alone answers most of B15 and B32. Real observed keys: `runId`, `taskId`,
`agentCount`, `durationMs`, `status` (`completed|failed|killed`), `defaultModel`, `totalTokens`,
`totalToolCalls`, and `workflowProgress[]` whose per-agent entries carry:

```
{label, agentId, model:"claude-opus-5[1m]", state:"start|progress|done|error",
 queuedAt, startedAt, lastProgressAt, attempt, lastToolName, tokens, toolCalls, durationMs, error?}
```

Per-turn, inside `agent-<id>.jsonl`:

- `.message.model` — exact model id (`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`)
- `.effort` — reasoning effort as a string (`"high"` observed)
- `.message.usage` — `{input_tokens, output_tokens, cache_creation_input_tokens,
cache_read_input_tokens, service_tier, cache_creation:{ephemeral_5m, ephemeral_1h}}`.
  This is the per-host token accounting convention B20.3 asked for, recorded rather than assumed.
- `.message.content[].type=="tool_use"` — `{id, name, input}`: which tools, with arguments
- `toolUseResult` and `is_error` on the result turn — whether each call succeeded
- first/last `timestamp` — real duration
- `toolEndsTurn:true` — the completion marker

Machine-level, in `~/.claude.json`: per-project `lastModelUsage` keyed by exact model id with
`{inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD}` — **real recorded
cost**, which is what gvui was previously fabricating from a rate card.
`~/.claude/settings.json` carries `effortLevel` (this machine: `"xhigh"`).

**Not persisted:** the plaintext of `thinking` blocks is empty on disk with only an opaque signature.
Reasoning effort is recorded; reasoning content is not. Record that as a genuine limit, not a gap to fill.

### What this changes

- Telemetry is `harness_observed`, not `agent_reported` — the harness reads the host's own record.
- Token counts are REAL, replacing the `bytes/4` estimator entirely for this host.
- Lineage is real: `parentAgentId` and `spawnDepth` from `.meta.json`, so the graph's subagent tree stops
  being inferred from edge traversal.
- Tool usage is real: names and arguments per call, with success/failure — B15.3 satisfied for this host.
- Cost is real and recorded, so gvui can show a true figure or nothing.

### Work

1. A reader per host that parses these files, failing safely when the host is not installed.
2. Called as a HARDCODED STEP at `agent:register` / `task:submit` / `agent:release` — never a round-trip
   to an agent (owner requirement).
3. Reconcile with anything the agent self-reported: record both, flag disagreement, never choose silently.
4. Same treatment for Codex, Antigravity and Cursor from their inventories — and where a host records
   nothing, say `unknown` rather than inventing a shape.

---

## B35 — Three more load-sensitive tests; B11.1's sweep was incomplete `queued`

**Scoped re-check 2026-08-21 (seventh pass, file-ownership scoped to `tests/unit/**` only — nothing
changed, but the scope itself is now the finding).** Assigned to fix "the specific test files B35
names, under `tests/unit/**`." Re-verified fresh with `find`, not by trusting the sixth-pass note's
prose: every test file this item ever named — `cli-honesty-sweep`, `cli-critic-ops-commands`,
`cli-task-probe-commands`, `runner-resource-bounds`, `runner-timeouts-retries`, `store-runtime-pin` —
has zero matches anywhere under `tests/unit/` and exactly one match each under `tests/integration/`,
confirming the sixth-pass account still holds and the lane-split is total, not partial. The sole
B35-named file still physically inside `tests/unit/**`, `tests/unit/packets/planner-packet.test.ts`,
was opened and run directly (`bun test tests/unit/packets/planner-packet.test.ts` — 5 pass, 0 fail,
154ms): it is the 48-line trimmed file the sixth pass already described, carries no `scriptsRoot` and
no timing-dependent assertion, and is not the file that ever held the race (that assertion lives in
`store-runtime-pin.test.ts`, itself already relocated to `tests/integration/`). Also re-opened
`orchestrating-long-tasks/scripts/src/runner/process-group.ts` directly: `wait(graceMs)` at lines
80/84/88 is still the identical bare `setTimeout`-based race the sixth pass cited — unchanged, still
awaiting the owner's pick of the three options below, and it is production source, not a test file, so
it sits outside `tests/unit/**` regardless of sign-off status.

Net effect of the scoping: **there is no file left under `tests/unit/**` for a `tests/unit/**`-scoped
pass to change.** Every load-sensitivity fix this item ever asked for was already made (bounded-poll
`waitForProcessExit`, the `processSnapshot` `ps`-retry, the frozen-copy/injected-hook determinism in
`planner-packet.test.ts`/`store-runtime-pin.test.ts`) before the same-day lane split moved the fixed
files out of `tests/unit/` — so this pass changed nothing, on purpose, rather than reaching into
`tests/integration/**` (a sibling wave's repair-in-progress lane) or making the owner's grace-race
design choice unasked. The item stays `queued` on exactly the same two things the sixth pass left open,
neither of which a `tests/unit/**`-scoped pass can touch: the `process-group.ts` owner decision, and the
one residual load-only flake, now living in `tests/integration/runner-timeouts-retries.test.ts`.

**Still queued 2026-08-20 (reconciliation pass, sixth pass — paths corrected, substance unchanged).**
Every file this item names below still exists and still passes exactly as described, but a same-day
lane-split commit (`5869023`, "test: split the lane by nature and cut unit runtime from 85s to 13s")
moved every one of them from `tests/unit/` into `tests/integration/` under new names — verified by
opening each at its new path, not by trusting the old citation: tests/unit/cli/honesty-sweep.test.ts
-> `tests/integration/cli-honesty-sweep.test.ts`; critic-ops-commands.test.ts ->
`tests/integration/cli-critic-ops-commands.test.ts`; task-probe-commands.test.ts ->
`tests/integration/cli-task-probe-commands.test.ts`; tests/unit/runner/resource-bounds.test.ts ->
`tests/integration/runner-resource-bounds.test.ts` (the `waitForProcessExit` calls are still at lines
147/186, unchanged); `runner-timeouts-retries.test.ts` -> `tests/integration/runner-timeouts-retries.test.ts`
(still at lines 216/233 and 209/226); tests/unit/store/runtime-pin.test.ts ->
`tests/integration/store-runtime-pin.test.ts` (the cited assertion is still its own line 89, word for
word). `tests/unit/packets/planner-packet.test.ts` itself was NOT just moved: it now holds a smaller,
48-line file covering only `initializePlannerPacket`'s basic contract, with no `scriptsRoot` in it
anywhere (`grep -c scriptsRoot` -> 0); the frozen-copy race-fix comment this item describes lives at
`tests/integration/packets-planner-packet.test.ts` instead (confirmed by opening it: the same
`liveScriptsRoot`/`beforeAll`-frozen-copy comment is there, just renamed and relocated). Re-ran the
corrected set directly — `bun test tests/integration/cli-honesty-sweep.test.ts
tests/integration/cli-critic-ops-commands.test.ts tests/integration/cli-task-probe-commands.test.ts
tests/integration/runner-resource-bounds.test.ts tests/integration/runner-timeouts-retries.test.ts
tests/integration/store-runtime-pin.test.ts tests/unit/packets/planner-packet.test.ts` — every test this
item names by its own quoted title still passes; the `process.kill`/`waitForProcessExit` sites and the
runtime-pin race assertion are all still fixed as described. The wall-clock grace race this item stays
open on is also unchanged, read directly just now: `runner/process-group.ts`'s `wait(graceMs)` (lines
80/84/88) is still the same bare `setTimeout`-based race, so the owner design decision below is still
live and still nobody's called it. **Separately, and not this item's own claim:** the same corrected
files also surfaced 11 unrelated, currently-real failures in `cli-honesty-sweep.test.ts`/
`cli-critic-ops-commands.test.ts`/`cli-task-probe-commands.test.ts` from a newer, same-day requirement
(`assertGateProofFalsifiable`) that the shared integration fixture was never updated to satisfy — filed
as a new item alongside this reconciliation pass, not a defect in what B35 itself claims.

**Still queued 2026-08-20 (fifth pass, re-confirmed fresh, nothing changed).** Independently re-opened
every file this item and the prior pass name, rather than trusting either note:

- tests/unit/cli/honesty-sweep.test.ts (360 lines), critic-ops-commands.test.ts (350),
  task-probe-commands.test.ts (155) — all under the 495-line working cap, no `.skip`/`.todo` markers
  (paths as they existed at this pass, before the same-day `5869023` lane-split moved them; see the
  sixth-pass note above for their current locations).
- All four `process.kill(pid, 0)` sites (`resource-bounds.test.ts:147,186`,
  `runner-timeouts-retries.test.ts:216,233`) now go through the bounded-poll helper exported by
  `tests/unit/runner/run-command-fixture.ts`, not an instant absence check.
- The two production races the prior fix traced past the test layer are both still in place:
  `settleAndTerminateAttempt` (`runner/attempt-failure-cleanup.ts`) bounded-polls descendant/root
  absence instead of checking once right after SIGKILL; `processSnapshot` (`runner/process-tree.ts`)
  retries a failed `ps` spawn up to 3 times with a 20ms delay before hard-failing.
- The specific race this pass was asked to check by name — "`planner-packet.test.ts` 'runtime source
  changed while it was being copied' race in its own file-copy window" — turned out to be filed under a
  different test: the assertion string lives in `tests/unit/store/runtime-pin.test.ts:89`, and
  `planner-packet.test.ts` is the file whose own comment (lines 15-20) explains why and how it was made
  deterministic — a private, frozen-once-in-setup copy of the scripts tree (`scriptsRoot`) that nothing
  but the test file itself ever touches, closing the exposure window entirely rather than tolerating it.
  runtime-pin.test.ts's own version of the same assertion is likewise not a race at all: it uses an
  injected `beforeRuntimeSourceRecheck` hook to deterministically mutate the source file inside the
  copy-then-recheck window on demand, never relying on real timing. Both were already fixed before this
  pass; there is no remaining flaky race under either file. `bun test
tests/unit/cli/honesty-sweep.test.ts tests/unit/cli/critic-ops-commands.test.ts
tests/unit/cli/task-probe-commands.test.ts tests/unit/runner/resource-bounds.test.ts
tests/integration/runner-timeouts-retries.test.ts tests/unit/store/runtime-pin.test.ts
tests/unit/packets/planner-packet.test.ts` — 54 pass, 0 fail, run this pass.

**What actually keeps this item open, and why it was not touched this pass:** the one residual,
load-only flake in `runner-timeouts-retries.test.ts`'s "kills TERM-resistant descendants after a
cooperative leader exits" (reproduces only at ambient load ~300+ on a 10-core box, traced to real
CPU-scheduler starvation of the wall-clock `graceMs`/idle-timeout windows, not a fixable test
assumption — an untouched, pre-existing idle-timeout test fails the same way at the same load). Fixing
it for real means replacing a wall-clock-based readiness signal in the runner's watchdog/grace-period
path with something starvation-independent, which is an actual design choice with more than one
reasonable shape, not a one-line correction:

1. **Do nothing / accept at this load level** — the flake only manifests well past any load this repo's
   own CI or interactive use produces; document the load threshold and move on.
2. **Event-driven descendant reaping** — replace the `setTimeout`-based grace race
   (`runner/process-group.ts`'s `wait(graceMs)` / `runner/descendant-tracker.ts`) with a signal that
   fires on the child's actual `exited` promise settling under contention, removing the fixed-delay
   assumption rather than lengthening it.
3. **Load-aware skip** — detect load average at test start and skip (not widen) the specific assertion
   above a documented threshold, so the test suite stays honest about what it can assert at extreme
   contention instead of asserting something the scheduler cannot guarantee.

This is exactly the class of decision the standing rule reserves for the owner ("when a fix has a real
design choice, write a 2-3 option plan and wait for `go` before touching code") — so it stays `queued`
on that one sub-item rather than being silently resolved either by a code change or by a tag flip.

**Observed 2026-08-20 at the Wave 9 push gate.** These pass 10/10 in isolation and fail under
`bun test --parallel` on a loaded machine:

- tests/unit/cli/honesty-sweep.test.ts — "command-recorded carries the argv and the exit
  code, not an empty payload" (the Wave 9 push gate note named a
  tests/unit/runner/command-recorded-payload.test.ts that does not exist; the verifier that closed
  this item confirmed by opening the suite that the test lives here instead)
- tests/unit/cli/critic-ops-commands.test.ts — "request_changes without findings is refused rather than
  synthesized"
- tests/unit/cli/task-probe-commands.test.ts — "refuses a sign-off while the recorded gate run exited
  non-zero"
  (paths as of the Wave 9 push gate; all three moved to `tests/integration/` under the `5869023`
  lane-split — see the sixth-pass note above for their current locations)

Each takes ~2.5-2.9s and drives the real CLI against a temp capsule, so the likely cause is the same class
B11.1 fixed: a wall-clock or filesystem assumption that holds on an idle machine. B11.1 fixed two files and
swept for `process.kill` and module-load clocks; it did not cover assertions whose timing depends on how
long a subprocess takes to complete under contention.

Fix them the way B11.1's were fixed — reproduce the failure deliberately (its verifier reconstructed the
frozen window and demonstrated the refusal), then remove the timing assumption rather than widening a
timeout. A widened timeout hides the race; it does not remove it.

Also carried from Wave 8's verifier and still open:

- Four `expect(() => process.kill(pid, 0)).toThrow()` assertions issued immediately after SIGTERM to a
  non-child process (`resource-bounds.test.ts:144,179`, `runner-timeouts-retries.test.ts:209,226`).
  Reaping is not synchronous. A bounded poll keeps the discrimination and removes the race.
- The file-size cap counts the trailing empty element, so the effective limit is 499, not 500. Every file
  is already calibrated to that, so correcting it silently grants one extra line everywhere — wants an
  explicit decision.
- Three test files exceed the cap (851, 881, 692 lines), all written by Wave 9 agents. They need splitting
  along a real seam by whoever owns that area.

**Verified fix.** The three named CLI tests and the four `process.kill(pid, 0)` assertions were closed by
adding a bounded-poll waitForProcessExit helper (`tests/unit/runner/run-command-fixture.ts`) in place of
an instant absence check, and by fixing two deeper production races the same reproduction work surfaced:
`settleAndTerminateAttempt` (`orchestrating-long-tasks/scripts/src/runner/attempt-failure-cleanup.ts`) now
bounded-polls descendant/root absence instead of checking once right after SIGKILL, and `processSnapshot`
(`orchestrating-long-tasks/scripts/src/runner/process-tree.ts`) now retries its `ps` spawn, which was the
actual root cause of the critic-ops-commands.test.ts flake (an unclassified `ps` spawn failure, not a
timing assumption in the test itself). One residual, load-only flake remains open in
`tests/integration/runner-timeouts-retries.test.ts`'s "kills TERM-resistant descendants after a
cooperative leader exits" — reproduced directly at ambient load ~300+ on a 10-core box (roughly 1-in-6
runs), traced to literal CPU-scheduler starvation rather than a fixable test assumption, since an
untouched, pre-existing idle-timeout test fails the same way at the same load. Needs owner sign-off to
accept at that load level, or a follow-up item for a wall-clock-independent readiness signal.

---

## B36 — B30's research landed unevenly: the coordinator's own role contract still hardcodes `invoke_subagent`, and `host-adapters.md` is spliced, not merged `verified`

**Re-confirmed 2026-08-20 (this reconciliation pass, opened fresh again, independent of the "verified"
paragraph directly below).** A separate report reaching this pass claimed `run-playbook.md`,
`host-adapters.md` and `parity-matrix.md` were "still unfixed," contradicting the tag already on this
item. Checked mechanically, not by re-reading either account: `grep -n invoke_subagent
references/run-playbook.md` returns **zero** hits; `grep -n '^## ' references/host-adapters.md` returns
`## 1. Two-Tier Agent Architecture`, `## 2. Milestone-Only Notification Protocol`, `## 3. Host Adapters`,
`## 4. Silent Worker Recovery & Heartbeats` — sequential, no gap at 3; `grep -n 'Agent Teams /
teammates' references/parity-matrix.md` returns **zero** hits, and its Claude Code row now reads `Native
(\`Agent\` tool)`/`Concurrent \`Agent\` tool calls`/`Nested \`Agent\` tool calls`, matching
`host-adapters.md`'s adapter table exactly. All three claims in the "still unfixed" report are false as
of right now; the `verified` tag below is correct and the stale claim is not this file's own current
text — it survives only inside the "Superseded note" blocks further down, each already labelled as such.
No tag change needed. This confirms the general pattern this reconciliation pass exists to catch: a
report describing this item, not the item's own current text, had drifted from disk.

**Verified 2026-08-20 (reconciliation pass, same day, minutes after the "Net: 2 of 4" note below —
the situation kept moving under this pass and this is the freshest read):** a second wave of concurrent
edits landed all three of the remaining work items while this exact item was being reconciled. Re-opened
every artifact fresh, not trusting the "2 of 4 done" count directly below, which is now itself stale:

- `references/run-playbook.md:75-84` no longer has the bare `invoke_subagent({...})` block; it now reads
  "Whatever the host, dispatching one agent means the same abstract contract... The concrete call — its
  name, shape and argument fields — is a per-host fact, never a rule: read `host-adapters.md`'s adapter
  table," pointing at the same abstraction `coordinator.yaml` already carries. B36.1 fully done.
- `references/host-adapters.md` now reads `## 3. Host Adapters` with `### 3.1` through `### 3.5` as
  genuine subsections, coherent with the pre-existing `## 1`/`## 2`/`## 4` — the missing "3" is filled,
  not just renumbered around. B36.2 done.
- `references/parity-matrix.md`'s "Tiered orchestration"/"Paired continuous dispatch"/"Sub-agents for
  branch sub-tasks" rows for Claude Code now read `Native (`Agent` tool)` / `Concurrent `Agent` tool
calls` / `Nested `Agent` tool calls` — matching `host-adapters.md`'s adapter table exactly instead of
  contradicting it. B36.3 done.
- A new mechanical check exists and is wired in: `health/vendor-prose.ts`'s
  `scanProseForUnqualifiedDispatch`/`scanTreeForUnqualifiedDispatch`, registered as the `vendor-prose`
  health check (`health/index.ts`, `health/types.ts`) and titled "Unqualified host-dispatch calls in docs
  and role contracts" in the harness's own output. It sweeps `.md`/`.yaml` under the skill root — exactly
  B36.4's ask — judging qualification by paragraph or, in Markdown, the nearest heading above it, so an
  adapter-table row naming its host still passes while a bare "this is the shape of the call" block does
  not. Running `bun orchestrating-long-tasks/scripts/harness.ts health --consumer ../gvui --all` just now
  shows this check at **0 failures, 0 advisories, 1 inspected** — the whole skill root is clean.
  `tests/unit/architecture/vendor-prose.test.ts` — including a test that reinjects "the exact two
  regressions this item names, reproduced verbatim... from `git log -p`" and asserts the check catches
  them — 7/7 pass, confirming the guard is load-bearing rather than vacuously green. B36.4 done.

Reachable: the check is wired into `ALL_CHECKS` and runs by default, not an opt-in nobody invokes. Does
what was asked: it names the exact defect shape (a host's dispatch call given as "the shape of the call"
with no host named in reach) and the exact two prior regressions, not a looser proxy. Guard holds: the
test suite itself reinjects those two regressions against scratch strings and asserts the check fails on
them, which stands in for the delete-and-confirm-failure bar without touching the live files another wave
was still editing. All four work items plus B36.5's inherited items are done. Item closes.

**Superseded note, correct as of its own moment but stale within minutes — kept for the record, not to
be read as current.** It was itself a correction to an even earlier note on B36.1's `coordinator.yaml`
half, and reads from here on exactly as originally written: Opened `agents/coordinator.yaml` fresh:
`grep -n invoke_subagent agents/coordinator.yaml` returns nothing. The "Phase 2: Continuous Dispatch"
block B36.1 quoted has been replaced — it now reads "The concrete tool that does this — its name, call
shape and argument fields — is a per-host fact, never a rule: read `references/host-adapters.md`'s
adapter table for the one your host actually exposes before dispatching anything," which is exactly the
abstraction B36's work item 1 asked for. This is the concrete instance of the drift this reconciliation
pass exists to fix: a wave applied part of B36's fix and the backlog's own status note kept asserting
the pre-fix state as current.

**What is still genuinely true, re-checked directly rather than carried over:**

- `references/run-playbook.md:81` still opens with a bare `invoke_subagent({ Subagents: [...] })` block
  under "this is the shape of the call," unqualified — B36.1's `run-playbook.md` half is unfixed.
- `references/host-adapters.md`'s heading numbers still show the same spliced seam B36.2 named:
  `## 1. Two-Tier Agent Architecture`, `## 2. Milestone-Only Notification Protocol`, then five
  unnumbered new sections (`## The abstract contract` through `## Declaring capability, and degrading
honestly`), then `## 4. Silent Worker Recovery & Heartbeats` — section "3" still does not exist
  anywhere in the file. B36.2 is unfixed.
- `references/parity-matrix.md`'s "Tiered orchestration" row still lists Claude Code's dispatch as
  `Native (Agent Teams / teammates)`, while `host-adapters.md`'s own adapter table (same B30.5 research)
  lists Claude Code's dispatch as the `Agent` tool and describes Agent Teams separately as an
  experimental messaging channel, not the dispatch mechanism. The two docs a coordinator is routed to
  together still disagree. B36.3 is unfixed.
- `tests/unit/architecture/vendor-scanner.test.ts` (new since B36 was written) still explicitly asserts
  `.md` files are out of scope — its own "files the scan does not cover are left alone" test feeds a
  `.md` file containing `PlaywrightMetadata` and asserts zero findings. B36.4's gap is unfixed and is
  now pinned down by name in a test, not just observed.
- B36.5's own two asks were already correct in this file before this pass and remain correct: B13 is
  tagged `done (eaabd5c), verified` above (not `queued`), and B30's blocker note (below) no longer claims
  a `references/**` ownership block — both already updated by whoever picked them up, exactly as B36.5
  asked. No further action needed on B36.5.

Net: 2 of B36's 4 concrete work items (1's `coordinator.yaml` half, and 5 as inherited from B36.5) are
done; run-playbook.md, host-adapters.md's numbering and parity-matrix.md's contradiction (work items 1's
other half, 2 and 3) are not; work item 4 (extend the vendor check to `.md`/`.yaml`) is not. Item stays
`queued` on that remaining scope — B30 does not close until this does (see B30).

**Superseded note, re-confirmed still queued 2026-08-20 (completion-tagging pass) — kept for the
record, not to be read as current:** grepped `invoke_subagent` in both
named files directly, again — still hardcoded, unqualified, at `agents/coordinator.yaml:103` and
`references/run-playbook.md:81`, exactly as B36.1 describes. Not fixed.

**Verification pass, 2026-08-20 — opened every artifact named below directly; nothing here is inferred
from a doc describing what should be true.** B30 (`research-in-flight`) recorded five hosts' real
dispatch mechanisms and stated the fix plainly: "`invoke_subagent` belongs in an adapter row, never in a
rule." That has been applied to two of the four files B30 named as offenders, and not to the other two —
including the one file every coordinator is actually told to read as its binding contract.

### B36.1 The role contract itself still fails B30.1

`SKILL.md`'s own routing table sends a coordinator to `roles/coordinator.md` **+**
`agents/coordinator.yaml`, plus `references/run-playbook.md` and `references/host-adapters.md`, before it
does anything. Opened all four:

- `orchestrating-long-tasks/agents/coordinator.yaml:103` — "Phase 2: Continuous Dispatch" gives
  `invoke_subagent({ Subagents: [...] })` as "this is the shape of the call," unqualified, with no mention
  that this is one host's tool name and no equivalent shown for any other host.
- `orchestrating-long-tasks/references/run-playbook.md:75` — same block, same lack of qualification, same
  "this is the shape of the call" framing.
- Both are exactly the shape B30 was opened to fix: a coordinator running under Claude Code, Cursor, or
  Codex — three of the four hosts B30.5 itself researched — is instructed, inside its own role contract,
  to call a tool namespace that does not exist there.
- By contrast, `orchestrating-long-tasks/docs/04-multi-agent/01-host-agnostic-architecture.md:88` already
  gets this right: its `invoke_subagent` mention sits under a `### 1. Google Antigravity` heading,
  correctly scoped as one host's mechanism among several sibling headings. That file was not the problem;
  `coordinator.yaml` and `run-playbook.md` are.

### B36.2 `host-adapters.md` was edited, not rewritten, and the seam shows

`orchestrating-long-tasks/references/host-adapters.md` (10,075 bytes, touched 2026-08-20) now contains a
genuinely correct "The abstract contract" section and a four-host "Adapter table" reflecting B30.5's
research verbatim (Claude Code's `Agent` tool, Codex's `spawn_agent`, Cursor's `Task` tool, alongside
Antigravity's `invoke_subagent`). But the document's own heading numbers prove it was spliced onto the
pre-B30 file rather than replacing it:

```
## 1. Two-Tier Agent Architecture         <- pre-existing, Antigravity-flavoured
## 2. Milestone-Only Notification Protocol <- pre-existing
## The abstract contract                   <- new, unnumbered
## Adapter table                           <- new, unnumbered
## Native primitives worth using instead of rebuilding   <- new, unnumbered
## Constraints that change how a run must be driven      <- new, unnumbered
## Declaring capability, and degrading honestly           <- new, unnumbered
## 4. Silent Worker Recovery & Heartbeats  <- pre-existing
```

Section "3" does not exist anywhere in the file — direct, visible evidence of an uncoordinated merge, not
a red herring. This is the exact collision B30.4 flagged in advance ("Application is BLOCKED on Wave 8's
B13, which currently owns `references/**`"): something wrote the new material into this file without
reconciling it against the old numbering.

### B36.3 The two updated docs now contradict each other

`references/parity-matrix.md`'s "Tiered orchestration" row lists Claude Code's dispatch as `Native (Agent
Teams / teammates)`. `references/host-adapters.md`'s own adapter table — written from the same B30.5
research — lists Claude Code's dispatch as the `Agent` tool, with Agent Teams described separately, three
sections later, as an experimental **messaging** channel (`~/.claude/teams/<team>/inboxes/<agent>.json`),
not the dispatch mechanism. Two reference docs a coordinator is routed to in the same breath (SKILL.md's
routing row lists both together) disagree about which tool actually starts an agent on Claude Code.

### B36.4 Nothing mechanical catches any of this

`tests/unit/architecture/vendor-identifiers.test.ts` and `tests/unit/health/vendors.test.ts` — the only
two vendor-name guards in the repo — both scan `.ts` source under `orchestrating-long-tasks/scripts` and
`tests` only. Neither reads `.yaml` or `.md`. An unqualified vendor tool name sitting in a role contract's
prose is invisible to both, which is how this survived a full "research-in-flight" cycle undetected.

### B36.5 B30.4's stated blocker is stale

B30.4 says application is "BLOCKED on Wave 8's B13, which currently owns `references/**`." B13 (SKILL.md
as an index, target under 150 lines) is still marked `queued` in this file, but
`orchestrating-long-tasks/SKILL.md` is already 147 lines / 12,313 bytes — under B13's own target, down
from the 604 lines / 38,537 bytes B13 measured when it was opened. Something has already reshaped
`SKILL.md` without B13's status changing. Whoever next picks up B13 should verify current state with
`wc -l` before treating it as unstarted work, rather than rewriting something already substantially done;
and whoever next picks up B30 should treat the `references/**` block as at least partially lifted, since
material was already written there despite the note.

### Work to do

1. Replace the bare `invoke_subagent({...})` block in `agents/coordinator.yaml` and
   `references/run-playbook.md` with the abstract dispatch description `host-adapters.md`'s "abstract
   contract" section already models — the tool name moves into the adapter table, out of the rule.
2. Fix `host-adapters.md`'s heading numbers so the document reads as one artifact: either renumber
   sections 1/2/4 to sit coherently with the new material, or drop numbering entirely now that headings
   are descriptive.
3. Reconcile `parity-matrix.md`'s Claude Code dispatch cell against `host-adapters.md`'s adapter table —
   per B2/B4's own rule, one fact, one home; point one document at the other rather than keeping two
   independently-maintained descriptions of the same mechanism.
4. Extend the vendor-identifier check (or add a sibling check) to sweep `.md`/`.yaml` prose for an
   unqualified vendor tool name outside an adapter table/row — the gap in B36.4 is exactly the shape of
   defect B8.5 asks every fix to close with a structural test, not a one-line edit.
5. Correct B30.4's blocker note and B13's status once whoever owns each has confirmed current state by
   opening the files, not by trusting this item's account of them either.

---

## B37 — Findings from the first post-implementation verification pass `queued`

**Still queued 2026-08-20 (completion-tagging pass):** 12 of the 13 findings below are now resolved —
this pass independently re-confirmed and dated findings 2, 3, 4, 5, 6 and 9, which were fixed but never
annotated `RESOLVED` like their siblings (see the inline notes added to each below). Finding 13 is
still open: the health run's own "Literal fallbacks" section states outright "the consumer repository
was not swept for fallbacks; only the harness source was" — confirmed directly, the sweep has still
never been extended to gvui.

**Still queued 2026-08-21 (triage pass, B37 itself):** every one of the 13 findings re-opened and
re-checked from scratch this pass, tree-side, not by trusting the notes above — same verdict as
2026-08-20 on all 13, so the item's own tag stays `queued`.

- Findings 2-9, 11, 12 (8 findings): each `RESOLVED` note re-verified directly against the cited
  file/line/test today. `health/allowlist.ts:140` still reads `if (allowance.check !== check) return
  false;`. `contracts/workflow.ts`/`begin-validation.ts` still derive the domain via
  `applicableValidatorDomains`/`resolveDomain`. `references/protocol.md:295` still states "Σ(validators
  per task)...". `references/run-playbook.md` still opens with the `orchestrate`-first pointer.
  `store/layout-integrity.ts`'s `verifyCapsuleLayout` still calls `packetLayout`/`commandLayout`.
  `scripts/src/cli/prompt-input.ts`'s `shouldAutoReadOrchestrateStdin` still gates on
  `process.stdin.isTTY === true` and is still wired into `harness.ts main()`. `gvui`'s
  `fixture-demo.json` still carries 13 nodes / 19 edges / the same 11 edge kinds, and
  `gvui/scripts/asset-portability.ts` + its `import-capsule.ts:343` call site are both still present.
  Re-ran the actual test files rather than trusting the prior pass's counts: `bun test
  tests/unit/workflow/review/multi-domain-validation.test.ts
  tests/unit/workflow/review/checklist-coverage.test.ts` (19 pass), `bun test
  tests/unit/cli/orchestrate-command.test.ts tests/unit/cli/arguments.test.ts` (38 pass — grown from
  the 33 the 2026-08-20 note cited, still 0 fail), `bun test tests/unit/store/layout-integrity.test.ts`
  (35 pass), and in `gvui`, `bun test src/types/graphData.test.ts scripts/import-capsule.test.ts` (17
  pass, matching the prior note exactly). None of B37's own cited test paths were touched by the
  `tests/unit/**` → `tests/integration/*` rename QUEUE.md's item #18 flags — checked each path exists
  at the location the note names it.
- Finding 1 (stale generated docs): re-ran `bun orchestrating-long-tasks/scripts/generate-cli-manifest.ts`
  against the committed tree — HEAD (`c5fccfb`) is unchanged since `6256159` last regenerated it, and
  running the generator against a clean checkout still produces zero diff. Note for whoever reads this
  next: the live working tree *right now* is mid-edit by concurrent siblings touching exactly the files
  this finding is about (`critic-ops.ts`, `plan-validate.ts`, `task-ops.ts`, `registry/plan.ts`,
  `registry/task.ts`, a new `task:abandon` command, a new `coordinator:pushback` command), so running
  the generator against the dirty working copy right now does produce a diff again. That is expected
  concurrent-development churn, not a reopened finding — this item's own original text already assigns
  the regeneration to "whichever item owns critic-ops.ts", and the two generated files were left
  untouched here (reverted back to HEAD after the check, `git status` confirms clean).
- Finding 10 (the irony finding, re-checked with particular care): the "Conventions for this file"
  section does now define the Status key precisely as the resolution note describes —
  `` `done (<short-sha>)` ``, `verified`, their composition, `deferred by owner`, and — the part that
  answers this finding's actual complaint — an explicit rule that "once tagged `done`, an item is
  closed: it does not get re-planned or re-dispatched by the autonomous loop, only reopened by a fresh,
  named finding," plus a composite-item rule stating a container's tag is "the least-resolved of
  everything the item still lists," naming B37 itself as a live example of that rule ("open only on
  finding 13"). This is not just a claim: the convention is visibly in force throughout the file — every
  `queued`/`done (<sha>)`/`done (<sha>), verified`/`verified` tag read directly off `grep -n "^## B"`
  above carries it, and this very item is being kept `queued` by that same rule rather than closed on
  the strength of its 12 resolved findings. Genuinely resolved.
- Finding 13 (still open): re-ran the real command myself, not the prior pass's transcript — `bun
  orchestrating-long-tasks/scripts/harness.ts health --consumer ../gvui --all` — and its "Literal
  fallbacks" section's "Cannot check" list still reads, verbatim, "The consumer repository was not
  swept for fallbacks; only the harness source was." Confirmed unchanged from the 2026-08-20 note.
  Tracked as QUEUE.md #20.

**Net for this pass: 12/13 fixed, 1/13 (finding 13) still real, 0/13 obsolete.** No fix applied here —
this item's owner is triage-only per its own dispatch note.

**The rule worked.** A read-only pass over items marked done produced 13 findings that nothing else caught.
This is the record of what verification uncovered; each is queued as work in its own right.

1. Stale generated docs: `bun orchestrating-long-tasks/scripts/generate-cli-manifest.ts` produces a diff against the committed `references/cli-capabilities.md`/`.json` for `critic:start --repository-command-ids` (repeatable: false->true, description text differs) -- source (critic-ops.ts) was edited after the reference docs were last generated, by a different concurrent item, not this one. Also correlates with the health check's 'declared but unenforced' finding on the same flag. Regenerate and reconcile as part of whichever item owns critic-ops.ts.
   **RESOLVED, verified 2026-08-20:** re-ran `bun orchestrating-long-tasks/scripts/generate-cli-manifest.ts` directly and it now produces zero diff against the committed `references/cli-capabilities.md`/`.json` — a later commit already regenerated them (`git log -1` on `references/cli-capabilities.json` points at `6ab09b7`, "fix: diagnose subprocess timeouts and extend validator report coverage"). `tests/unit/cli/manifest.test.ts` asserts byte-identity and passes.

2. Harden health/allowlist.ts's applyAllowances(): matches() should also require allowance.check === the HealthCheckResult.check being filtered, not just an entry.key string match, so an allowance can never cross-suppress a finding in a different check category even if key formats ever collide.
   **RESOLVED, verified 2026-08-20 (completion-tagging pass):** `health/allowlist.ts:135-144`'s `matches()` now reads `if (allowance.check !== check) return false;` before the key comparison, with a comment stating exactly this rationale — read directly from the file.

3. B12.2 multi-validator sizing: change task.validation from a singleton to a per-domain collection in workflow/review/begin-validation.ts and workflow/review/record-review.ts (plus contracts/workflow.ts), with completion logic requiring every applicable domain to pass before a task reaches the terminal 'validated' state, rather than the first passing validator terminating the task.
   **RESOLVED, verified 2026-08-20 (completion-tagging pass):** `contracts/workflow.ts` carries a comment naming "a task's per-domain validation collection"; `begin-validation.ts`'s `resolveDomain` derives the domain from `applicableValidatorDomains(writeScope)` and refuses a domain already open, and `tests/unit/workflow/review/multi-domain-validation.test.ts` (added in commit `1f302d2`/`ecb5536`) exercises it directly.

4. B12.2 domain derivation: replace or supplement the optional --validator-domain CLI flag with a derivation helper that maps a task's write_scope (file extensions/paths) to the applicable validator domain(s), called from roles/coordinator.md's dispatch guidance so domain selection is a checkable rule, not agent memory.
   **RESOLVED, verified 2026-08-20 (completion-tagging pass):** `applicableValidatorDomains` (imported into `begin-validation.ts` from `contracts/workflow.ts`) is exactly this derivation helper, called by `resolveDomain` when `--validator-domain` is omitted — read directly from the file.

5. B12.2/B14 doc sync: update references/protocol.md's Triad Floor / Pairing Invariant section to state the Sigma(validators per task) sizing formula and drop the strict 1:1 pairing claim, so the entry-point protocol doc does not contradict the shipped design.
   **RESOLVED, verified 2026-08-20 (completion-tagging pass):** `references/protocol.md:295` reads "Σ(validators per task), where each task contributes as many validators as it has applicable" — read directly from the file.

6. B12.5 structured report shape: add checklist-coverage fields (checked-and-passed, not-applicable-with-reason, could-not-check-with-reason) to ReviewInput in workflow/review/validate-review.ts and contracts/workflow.ts, so an omitted checklist item becomes mechanically detectable instead of advisory-only prose in the role files.
   **RESOLVED, verified 2026-08-20 (completion-tagging pass):** `workflow/review/validate-review.ts` declares `ChecklistDisposition = "checked" | "not_applicable" | "could_not_check"`, `ChecklistCoverageEntry` (id, disposition, and a required `reason` for every non-`checked` disposition) and `ChecklistCoverageReport` (items + `adjacent_findings`), covered by `tests/unit/workflow/review/checklist-coverage.test.ts` — read directly from the file.

7. orchestrate still requires an explicit --prompt-stdin flag to read piped input, so B16's literal 'no flags to learn, no structure imposed on the user' promise is not actually met for the stdin path — confirmed by spawning the real CLI: a bare `prompt | bun harness.ts orchestrate --repo .` fails with INVALID_ARGUMENT. The gate lives in shared infra (scripts/src/cli/prompt-input.ts's shouldReadPromptStdin + harness.ts main()) used by every readsStdin command, including plan:init, whose own example already correctly includes --prompt-stdin. Needs a design decision before code changes, e.g.: (a) TTY-based auto-detection of piped/redirected stdin scoped to orchestrate only; (b) the same auto-detection applied uniformly to all readsStdin commands; (c) keep --prompt-stdin as a permanent, documented exception and drop the literal 'no flags' claim from B16/SKILL.md. tests/unit/cli/arguments.test.ts currently encodes the opt-in-flag contract, so whichever option is chosen needs that test updated deliberately, not silently. Write the 2-3 option plan and get a `go` before touching the shared gate.
   **RESOLVED, verified 2026-08-20:** option (a) landed — `shouldAutoReadOrchestrateStdin` in `scripts/src/cli/prompt-input.ts`, gated on `process.stdin.isTTY === true` (never on a flag) and wired into `harness.ts main()` alongside the existing `--prompt-stdin` path and B16's inline-argv capture (`extractOrchestrateInlinePrompt`). Prompt bytes still land at `prompt.md` via `capsule.ts`'s `atomicWriteBytes(..., { mode: 0o444 })`, unchanged. Confirmed by spawning the real entrypoint (not just calling `execute()`): `tests/unit/cli/orchestrate-command.test.ts` — "a bare pipe with no flags at all is read automatically" and "inline free text with no flags at all becomes the prompt" both spawn `bun harness.ts orchestrate` as a subprocess and pass; the pre-existing `--prompt-stdin` and `--repo`-collision regressions still pass alongside them. `bun test tests/unit/cli/orchestrate-command.test.ts tests/unit/cli/arguments.test.ts` — 33 pass, 0 fail.

8. references/run-playbook.md does not mention `orchestrate` at all, even though SKILL.md's new 'Primary entry point' section points readers there for phase-by-phase detail and tells them to reach for orchestrate 'before assembling this sequence by hand.' Add a short pointer at the top of run-playbook.md so the two docs agree on which is the preferred entry point for the common case.
   **RESOLVED, verified 2026-08-20:** `references/run-playbook.md` now opens with a paragraph naming `orchestrate` as the primary entry point (pointing back to SKILL.md), stating it runs Phase 1's capture-and-open for the caller and hands back the same checklist this file spells out phase by phase, and telling the reader to reach for it first. `tests/unit/contracts/skill-router.test.ts` — "the run playbook is the home for the phase-ordered command sequences" — passes.

9. Extend verifyCapsuleLayout (orchestrating-long-tasks/scripts/src/store/layout-integrity.ts) to close B2's INV-6 gap: verify packets/<id>/packet.md against the chain-recorded packet_sha256, and commands/<id>/record.json against state.commands, the same way blobNaming/captureReferences already verify blobs/ and captures.json.
   **RESOLVED, verified 2026-08-20 (completion-tagging pass):** `store/layout-integrity.ts`'s `verifyCapsuleLayout` now calls `packetLayout(runRoot, state)` and `commandLayout(runRoot, state)` alongside `blobNaming`/`captureReferences` — read directly from the file; landed in commit `7358837` ("fix: close capsule integrity gaps and sync generated references").

10. BACKLOG.md has no completion-tag convention: items verified genuinely done (B2, B5, and per B36.5's finding, B13) stay marked `queued` forever, causing rework and stale blocker claims. Decide and apply a consistent convention (a `done` tag, or removal to a changelog) so the orchestrating loop stops redispatching completed work.
    **RESOLVED, verified 2026-08-20:** the "Conventions for this file" section's Status key now defines `` `done (<short-sha>)` `` — landed and verified by opening the artifact the named commit produced, closed against re-dispatch. Applied to B2, B5 and B13, each citing the commit (`eaabd5c`) and the specific files/tests opened to confirm it, per B33.

11. No real capsule on this machine (checked gvui, skills, limo x11, memory-sync, .agents/skills) contains a branch section, a probe edge, or a tool record — so the shipped sample dataset, and any UI code that renders those, is only exercised against synthetic test fixtures, never a real recorded run. Track: regenerate/augment the shipped fixture once a real run produces branch/probe/tool data, or explicitly document that gap.
    **RESOLVED, verified 2026-08-20 (adversarial pass on B36-fixture-real-run):** opened both ends directly, not inferred. Producer: `.tmp/fixture-build/build-fixture.ts` (gitignored, 426 lines) drives the real harness via `execute()` — `plan:init/enhance/add/compile`, `agent:register`, an interleaved `task:claim` on task-alpha then task-beta (alpha claimed 15:23:49.567Z, beta claimed 15:23:58.901Z, alpha not submitted until 15:24:03.201Z — a genuine concurrent lease window, confirmed from the raw `events.jsonl`), `run:exec`/`task:submit`, `branch:open/claim/submit/collect`, a real `task:reject` -> `task:claim --role repairer` -> resubmit -> `task:probe` -> `task:review pass` round, and `critic:start`/`critic:review`/`run:complete`. Opened the scratch capsule the run actually produced at `.tmp/fixture-build/out/repo-un4FHB/.capsules/fixture-demo/` (`state.json`, `events.jsonl`, `packets/repairer-*/packet.md`) and confirmed real resolved findings, real timestamps, and a genuine repairer role-contract packet, not synthesized JSON. Reader: the exported `gvui/public/data/graphs/fixture-demo.json` (13 nodes / 19 edges / 11 distinct edge kinds — `branch, collect, dispatch, handoff, join, probe, pushback, sequence, signoff, spawn, validation`, counted directly from the file) is loaded and asserted by `gvui/src/types/graphData.test.ts`'s "The shipped dataset" suite (edge-kind resolution, join-edge treatment, node rendering with/without a role) and by `gvui/scripts/import-capsule.test.ts`; both ran clean (`bun test src/types/graphData.test.ts scripts/import-capsule.test.ts` — 17 pass, 0 fail).

12. The shipped fixture's asset URLs (screenshots) are absolute local filesystem paths under the producing machine's .capsules/ directory, which is gitignored. On any other developer's machine, or a static deploy, those thumbnails will 404 (the /api/assets?path= bridge that resolves them is dev-server-only). Track: either commit representative sample screenshots somewhere reachable, teach the importer to relativize/copy asset paths into the shipped bundle, or document the limitation where new contributors will see it.
    **RESOLVED, verified 2026-08-20 (adversarial pass on B36-fixture-real-run):** option (b) landed — `gvui/scripts/asset-portability.ts` (198 lines, new) walks only `node.assets[]`/`node.browserTests[]`, resolves each reference (absolute, capsule-relative, or repo-relative), copies resolved bytes under a content-hash name into the shipped dataset's own portable assets directory, and rewrites the reference to a root-relative `/data/graphs/<slug>-assets/...` URL; unresolvable references are reported, never silently dropped or fabricated. Wired at `gvui/scripts/import-capsule.ts:343` (`portabilizeAssetReferences(...)`) before the dataset is written, and the importer reports the rewrite count both as a `warnings[]` entry on the return value and via `console.warn` in the CLI's `main` block (`import-capsule.ts:350-354, 399-401`) — read directly, not inferred. Reader: `gvui/scripts/import-capsule.test.ts` (new, 266 lines) exercises copy+rewrite, hash-dedup of identical bytes under different original paths, already-portable references left untouched, and the honest-failure case (a referenced file that no longer exists is reported, not fabricated a path for) — `bun test scripts/import-capsule.test.ts` passes (part of the 17/0 run cited above). Caveat left open rather than hidden: the new fixture-demo.json itself carries no `assets`/`browserTests` (confirmed by reading the file — the scenario driving it never captured a screenshot), so the shipped artifact does not exercise this path end-to-end; the mechanism is proven by direct unit test against real files instead. A future fixture revision that adds a captured screenshot would close that last gap.

13. The repo-wide sweep for literal-fallback fabrication patterns (`?? 0`, `?? "pending"`, etc. — B8.5/B9.2's concern) was deliberately NOT run against the ~30 files currently mid-edit by other concurrent agents (CostTab.tsx, EdgeDetailDrawer, NodeCardFiles.tsx, and others under the provider/context-window/tool-category telemetry work). Needs a dedicated pass once that concurrent work lands.
    **Still open, re-confirmed 2026-08-20 (completion-tagging pass):** the named files have landed
    (`CostTab.tsx`, `EdgeDetailDrawer/`, `NodeCardFiles.tsx` all exist on disk now), but the sweep
    itself was still never extended to them — running the real `health --consumer ../gvui --all` command
    just now, its own "Literal fallbacks" section states "the consumer repository was not swept for
    fallbacks; only the harness source was." The dedicated pass this finding asked for has not happened.

---

## B38 — Findings from the second post-implementation verification pass `verified`

**RESOLVED 2026-08-21 (B38 closing triage pass) — all four findings now clear; item moves `queued` ->
`verified`.** Independently re-verified each of the four findings on disk today, not inherited from any
note below.

- **Finding 1 (git-spawn retry) — unregressed.** `git log --oneline -- .../repository-git-command.ts`
  shows the file last touched by `0a5a630` ("test: prove supervisor recovery and transient retry
  classification"); it still reads exactly as the existing `RESOLVED` note below describes
  (`GIT_SPAWN_TRANSIENT_RETRIES`/`GIT_SPAWN_TRANSIENT_RETRY_DELAY_MS` at lines 50-51, the retry loop at
  76/123/126). `bun test tests/unit/packets/repository-git-spawn-retry.test.ts` — 6/6 pass, run just now.
  Fixed, stays fixed.
- **Finding 2 (B32.2's own closure bar) — now fixed, superseding this item's "stays open on finding 2"
  line below.** B32's own 2026-08-21 entry ("B32/B20 ownership pass") closed B32.2 with a real dispatched
  run, leaving a capsule on disk at `.capsules/b32-b20-telemetry-proof-2026-08-21/`. Opened it directly
  rather than trusting B32's note: `state.json`'s `agents` array has 2 entries (`coordinator-1`,
  `aa49f062714f34399`); the implementer entry carries `tokens_in`/`tokens_out`/`tools_used`/`token_extras`
  all stamped `evidence_class: "harness_observed"`; and `summary/summary.md` renders "Agents granted | 2"
  (line 34) plus the tool-usage table (lines 178-180) and the harness's own evidence-class footnote (line
  221) — exactly the rendering this finding's own bar demanded. The gap this finding named (no capsule with
  a populated `agents` ledger from a real dispatched run) no longer exists.
- **Finding 3 (supervisor crash-recovery test) — unchanged, still no action needed.** Re-ran
  `tests/unit/orchestrator/supervisor.test.ts tests/unit/orchestrator/supervision-tick.test.ts` anyway —
  19/19 pass, same count already recorded below.
- **Finding 4 (health-check confirmatory note) — unchanged.** Not an actionable finding; nothing to close.

**Cross-check for duplicate findings, against B37 and B8 specifically, per this triage's own brief:** no
match. Neither `createRepositoryGitCommand`/`GIT_SPAWN_TRANSIENT_RETRIES` (finding 1) nor the supervisor
crash-recovery test (finding 3) appears anywhere in B37's or B8's text (grepped both sections directly).
The one real duplicate found is finding 2 against **B32.2** itself — the same gap tracked twice under two
ids. `coordinator-conformance/QUEUE.md` row 7 ("Telemetry points at the wrong reporter" | `B32 + B38` |
"Absorbs B38") already recognized this and merged the two for that document's own ranking; this note is
the matching closure on the BACKLOG.md side. No other cross-item duplicate found for this item's four
findings.

With all four findings settled and none reopened, this item meets the composite-item bar (every sub-part
clears) — `queued` -> `verified`.

**Still queued 2026-08-20 (reconciliation pass): independently re-run, item's own verdict holds, one
citation set corrected.** Finding 1: re-ran `tests/unit/packets/repository-git-spawn-retry.test.ts`
directly — 6/6 pass — and read `repository-git-command.ts` directly: `GIT_SPAWN_TRANSIENT_RETRIES`/
`GIT_SPAWN_TRANSIENT_RETRY_DELAY_MS` and the retry loop are still exactly as described (lines 50-51,
76, 123, 126). Finding 2: opened both named capsules' `state.json` directly, just now —
`skills/.capsules/2026-08-17-skills-documentation-elevation/` and
`gvui/.capsules/2026-08-17-gvui-documentation-elevation/` are still the only two capsules on either
machine, and neither has ever grown an `agents` key (checked the literal key set of both files: absent
in both). B32.2's bar is still unmet for the same reason it was unmet when this was written — no new
dispatched run has happened since. Item correctly stays open on this. Finding 3: re-ran
`tests/unit/orchestrator/supervisor.test.ts tests/unit/orchestrator/supervision-tick.test.ts` — now
19/19 pass (grew from the cited 14/14 as the same-day `6256159` commit added more cases to both files);
no regression, still no action needed. Finding 4 is a point-in-time confirmatory note and is now stale
on its own numbers (the health check reports differently today — see the new item filed alongside this
pass) but that does not reopen this finding, which only ever claimed the three findings above were
mechanically invisible to that check, which remains true. **Path correction (same `5869023` lane-split
commit that moved B35's citations):** the scope note's `bun test tests/unit/branch/budget.test.ts
tests/unit/branch/scope.test.ts tests/unit/agents/budget.test.ts` moved to
`tests/integration/branch-budget.test.ts tests/unit/branch/scope.test.ts
tests/integration/agents-budget.test.ts` (`scope.test.ts` alone did not move), and
tests/unit/branch/chain-recovery.test.ts — the file with the `SHORT_LEASE=5s` fixture this finding
names — is now `tests/integration/branch-chain-recovery.test.ts` (confirmed by grepping `SHORT_LEASE`:
present in the integration path, absent from `tests/unit/workflow/branch/chain-recovery.test.ts`, a
different, unrelated file that now sits at the old directory's new home). Re-ran the corrected set at
today's near-idle load (~6-8, not the ~350-365 this finding reproduced under): 17/17 pass, consistent
with the fix being real and the original failure being genuinely load-gated, not something this pass can
independently reproduce. **Separately, and not this item's own claim:** re-running the full
`tests/integration` lane surfaced 45 failing tests (of 815) from two same-day requirements
(`assertGateProofFalsifiable` in `pass-preconditions.ts`, `unboundTasksRefusal` in
`requirements/compiler.ts`) that the shared integration fixtures were never updated to satisfy —
including this item's own headline Dual-Channel Validator Protocol evidence
(`tests/integration/validation-dual-channel-wiring.test.ts`, now 1/5 passing, not the 23/23 this item
cites) and the integration-level supervisor-recovery test
(`tests/integration/orchestrator-supervisor.test.ts`, 2 failures, both in `plan:compile` setup before the
recovery logic under test ever runs). The supervisor's actual recovery mechanism is unaffected — the
unit-level `supervisor.test.ts` re-run above exercises it directly and still passes 19/19 — so this does
not reopen finding 3, but the integration-lane regression is real and current; filed as a new item rather
than fixed here.

**Still queued 2026-08-20 (completion-tagging pass):** finding 1 was fixed in the same commit that
recorded it (`0a5a630`) and now carries its own inline `RESOLVED` note (added by a concurrent pass on
this same file, commit `f23050d`, while this tagging pass was in progress) — re-confirmed here by
running `tests/unit/packets/repository-git-spawn-retry.test.ts` directly just now: 6/6 pass. Finding 2's
stated bar (a real dispatched run's capsule with a populated `agents` ledger) remains explicitly unmet
— see B32. Finding 3 was already self-resolving text needing no action. Finding 4 is a confirmatory
note only. Item stays open on finding 2.

**Scope note:** this pass prioritised the headline claims named for it — the Dual-Channel Validator on a
UI task, role contracts refusing an ungranted command, the probe blocking a pass, branch-and-collect
restoring a parent lease, telemetry reaching `graph.json` from a real run, the supervisor recovering —
plus every item not tagged `queued` at the time (B1, B30, B31). Per B33, every claim below was settled by
opening the artifact: reading the call site, running the real test, or — for the three guards checked most
closely — deleting the guard in an `rsync`ed scratch copy under `/tmp` (never the real tree), confirming
the test fails, and confirming `git status`/`git diff` show the real tree untouched afterward. Confirmed
genuinely reachable, correct and guard-holding this way: role-contract command enforcement (B8.1 —
`assertRoleMayInvoke`/`assertGrantedCommand`, wired into `cli/execute.ts` on every dispatch; deleting the
throw failed 12/53 tests in `role-contract-enforcement.test.ts`); the probe-blocks-a-pass guard
(`assertOpenFindingsAnswered` in `review-resolutions.ts`; deleting it failed 5/14 tests in
task-probe-commands.test.ts/`probe.test.ts`, several by hang rather than a clean assertion failure — the
guard is load-bearing enough that its absence corrupts later state, not just one check); and the
Dual-Channel Validator Protocol (tests/unit/validation/dual-channel-wiring.test.ts drives the real CLI —
`plan:init` through `task:review` — through five scenarios: full evidence pass, partial-viewport
DOM-only-gap-filled pass, refusal on zero evidence, refusal when a sibling task's evidence is reused, and a
non-UI task correctly left ungated; 23/23 pass, no guard-deletion needed given the negative assertions
already check the real refusal message). B1 (proper-subset scope, `max_agents`=100 in
`config/constants.ts`, `max_branch_depth`=5, gvui's `SECTION_AUTO_COLLAPSE_DEPTH`=2 with depth and reason
shown in section headers, `GraphGroupingLayer.test.tsx` 6/6 pass) was independently confirmed present,
wired and passing. B30/B36: re-opened `agents/coordinator.yaml` and `references/run-playbook.md` directly
— B36's finding is unchanged and still accurate, `invoke_subagent({` is still hardcoded unqualified in
both files; no new finding needed there. B31 (deferred by owner): confirmed untouched, no changes.

1. **The top finding of this pass — a single unretried `git` subprocess spawn is a point of failure on
   every role-grant's critical path, and it failed for real under this run's own concurrent-agent load.**
   `orchestrating-long-tasks/scripts/src/packets/repository-git-command.ts`'s `createRepositoryGitCommand`
   calls `spawnSync` once with no retry; when the spawn returns with no `status` and no `error` (observed
   directly, not inferred — a transient resource/fork failure under heavy concurrency), it throws
   `HarnessError("INTEGRITY", "repository Git command failed: unaccepted exit status unknown")` at line 95.
   This sits under `recordGrantInspections` → `inspectRepository` → `inspectRepositoryGitControls` →
   `gitDirectory`, which every `publishRolePacket` call runs (`role-grant.ts:89`) — i.e. it is on the path
   of `task:claim`, `branch:open`, `branch:claim`, `task:validate-start` and `critic:start`, essentially
   every role grant in the system. Reproduced directly and repeatedly on this machine while other agents in
   this same run were active (`uptime` showed load averages ~350-365 on 10 cores, ~22 concurrent `bun`
   processes): `bun test tests/unit/branch/budget.test.ts tests/unit/branch/scope.test.ts
tests/unit/agents/budget.test.ts` — 8/17 fail, all with the identical stack through
   `repository-git-command.ts:95`; tests/unit/branch/chain-recovery.test.ts fails the same way (its own
   SHORT_LEASE=5s fixture window (a test-local constant, not a production symbol) is separately tight
   enough that a depth-3 chain's setup — 3×`branch:open`
   - 3×`branch:claim`, each doing 2 git-spawn inspections — can outrun 5 real seconds before the intended
     dead-agent scenario even begins). `orchestrating-long-tasks/scripts/src/runner/process-tree.ts` already
     has the fix pattern for exactly this shape (`SNAPSHOT_SPAWN_RETRIES`, added closing B35's
     critic-ops-commands.test.ts flake) — `repository-git-command.ts` was never given the same treatment.
     This directly threatens B28's "unattended overnight run" contract and sits precisely in B27's stated
     operating regime (many concurrent agents): a transient hiccup during a busy run currently aborts a role
     grant outright rather than retrying. Fix: give `createRepositoryGitCommand` the same bounded-retry
     treatment `processSnapshot` already has, and sweep for any other single-shot `spawnSync` or execSync
     call (Node's own child_process API, not a symbol defined in this repo) reachable from a role-grant
     or lease path.
     **RESOLVED, verified 2026-08-20:** `createRepositoryGitCommand` (`repository-git-command.ts:106-114`)
     now retries on the exact `isTransientSpawnFailure` shape (status===null, error===undefined, empty/absent
     stderr) up to `GIT_SPAWN_TRANSIENT_RETRIES`=3 times with a `GIT_SPAWN_TRANSIENT_RETRY_DELAY_MS`=20ms
     delay between attempts, the same bounded-retry shape `process-tree.ts`'s `SNAPSHOT_SPAWN_RETRIES`
     already uses for `ps`; a real git failure (non-zero status, an error object, or any stderr text) is
     still never retried. `tests/unit/packets/repository-git-spawn-retry.test.ts` (new, 6 tests) proves both
     directions: `bun test tests/unit/packets/repository-git-spawn-retry.test.ts` — 6 pass, 0 fail. Guard
     confirmed load-bearing per B33/B38's own method — reverted the retry loop to a single `spawn` call in an
     `rsync`ed scratch copy under `/tmp` (never the real tree): 2/6 tests failed (the retry-then-succeed case
     and the bounded-give-up case), then discarded the copy and confirmed `git status` on the real tree showed
     no changes. Sweep for other single-shot `spawnSync` or execSync calls (Node's own child_process API, not
     a symbol defined in this repo) reachable from a role-grant or lease path: a grep across
     `orchestrating-long-tasks/scripts/src` for both names (excluding tests) matches only this one call site;
     `process-tree.ts` uses async `execFile` with its own `SNAPSHOT_SPAWN_RETRIES`, not a synchronous spawn,
     so no other unretried single-shot spawn exists on that path. `bun run typecheck` passes clean. The
     harness's own health check now reports the intent-drift check at 0 failures (the finding this item names
     is gone; B37's own separately-tracked allowance in `health/allowlist.ts` is unaffected by this note);
     overall verdict healthy, 0 failures repo-wide.

2. **B32/B34 telemetry-to-`graph.json`: the wiring is now genuinely correct and reachable, but B32.2's own
   literal closure bar is still unmet.** Verified by reading the call sites directly: `probeAgentTelemetry`
   (`cli/host-telemetry-probe.ts`) calls both `detectHostTelemetry` (B32.3's previously-dead-code function —
   it now has real callers) and `readAgentTranscriptTelemetry` (B34's real Claude Code transcript reader),
   and is itself called as a hardcoded step from `agentRegisterCommand` and `agentReleaseCommand`
   (`cli/commands/agent-ops.ts`) and from `task-claim.ts` — never a round-trip to the agent, exactly as
   B32.1/B34 specify. `bun test tests/unit/summary/graph-completeness-contract.test.ts` — "carries per-agent
   telemetry and the whole grant ledger" — drives the real CLI end to end (register → report → release →
   `summary:export`) and asserts the resulting `graph.json` node's `telemetry.tokensIn` carries
   `evidence_class: "host_reported"`; 17/17 pass. What is still true, checked directly rather than inferred:
   neither capsule on disk has ever exercised this end to end through a real dispatched run —
   `skills/.capsules/2026-08-17-skills-documentation-elevation/state.json` and
   `gvui/.capsules/2026-08-17-gvui-documentation-elevation/state.json` both lack an `agents` key entirely,
   and both capsules' exported `summary/graph.json` have zero nodes carrying a `telemetry` field. B32.2 set
   the bar explicitly: "Until a capsule on disk contains a populated agents ledger, treat this feature as
   unproven regardless of test coverage." That bar is still unmet — the gap that remains is a real
   dispatched run, not a code or test gap.

3. **B28's supervisor-recovers-from-a-crash claim: verified true, but only after watching its own proof-test
   get fixed mid-audit.** `tests/unit/orchestrator/supervisor.test.ts`'s "B28.2/B28.4: survives its own
   death" test — the literal test for "the supervisor actually recovering" — was, at the start of this
   audit, missing the fake `sleep` wiring every sibling `fakeTime()` usage in the same file has (it
   destructured only `{ clock, advance }`), so both `RunSupervisor` instances fell back to real
   `setTimeout`-based polling against a frozen fake elapsed-clock and the test hung to the runner timeout on
   every run (reproduced 3/3 times, isolated with `-t`). This was uncommitted, in-flight work by a
   concurrent agent in this same session, not shipped code — by the time this was traced to its root cause
   and about to be reported, the same file had already been corrected (a `sleep` field added to both
   instances, plus a second bug fixed alongside it — the test's own claimingDispatcher mock (a test-local
   helper, not a production symbol) reused the
   same agent-id counter across "process" instances, which would have made the post-recovery lease look
   identical to the dead one by coincidence; a `label` parameter now disambiguates "dead-process" from
   "restarted-process"). Re-run after that fix landed: `bun test tests/unit/orchestrator/supervisor.test.ts
tests/unit/orchestrator/supervision-tick.test.ts` — 14/14 pass, including the crash-restart scenario. No
   action needed — recorded here only because B33 requires opening the artifact rather than trusting a
   status, and this is the artifact having been open while it was still broken.

4. Per B33, the harness's own `bun orchestrating-long-tasks/scripts/harness.ts health --consumer ../gvui
--all` was run as instructed (verdict: healthy, 0 failures, 438 advisories, all in the "unused code"
   category with reasoned allowances) and correctly finds none of the above three findings — confirming the
   task's own framing: this is a mechanical check for dead/unreachable/undeclared code, not a runtime or
   load-sensitivity check, so a clean health run is not evidence against any of the above.

---

## B41 — Findings from Wave 20's visual-testing verification pass (gvui) `queued`

**Opened 2026-08-20 (completion-tagging audit pass), recording three findings a separate verifier raised
during gvui's Wave 20 visual-testing work.** Findings 1 and 2 were reproduced directly by opening the
named artifacts in the `gvui` repo, not by trusting the report that raised them — and then, minutes later
in this same pass, the concurrent workstream fixing them finished, so both carry a second, dated
confirmation below their original text rather than a rewrite of it (per this file's own rule: a note's
substance stays; a correction is a new note on top). Finding 3 rests partly on evidence only this session
can attest to (see its own note) and is recorded here specifically so the requirement it names does not
depend on any one wave remembering it. **Item stays `queued`: per the composite-item clause in the status
key above, one open finding (3) holds the whole item, even with 1 and 2 now resolved.**

**Still queued 2026-08-20 (reconciliation pass) — findings 1 and 2's own "uncommitted working-tree state"
caveat no longer applies; finding 3's gap is still real and unresolved.** Re-verified all three in gvui
directly rather than trusting the notes below. Findings 1 and 2: `git status --short` in gvui is now clean
(nothing uncommitted) and `git log --oneline -1 -- src/testing/visual/boundingBoxGeometry.ts
src/testing/visual/visualHarnessSession.ts` plus `git log --diff-filter=D --oneline -- src/testing/visual/visualMetricsCollector.ts src/testing/visual/browserVisualHarness.ts`
both point to the same landed commit, `5e20110` ("feat: render the plan-validator role the skill now
emits") — the split and the regenerated `visual-report.json` are no longer WIP, they are committed. Re-ran
`wc -l` on all nine modules against that commit and got the identical nine numbers finding 1's resolution
already lists (233/412/262/81/95/84/182/147/97, all under 500); `bun test
src/testing/visual/visualMetricsCollector.test.ts src/testing/visual/browserVisualHarness.test.ts` — 68
pass, 0 fail, unchanged. Re-opened `reports/visual-report.json` directly: still carries all four viewport
keys including `wide-desktop`, `timestamp` still `2026-08-20T21:17:56.784Z`, and the `wide-desktop` entry
still reads `overflowCount: 0`, `integrityScore: 100`, `contrastViolationCount: 19`,
`accessibilityScore: 0` byte-for-byte as finding 2's resolution states — now backed by a commit, not a
snapshot of a moving tree. Finding 3: `grep -rn "REPORTING CONTRACT\|filesChanged\|deductionsNotObserved"`
across both `skills` and `gvui` (excluding this BACKLOG.md file itself) still returns nothing — the
requirement finding 3 asks to give "a durable, checked-in home" has not been added to any role-contract
file, template or doc under `orchestrating-long-tasks/roles/` or elsewhere; it still lives only in
whatever constructs a wave's dispatch prompt, outside version control, exactly as finding 3 describes.
This is the one open finding still holding the item at `queued`; findings 1 and 2 need no further
action.

1. **Two consumer-repo files exceed B23's 500-line cap, and a split is visibly underway but not yet
   wired in.** gvui/src/testing/visual/visualMetricsCollector.ts was 967 lines and
   gvui/src/testing/visual/browserVisualHarness.ts was 588 lines (`wc -l`, confirmed 2026-08-20) — both
   paths since deleted, see this finding's own resolution below — B23
   raised the harness's own cap to 500 and `tests/unit/architecture/file-size.test.ts` enforces it in
   this repo, but that test does not reach `gvui`, so nothing mechanical catches a consumer-side breach.
   `gvui/src/testing/visual/boundingBoxGeometry.ts` and `gvui/src/testing/visual/textClippingDetection.ts`
   already exist on disk, untracked (`git status --short`), each holding pure-function logic (bounding-box
   geometry, text-clipping detection) that plainly belongs to the two oversized files' domain — but
   grepping both oversized files for either new filename returns zero hits, so neither has been updated to
   import from them yet. The extraction exists; the wiring that would actually shrink the two files does
   not. Track to close: land the import/removal half of the split and confirm both files read under 500
   lines by `wc -l`.
   **RESOLVED, confirmed 2026-08-20 (same pass, minutes later — the working tree moved while this finding
   was being written).** Re-opened the directory fresh rather than trusting the paragraph above:
   visualMetricsCollector.ts and browserVisualHarness.ts no longer exist — `git status --short` shows
   both `D`, deleted from the working tree. Nine focused modules stand in their place, every one read by
   `wc -l` just now: `boundingBoxGeometry.ts` (233), `colorContrastAnalysis.ts` (412),
   `domMetricsCollection.ts` (262), `stackingCollisionDetection.ts` (81), `textClippingDetection.ts` (95),
   `visualAuditSuite.ts` (84), `visualHarnessSession.ts` (182), `visualMetricsReport.ts` (147),
   `visualScreenshotCapture.ts` (97) — all under the 500-line cap. The two test files that kept the
   old names were rewired, not orphaned: `visualMetricsCollector.test.ts` now imports
   `./textClippingDetection` and `./stackingCollisionDetection` directly, never the deleted source file.
   `bun test src/testing/visual/visualMetricsCollector.test.ts src/testing/visual/browserVisualHarness.test.ts`
   — 68 pass, 0 fail, run against this exact working tree. **This is uncommitted working-tree state, not a
   landed commit** — a concurrent workstream finished it while this finding was open; whoever commits it
   next should re-`wc -l` and re-run the tests rather than cite this note past that commit.

2. **`gvui/reports/visual-report.json` predates the scorer fix this pass was told about, and cannot settle
   a claim about the 1920px viewport either way.** Opened the file directly rather than trusting a
   description of it: 866,489 bytes, tracked, last touched by commit `e2588f2` ("fix: composite
   backgrounds, exclude containment, capture every viewport"), carrying its own `"timestamp":
"2026-08-20T19:44:46.902Z"`. Its `viewports` object holds exactly three keys — `desktop`, `tablet`,
   `mobile` — with no `wide-desktop` entry, even though gvui/src/testing/visual/browserVisualHarness.ts:50's
   own viewport matrix (that file's own successor, `visualHarnessSession.ts`'s `STANDARD_VIEWPORTS`,
   confirmed 2026-08-20 — see finding 1's resolution above) defines a fourth: `{ name: "wide-desktop", width: 1920, height: 1080 }`. The
   report's own `summary.integrityScore` and `summary.accessibilityScore` both read `0` against 584
   recorded violations — consistent with a scorer that had not yet been corrected when this file was
   generated. So an "absent at 1920" claim resting on this report is unobserved, not confirmed: the file
   was never run against that viewport in the first place, and its scores are not trustworthy even for the
   three viewports it does carry. Regenerating it (rerun the capture/audit pipeline now that finding 1's
   sibling work and the scorer fix have landed) is what would settle the claim either way. Until then, any
   1920-viewport finding sourced from this file is `unknown`, not absent.
   **RESOLVED, confirmed 2026-08-20 (same pass, minutes later — same moving tree as finding 1).** Re-opened
   the file fresh rather than trusting the paragraph above: `viewports` now carries all four keys,
   including `wide-desktop` (`{width: 1920, height: 1080}`), and the file's own `timestamp` advanced to
   `2026-08-20T21:17:56.784Z`. The claim this finding exists to settle is now directly answered, not merely
   made checkable: at 1920, `overflowCount` is `0` and `integrityScore` is `100` — genuinely absent, not
   unobserved — but `contrastViolationCount` is `19` and `accessibilityScore` is `0`, so "absent at 1920"
   is true of layout overflow specifically and false of contrast; a claim naming just "absent at 1920"
   without saying which category is still imprecise. **Same caveat as finding 1: this is uncommitted
   working-tree state**, produced by the same concurrent split — re-open the file fresh once it lands
   rather than citing this note past that commit.

3. **Wave 20's own implementer report undercounted its diff and misattributed one of its own edits — the
   durable fix is a reporting-contract requirement now carried in wave-dispatch prompts, recorded here so
   it outlives this one wave.** `scripts/visual-capture.ts` is part of commit
   `e2588f276a335c8e5054196c64bed638cfcb9db3` — confirmed directly via `git show --stat e2588f2`, 21 lines
   changed in that file — but Wave 20's own implementer report did not list it among its changed files, and
   separately credited one of its own edits to a concurrent wave rather than to itself. **Evidence class
   check on this paragraph's own claim:** the diff/commit membership is `harness_observed` (opened directly,
   above); that Wave 20's report specifically omitted this file and misattributed an edit is `agent_reported`
   — relayed from this pass's own dispatch context, not confirmed by opening Wave 20's report text, which
   this pass never had access to. Consistent with, not independent proof of, the omission claim. Grepped both repos
   for the requirement's own text (`REPORTING CONTRACT`, `filesChanged`, and deductionsNotObserved — the
   last of those a field of the dispatching workflow's own report schema, not a repository symbol, so
   the grep was for its name in prose/config, never for a source-level declaration); it
   exists nowhere as a committed artifact in either repo — the fix lives only in whatever constructs each
   wave's dispatch prompt, outside version control. Direct, first-person evidence that the fix is real and
   active: this very entry was written under a dispatch prompt carrying a section titled "REPORTING
   CONTRACT — this is what Wave 20's verifier caught and it is now mandatory," requiring every touched file
   listed in `filesChanged`, observed claims kept distinct from deduced ones, and `git diff`/`git diff
--staged` checked before crediting an edit to anyone else. That the requirement held for this entry is
   `agent_reported` evidence that the requirement exists in this session's prompt, not proof it survives
   into every future one — nothing on disk guards it, so a stale prompt template could silently drop it
   again. Track to close: give the requirement a durable, checked-in home (a template or role-contract file
   under `orchestrating-long-tasks/`) so a later pass can confirm it holds the way B33 asks — by opening an
   artifact — rather than by trusting that each new wave's prompt still carries it by convention.
