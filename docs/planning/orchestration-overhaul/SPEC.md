# Orchestration Overhaul — Architecture Spec

Target repos: `skills/orchestrating-long-tasks` (producer) and `gvui` (consumer).
This spec is the single authority for the overhaul. Where it contradicts existing docs, this wins
and the doc gets fixed.

## 0. The spine: `evidence_class`

Every value the system reports carries an honesty label. This is the organising primitive for R10
and it runs through state, events, graph output and UI.

```ts
export type EvidenceClass =
  | "harness_observed" // the harness itself measured it (exit codes, byte counts, git diff, wall clock)
  | "agent_reported" // an agent told us through the CLI; true only if the agent was honest
  | "host_reported" // the host runtime told us (model id, token usage, thinking level)
  | "derived" // computed from other recorded values (wave numbers, estimates)
  | "unknown"; // not available — MUST render as unknown, never defaulted
```

Rules:

1. No code may substitute a plausible value for a missing one. Absent stays absent.
2. Estimates keep `evidence_class: "derived"` **and** `is_estimated: true`.
3. UI must visually distinguish observed from reported from derived, and must render unknown as
   "unknown", never as a neutral-looking default.

## 1. R1 — Prompt enhancement and the plan document

- `initRun` also creates `<run>/planning/`.
- New command `plan:enhance`. The agent reads the repo (host-side) and reports findings through
  flags; the harness never asks a model anything:
  `--summary`, `--observation` (repeatable), `--todo` (repeatable), `--risk` (repeatable),
  `--open-question` (repeatable), `--source` (repeatable; files actually read), `--actor`.
- Writes `planning/enhanced-plan.md` (0444) and `planning/enhanced-plan.json`; records the sha256
  in `state.planning.enhanced_plan` via `transact` with new event `plan-enhanced`.
- `prompt.md` stays immutable and authoritative. The enhanced plan is explicitly `derived` and
  never becomes the requirement source. Requirements keep binding to the raw prompt digest.
- `plan:add --requirement-lines "3-5"` binds a task to explicit prompt lines. Positional gluing
  stays only as the fallback when no lines are given, and must warn.
- Fix the two-splitter divergence: `requirements/compiler.ts` and `requirements/predicates.ts` must
  use ONE shared line splitter. Extract it.

## 2. R2 — Topology is decided once, recorded, and obeyed

- `proposeBatch` (scheduler) becomes the single authority for "what may run together".
- `plan:compile` persists `state.topology`:
  ```ts
  interface TopologyRecord {
    revision: number;
    waves: Array<{ wave: number; task_ids: string[] }>;
    decisions: Array<{
      task_id: string;
      wave: number;
      parallel_with: string[];
      serialized_after: string[];
      reason: "dependency" | "write_scope_conflict" | "priority_capacity";
      rationale: string; // agent_reported when supplied via --rationale, else derived
      evidence_class: EvidenceClass;
    }>;
    max_parallel: number; // from config, not hardcoded
  }
  ```
- New command `queue:wave` returns the WHOLE next conflict-free wave so a coordinator can dispatch
  2N+1 agents in one batch. `queue:pop` handing out one task is what forces the waterfall today.
- `summary/step-calculator.ts` must READ `state.topology` instead of re-deriving waves. Delete the
  divergent derivation.
- Fix `scopeConflict`: glob-aware. `docs/**` vs `docs/concepts/**` MUST conflict. Today it does not.
- `formatQueueListBrief` must stop hardcoding `maxParallel = 3`; read config.

## 3. R3 — Asymmetric branch-and-collect

A branch is an EXECUTION-TIME subdivision discovered by a working agent. It is deliberately NOT a
plan task, so it never fights `guardPlanRevision` (which freezes contracts and demands revision+1).

New `state.branches` ledger:

```ts
interface BranchRecord {
  id: string; // B-<uuid>
  parent_task_id: string;
  parent_agent_id: string;
  reason: string; // WHY the branch happened — required, shown in the graph
  sub_tasks: Array<{ id: string; label: string; write_scope: string[]; gate?: string }>;
  status: "open" | "collecting" | "collected" | "abandoned";
  opened_at: string;
  collected_at?: string;
  outcome_summary?: string;
  files_changed?: string[]; // harness_observed via git diff at collect time
}
```

Commands: `branch:open`, `branch:claim`, `branch:submit`, `branch:collect`, `branch:abandon`.

Semantics:

- `branch:open` requires the parent's live lease token. Parent task moves to new status `branched`
  and its lease clock is SUSPENDED (expiry frozen) until collect/abandon.
