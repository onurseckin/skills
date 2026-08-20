# Overhaul Backlog — decisions queued for the final wave

Append-only. Decisions land here as they are made in conversation, and are implemented in the final
wave so that in-flight waves are never interrupted. Each entry is written to be implementable without
further clarification.

Status key: `queued` — agreed, not started. `in-wave` — being implemented now. `done` — landed and verified.

---

## B1 — Replace the branch depth cap with a termination guarantee `in-wave`

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

## B2 — Capsule storage layout: one home per fact, indexed, no duplication `queued`

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

## B3 — `graph.json` completeness contract `queued`

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

## B4 — No backward compatibility anywhere. Latest layout only. `queued`

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

## B5 — The capsule must be legible to a human browsing it `queued`

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

## B6 — `summary.md` is a complete, sequential run report `queued`

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

## B7 — GVUI stays a general-purpose graph visualizer `queued`

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

Roughly forty defects were found beyond the original brief. Most are fixed. This item covers the ones that
are NOT, plus the policy that stops the rest from coming back.

### B8.1 CRITICAL — role contracts are still not enforced

**Verified 2026-08-20 by direct grep, and this contradicts an earlier "done" report.**

`assertPublishedTaskPacket(` has **zero call sites**. It is imported in `workflow/review/record-review.ts:9`
and `workflow/submission/submit.ts:8` and never invoked — exactly as it was before the overhaul started.
`publishRolePacket` still has exactly one caller (`packets/planner-packet.ts`). `task:claim` publishes no
packet at all.

Consequence: the nine capability contracts in `roles/` exist as documents but **bind nothing**. R6 asked
for "a non-negotiable list of what each role can and cannot do". We have the list; we do not have the
enforcement. Right now they are advisory prose — the same status as the `agents/*.yaml` text they replaced.

To close:

- Publish a role packet at `task:claim`, `task:validate-start`, `critic:start` and `branch:claim`, carrying
  the role contract bytes and their sha256.
- **Actually invoke** `assertPublishedTaskPacket` in `submit` and `record-review`, so an agent acting
  without a published contract is refused.
- Enforce the contract's `commands:` list at dispatch: a role invoking a command its contract does not
  grant is refused with INVALID_STATE.
- Test: an implementer cannot submit without a published packet; a validator cannot invoke an
  implementer-only command; the packet digest matches the checked-in role document.

### B8.2 `handoff.md` is still never produced

`reporting/handoff.ts` has zero call sites (verified). The deterministic restart document — the artifact
that makes a run resumable by a fresh agent after context loss — is documented, implemented, and never
written. Wire it into `run:complete`, `task:submit` and the escalation path.

### B8.3 Remaining duplicate implementations

- `resolveModelTier` still has a copy in `gvui/src/utils/htmlExporter.ts`.
- Two layout adapters in gvui (`engine/layout/customLayoutAdapter.ts` vs
  `engine/layout/custom/wasmLayoutAdapter.ts`), near-identical, only one used.
- `getNodeRepairRounds` duplicated across three gvui files.
  Collapse each to one implementation. A duplicated helper is where the next silent divergence starts.

### B8.4 Housekeeping

- Four gvui source files fail `bun run format:check`.
- `orchestrating-long-tasks/scripts/package.json` declares `bun test tests` against a path with no tests;
  the real suite is at the repo root. Fix or delete.
- `.lock/` lives inside the capsule, indistinguishable from durable state (also covered by B2).
- Confirm the `run:exec` ~5.2 s post-exit stall is genuinely fixed; it was assigned but the fix was never
  independently confirmed.

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

---

## B9 — Coverage and semantic health check `queued`

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

## B10 — Unknown fields must never break the renderer `queued`

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

## B11 — Commit cadence, and the flaky test that blocks it `queued`

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

## B12 — Typed validators with standing checklists (the guardian system) `queued` **[TOP QUALITY PRIORITY]**

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

## B13 — SKILL.md is an index, not a manual `queued`

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

## B14 — Correction to how the R9 rule is stated `queued`

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

## B16 — `/orchestrate` slash-command entry point `queued`

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

## B18 — Commit per completed sub-task, not per wave   `queued`

**Owner requirement:** when a sub-task finishes, the repo should already be commit-ready and committed;
when the whole wave finishes, commit and push again. Do not accumulate a wave's worth of work uncommitted.

### B18.1 The obstacle, stated honestly

Wave 7 ran five agents concurrently in ONE working tree. Per-agent commits were not possible there, for a
reason worth writing down:

- File ownership between agents IS disjoint, so `git add <owned paths>` would stage only the finishing
  agent's work correctly.
- But the repo's `lefthook` pre-commit hook runs `typecheck` + the FULL unit suite, and those run against
  the **working tree**, not the index. Another agent's half-written file fails the gate no matter what is
  staged. Observed exactly this: 1425 pass / 2 fail, the failures being another agent mid-edit.

So per-agent commits require either isolation or a narrower gate. Do not "solve" it with `--no-verify` —
that discards the only thing keeping broken commits out (see B11).

### B18.2 WITHDRAWN, then SUPERSEDED BY B22

**See B22.** The owner revisited this and specified a worktree-isolated design that answers the
objection below: the harness never touches the user's branch or working tree, so it imposes no VCS policy
on the repository the user is actually sitting in.

Original objection, kept because it still constrains B22:

A harness-level commit feature (committing a task's write_scope at `task:submit`) was proposed and is
**retracted**. Git workflow stays outside the harness: it would couple orchestration to one VCS policy,
force opinions about staging, hooks, branches and push targets onto every consumer, and complicate a
system whose value is flexibility. The harness records what happened; it does not manage the repository.

If commit provenance is wanted later, the honest seam is the opposite direction: let a commit sha be
RECORDED against a task when the caller supplies one, never created by the harness.

### B18.4 Cadence for THIS overhaul (scope: this chat and its agents only)

Commit at every point the tree is green, not only at wave boundaries: after each wave, and opportunistically
whenever gates pass mid-wave. Push immediately. Never bypass the hook.

---

## B19 — Generic category taxonomy, vendor names as instances   `queued`

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

## B20 — Dynamic host discovery and per-agent telemetry ingestion   `queued`

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

## B21 — Mandatory lifecycle summaries: nothing happens unobserved   `queued`

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

## B22 — Worktree-isolated git management (supersedes B18.2)   `queued`

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

## B23 — Raise the production file-size cap to 500 lines   `queued`

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

## B24 — Continuous dispatch: waves are a planning concept, not a barrier   `queued`

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
should be: the output of a *planning* computation, not a synchronisation requirement. A task in wave N+1 whose dependencies
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

## B25 — Retire "wave". The graph is a DAG; readiness is a parent relation   `queued`

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

## B26 — Enrich the validator packet: orient without anchoring   `queued`

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

## B27 — Concurrency is a workload property, not a CPU formula   `queued`

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

---

## B28 — Autonomous supervision: crash recovery and unattended long runs   `queued`

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

## B29 — Gates are scoped to the task; the full suite runs once, at the barrier   `queued`

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

## B30 — The skill is Antigravity-specific where it claims to be host-agnostic   `research-in-flight`

**Verified 2026-08-20:** `invoke_subagent` — Antigravity's tool name — appears 8 times across
`agents/coordinator.yaml`, `references/host-adapters.md`, `references/parity-matrix.md` and
`references/run-playbook.md`. **No other host's dispatch mechanism is named anywhere in the skill.**
`references/host-adapters.md` is 146 lines and `parity-matrix.md` 61, both written as though one
mechanism were universal.

A coordinator running under Claude Code, Cursor, Codex or Gemini is therefore being told to call a tool
that does not exist there. The skill's claim of host-agnosticism is currently false.

### B30.1 The contract must be abstract; the tool name is a value

Per B19: a vendor name is a VALUE, never a first-class concept. The skill expresses the abstract need —
*dispatch an agent with role R, scope S, and this packet; learn its identity; know when it finishes* —
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

| Host | Dispatch |
|---|---|
| Claude Code | `Agent` tool (renamed from `Task` in v2.1.63); definitions in `.claude/agents/*.md` |
| Antigravity | `invoke_subagent` — the skill is CORRECT here, and only here |
| Cursor | `Task` tool; SDK policy string `"task"` |
| Codex | `collaboration` namespace, tool `spawn_agent` (group `multi_agent_v1`) |
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

Antigravity's own binary contains: *"do not use other subagents like `research` or `self` since they may
hang, unless the user specifically requests it."* The skill mandates `TypeName: "self"` for EVERY
implementer and validator. The guidance is context-scoped rather than absolute, but it warns against
precisely the pattern the skill universalises. Investigate before continuing to mandate it.

### B30.7 Host capability probing, not assumption

The adapter must record what each host actually supports — nesting depth, concurrency, native workspace
isolation, native resume, per-agent model selection — and the skill must adapt: use a native primitive
where one exists, degrade explicitly where a capability is missing, and SAY which mode it is in.

### B30.4 Sequencing

Research is running now (read-only, documentation-grounded, one agent per host). Application is BLOCKED on
Wave 8's B13, which currently owns `references/**` — writing there now would collide. Apply the spec once
B13 releases those paths.


---

## B31 — Model and effort tier policy   `deferred by owner`

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

## B32 — Telemetry is wired but unproven, and points at the wrong reporter   `queued`

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

**Verified 2026-08-20 and this corrects an earlier, rosier report of mine.**

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

## B33 — Verifier rule: look at the artifact, do not reason about it   `queued`

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

## B34 — The real host telemetry source, found by looking   `queued` **[supersedes B32.1's design]**

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

## B35 — Three more load-sensitive tests; B11.1's sweep was incomplete   `queued`

**Observed 2026-08-20 at the Wave 9 push gate.** These pass 10/10 in isolation and fail under
`bun test --parallel` on a loaded machine:

- `tests/unit/cli/honesty-sweep.test.ts` — "command-recorded carries the argv and the exit
  code, not an empty payload" (the Wave 9 push gate note named a
  tests/unit/runner/command-recorded-payload.test.ts that does not exist; the verifier that closed
  this item confirmed by opening the suite that the test lives here instead)
- `tests/unit/cli/critic-ops-commands.test.ts` — "request_changes without findings is refused rather than
  synthesized"
- `tests/unit/cli/task-probe-commands.test.ts` — "refuses a sign-off while the recorded gate run exited
  non-zero"

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
actual root cause of the `critic-ops-commands.test.ts` flake (an unclassified `ps` spawn failure, not a
timing assumption in the test itself). One residual, load-only flake remains open in
`tests/integration/runner-timeouts-retries.test.ts`'s "kills TERM-resistant descendants after a
cooperative leader exits" — reproduced directly at ambient load ~300+ on a 10-core box (roughly 1-in-6
runs), traced to literal CPU-scheduler starvation rather than a fixable test assumption, since an
untouched, pre-existing idle-timeout test fails the same way at the same load. Needs owner sign-off to
accept at that load level, or a follow-up item for a wall-clock-independent readiness signal.