- Sub-agent write scopes MUST be subsets of the parent scope and disjoint among siblings, enforced
  by the fixed `scopeConflict`.
- `branch:collect` requires every sub-task terminal, records a real git-diff observation, restores
  the parent lease with a fresh expiry, and returns the parent to `running`.
- `branch:abandon` is the failure path; it releases sub-leases and returns the parent to `running`.
- Failure recovery must exist: expose the already-implemented but unreachable
  `release` and `recover-stale` as CLI commands (`task:release`, `recover`). Without these a
  dead sub-agent permanently blocks completion via orphan evidence.
- New `TaskStatus` member: `branched`. Nesting depth is capped (config `max_branch_depth`, default 2).

## 4. R4 — Legibility, and the end of shared data

Producer (`summary/`):

- Validators become their OWN node (`kind: "agent"`, `metadata.role: "validator"`), no longer fused
  into the gate node.
- Branch sub-agents become their own nodes; the branch itself becomes a `GraphSection` so the region
  is visually grouped. NO Rust layout-engine changes — grouping is a section + edge-kind concern.
- New edge kinds emitted: `dispatch`, `handoff`, `probe`, `pushback`, `validation`, `signoff`,
  `dependency`, `gate`, `critic`, `branch`, `collect`, `backtrack`.
- **Per-node evidence ownership.** Canonical location is `node.assets: MediaAsset[]` only.
  Delete the duplicate writes to `metadata.mediaAssets`, `metadata.screenshots`, `metadata.assets`,
  `node.mediaAssets`, `node.screenshots` and `playwrightMetadata.screenshots`.
  A node may only carry assets produced by commands scoped to that node. The critic node must stop
  passing `task === undefined` into `mapMediaAssets`, which currently vacuums every screenshot in
  the run onto one node.
- `node.stateTransitions[]` emitted from `task.history[]` so the state machine is visible.
- Enrich the `review-recorded` event payload (forward-only) with `verdict`, `round`, `class`,
  `finding_count`. Today it carries `{task_id}` only, which is why the timeline labels every clean
  pass as "review requested changes (0 findings)".
- `node.tools[]` and `node.scripts[]`: harness-observed from command records, plus agent-reported via
  `agent:report`. Each entry carries its own `evidence_class`.
- Fix `stdoutSnippet`/`stderrSnippet`: read the real log bytes at `logs.stdout.path`. Today the
  summary reads a `cmd.stdout` string the runner never writes, so snippets are always absent.

Consumer (gvui):

- `SubagentLineageTree` must NOT fall back to whole-graph edge traversal when a node has no lineage.
  That is why `node-input-prompt` renders every other node as its lineage.
- `GraphSvgLayer` must use per-edge accent colour, not the source node's.
- `resolveEdgeKind` must handle every declared kind. `conditional` and `join` silently becoming
  `sequence` is a defect.
- Wire `GraphGroupingLayer` (currently imported only by its own test) to render `sections`.
- New drawer tab: **State Machine** — renders `stateTransitions` and the probe/pushback rounds.

## 5. R5 — Adversarial probe is not a rejection

- New verdict `probe` beside `pass` / `reject`. New command `task:probe`.
- New `finding.class`: `"defect" | "probe_demand"`. A probe demand is "prove X", not "X is broken",
  so requiring one is not fabrication.
- Counters split: `task.probe_round` is separate from `task.repair_round`. A probe does NOT consume
  the repair budget, and does NOT trigger `assignReplacementRepairer`.
- Enforcement (this is the point — today it is prose only): `task:review --status pass` FAILS when
  `probe_round < min_adversarial_probes`. Wire `loadHarnessConfig`, which currently has zero callers.
- Canonical count is **1**. Every doc saying 3 is wrong and gets fixed.
- Canonical `max_repair_rounds` is **6** (the code value). Docs saying 5 get fixed, including the two
  files that contradict themselves.
- Graph: probe emits edge kind `probe` with info/cyan styling and label `Adversarial Probe (Round N)`.
  Genuine defects emit `pushback` with error styling. A task that passed after a probe is NOT
  warning-coloured.

## 6. R6 — Role capability documents that actually bind

- Canonical role vocabulary (extend `AgentRole`):
  `coordinator`, `planner`, `implementer`, `validator`, `repairer`, `completeness-critic`,
  `sub-implementer`, `sub-validator`, `sub-investigator`.
- One document per role at `orchestrating-long-tasks/roles/<role>.md`, YAML frontmatter:
  ```yaml
  role: validator
  tier: 3
  may: [...] # explicit allowed actions
  must_not: [...] # non-negotiable prohibitions
  commands: [...] # exact CLI commands this role may invoke
  spawns: [...] # roles it may branch into, [] if none
  ```
- **Binding mechanism**: revive the packet subsystem. `buildPacket`/`publishPacket` are fully
  implemented but unreachable. Wire role-packet publication into `task:claim`,
  `task:validate-start`, `critic:start` and `branch:claim`, and actually invoke
  `assertPublishedTaskPacket` in submit/review — it is imported in two files and never called.
- `scripts/assets/*.md` are dead files. Fold their content into `roles/` and delete the duplicates.

## 7. R7 — Everything through the CLI; grant history is real

- New `state.agents` ledger and `agent:*` family:
  - `agent:register` — records a dispatched subagent: id, role, parent agent/task, host, and any
    host-reported model/tier/thinking level. Mints the grant.
  - `agent:report` — ingests observed tool usage and token counts from the host.
  - `agent:release` — closes the grant.
  - Events: `agent-registered`, `agent-reported`, `agent-released`.
- **Command registry replaces the switch.** `src/cli/registry/` with one module per domain and a
  barrel. Each entry declares name, aliases, summary, flags (name/type/required/repeatable/default),
  stdin rule, remainder rule, exit codes and examples. `execute.ts` dispatches from the registry.
  This is what makes R8 generated rather than hand-written.
- Anti-fabrication fixes (all verified present today):
  - `task:submit` must stop falling back to the literal `'src/index.ts'` for `files_changed`, stop
    inventing `cmd-<task>-gate` check ids, and must actually read `--evidence`/`--report`, which it
    allow-lists and ignores.
  - `critic:review` must stop auto-generating a `satisfied` requirement proof for every requirement.
    Unproven requirements are recorded as `unproven` and block completion.
  - `orchestrator:run` must stop writing a fake approved summary when no executor is injected. It
    fails with `INVALID_STATE` instead.
  - Stop persisting plaintext bearer tokens in `reports/*.json` (submission, review, critic). Store
    digests only. This contradicts the repo's own security doc today.
  - `run:exec` gate failures: keep exit 0 for the CLI, but `task:review --status pass` must REFUSE
    when a required gate's recorded `exit_code != 0`.
  - Fix `--format` stripping in `harness.ts`, which currently mutates the child argv after `--`.

## 8. R8 — One capability manifest, generated

- `scripts/generate-cli-manifest.ts` renders `references/cli-capabilities.md` and
  `references/cli-capabilities.json` FROM the registry.
- A unit test asserts the checked-in manifest matches the registry, so it can never drift.
- `harness.ts help`, `harness.ts help <command>`, and a `--help` intercept in `harness.ts`
  (alongside the existing `--format` scan, because `--help` as argv[0] currently dies in the parser).
- Every other copy of CLI documentation is replaced by a pointer to the manifest.
- Remove documented-but-nonexistent commands from docs (`install`, `installation-status`, `recover`,
  `doctor`) or implement them. Decision: implement `install`/`installation-status`/`recover`/`doctor`
  as registry entries — the implementations already exist and are merely unwired.

## 9. R9 / R10 — Telemetry honesty

- Per-agent telemetry comes ONLY from `agent:register` / `agent:report`. `detectHostTelemetry` must
  stop stamping one model on every node — it ignores its `agentId` argument entirely today.
- Host _identity_ detection (which harness the run happened under) may stay; agent _model_
  attribution may not be inferred from the exporting machine's config files.
- Token counts: real values only when host-reported. Estimates keep `is_estimated: true` and
  `evidence_class: "derived"`.
- gvui must delete the `TIER_PRICING` fabrication that invents dollar costs when cost is 0, and must
  render unknown model/tier as an explicit "unknown" marker rather than "Unspecified".
- Delete the ~25 hardcoded edge-traffic constants in `graph-edge-factory.ts` / `edge-builder.ts`
  (350/1400/30ms etc.). Emit traffic only from observed bytes/durations; omit otherwise.

## 10. Compatibility and verification

- Existing capsules must keep loading. All new state keys are optional; all new graph fields are
  additive; gvui reads new canonical fields with a tolerant fallback to the legacy ones.
- `events.jsonl` is an append-only hash chain: payload enrichment is forward-only, never backfilled.
- Regenerate the shipped gvui fixture dataset at the end so it exercises the new schema.
- Gates: `bun run typecheck` and `bun test tests/unit` in skills; `bun x tsc -b` and `bun test src/`
  in gvui. Zero `any`, zero `@ts-ignore`, zero `eslint-disable` — no exceptions.
