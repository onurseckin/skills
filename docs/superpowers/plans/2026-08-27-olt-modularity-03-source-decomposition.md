# OLT Production Source Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose every non-CLI oversized production file and crowded source directory into explicit acyclic feature slices without changing OLT behavior.

**Architecture:** Domain waves characterize behavior, extract cohesive modules behind a single-owner facade, migrate cross-directory consumers through that facade, and eliminate remaining SCCs. Each wave owns exact original paths and new descendants under its domain; shared indexes have one owner.

**Tech Stack:** Bun, TypeScript 5.7, existing OLT production modules and unit tests, P01 modularity guard

**Spec:** `docs/superpowers/specs/2026-08-27-olt-modularity-guardrail-design.md`

## Global Constraints

- 300 physical lines maximum; 10 direct files maximum including `index.ts`.
- Every production TypeScript directory has an explicit named-export facade; no export-star.
- Cross-directory imports use facades; same-directory imports may name files directly.
- Type-only imports and exports remain type-only.
- P02 exclusively owns `olt/scripts/src/cli/**`; P03 must not edit it.
- P03 owns all other `olt/scripts/src/**` production source and the two oversized root reporting scripts.
- Tests are read-only in P03. Existing targeted tests supply behavior evidence; any missing characterization requires an explicit ownership amendment before source work proceeds.
- SOL/high creates exact extraction briefs; Terra/high implements and a fresh Terra/high reviewer falsifies each wave.
- Each reviewed domain subgroup commits conventionally and pushes main.

---

## Exact oversized-file ownership

Every row is owned by exactly one domain wave.

```text
wave | path | physical_lines
agents | olt/scripts/src/agents/agent-triad.ts | 752
agents | olt/scripts/src/agents/naming.ts | 484
authority | olt/scripts/src/authority/manifest-parser.ts | 1331
authority | olt/scripts/src/authority/persona-grounding.ts | 945
authority | olt/scripts/src/authority/pillars.ts | 303
authority | olt/scripts/src/authority/review-pushback.ts | 763
authority | olt/scripts/src/authority/session-registry.ts | 863
authority | olt/scripts/src/authority/supervisory-persona-reminder.ts | 1212
authority | olt/scripts/src/authority/thread-identifier.ts | 983
authority | olt/scripts/src/authority/watchdog-manager.ts | 1243
capture | olt/scripts/src/capture/runners/dom-event-simulator.ts | 664
capture | olt/scripts/src/capture/runners/layout-shift-tracker.ts | 749
capture | olt/scripts/src/capture/runners/live-capture-runner.ts | 346
capture | olt/scripts/src/capture/validator/cognitive/cognitive-questions.ts | 408
capture | olt/scripts/src/capture/validator/mechanical/focus-ring-optical.ts | 828
core | olt/scripts/src/core/config/harness-config.ts | 527
core | olt/scripts/src/core/dual-time.ts | 911
core | olt/scripts/src/core/shared/safe-fs.ts | 340
engine | olt/scripts/src/engine/runner/process-timeout-watchdog.ts | 902
engine | olt/scripts/src/engine/runner/run-command.ts | 439
engine | olt/scripts/src/engine/scheduler/core-engine.ts | 1974
engine | olt/scripts/src/engine/scheduler/critic-feedback.ts | 716
engine | olt/scripts/src/engine/scheduler/diagnostics.ts | 731
engine | olt/scripts/src/engine/scheduler/dynamic-topology.ts | 608
engine | olt/scripts/src/engine/scheduler/multi-domain-dispatch.ts | 783
engine | olt/scripts/src/engine/scheduler/pulse.ts | 367
engine | olt/scripts/src/engine/scheduler/unlimited-depth.ts | 544
engine | olt/scripts/src/engine/store/capsule-index.ts | 382
engine | olt/scripts/src/engine/store/content-normalization/ecmascript-whitespace.ts | 314
engine | olt/scripts/src/engine/store/content-normalization/yaml-canonical.ts | 476
engine | olt/scripts/src/engine/store/event-append.ts | 335
engine | olt/scripts/src/engine/worktree/domain-sync.ts | 724
engine | olt/scripts/src/engine/worktree/phase-commits.ts | 496
graph | olt/scripts/src/graph/brainstorm-engine.ts | 393
graph | olt/scripts/src/graph/dag-expansion.ts | 806
graph | olt/scripts/src/graph/dag-forensics.ts | 1162
graph | olt/scripts/src/graph/dynamic-expansion.ts | 1030
graph | olt/scripts/src/graph/gate-proof.ts | 539
graph | olt/scripts/src/graph/parallel-decoupler.ts | 971
graph | olt/scripts/src/graph/plan-audit.ts | 474
graph | olt/scripts/src/graph/unified-plan.ts | 514
heuristics | olt/scripts/src/heuristics/glass-surfaces.ts | 593
heuristics | olt/scripts/src/heuristics/modal-focus-traps.ts | 320
heuristics | olt/scripts/src/heuristics/multi-viewport-manifest.ts | 888
heuristics | olt/scripts/src/heuristics/subpixel-borders.ts | 658
hooks | olt/scripts/src/hooks/config.ts | 366
hooks | olt/scripts/src/hooks/dispatcher.ts | 708
linter | olt/scripts/src/linter/ast-enforcer.ts | 1769
logging | olt/scripts/src/logging/defect-logger.ts | 821
mind | olt/scripts/src/mind/archival.ts | 1293
mind | olt/scripts/src/mind/audit.ts | 983
mind | olt/scripts/src/mind/brief.ts | 734
mind | olt/scripts/src/mind/briefing-builder.ts | 1116
mind | olt/scripts/src/mind/budget.ts | 484
mind | olt/scripts/src/mind/cadence.ts | 605
mind | olt/scripts/src/mind/charter.ts | 471
mind | olt/scripts/src/mind/cognitive-auditors.ts | 664
mind | olt/scripts/src/mind/cognitive-flavor.ts | 804
mind | olt/scripts/src/mind/completed-tasks.ts | 719
mind | olt/scripts/src/mind/counterfactual.ts | 632
mind | olt/scripts/src/mind/defects.ts | 2099
mind | olt/scripts/src/mind/defects/aggregator.ts | 355
mind | olt/scripts/src/mind/defects/defect-loop.ts | 578
mind | olt/scripts/src/mind/deploy.ts | 510
mind | olt/scripts/src/mind/digest.ts | 953
mind | olt/scripts/src/mind/dynamic-roles.ts | 1352
mind | olt/scripts/src/mind/feedback-queue.ts | 1388
mind | olt/scripts/src/mind/gates.ts | 967
mind | olt/scripts/src/mind/hyper-cognition.ts | 1122
mind | olt/scripts/src/mind/interval.ts | 568
mind | olt/scripts/src/mind/lanes/rescue.ts | 922
mind | olt/scripts/src/mind/liveness.ts | 527
mind | olt/scripts/src/mind/memory.ts | 1609
mind | olt/scripts/src/mind/meta-auditor.ts | 1430
mind | olt/scripts/src/mind/mind.ts | 583
mind | olt/scripts/src/mind/proposal.ts | 1429
mind | olt/scripts/src/mind/pushbacks.ts | 508
mind | olt/scripts/src/mind/quiesce.ts | 336
mind | olt/scripts/src/mind/recycler.ts | 908
mind | olt/scripts/src/mind/role-auditing.ts | 2208
mind | olt/scripts/src/mind/rotate.ts | 401
mind | olt/scripts/src/mind/rounds.ts | 624
mind | olt/scripts/src/mind/self-evolution.ts | 1000
mind | olt/scripts/src/mind/smart-task-manager.ts | 3577
mind | olt/scripts/src/mind/sources.ts | 474
mind | olt/scripts/src/mind/strategic-purpose.ts | 810
mind | olt/scripts/src/mind/task-discovery.ts | 1711
mind | olt/scripts/src/mind/task-queue.ts | 1873
mind | olt/scripts/src/mind/witness.ts | 356
orchestrator | olt/scripts/src/orchestrator/completion-audio.ts | 607
orchestrator | olt/scripts/src/orchestrator/loop-runner.ts | 324
orchestrator | olt/scripts/src/orchestrator/multi-capsule.ts | 962
orchestrator | olt/scripts/src/orchestrator/supervision-loop.ts | 760
orchestrator | olt/scripts/src/orchestrator/supervisor.ts | 354
orchestrator | olt/scripts/src/orchestrator/topology-synthesis.ts | 1007
orchestrator | olt/scripts/src/orchestrator/watchdog.ts | 307
packets | olt/scripts/src/packets/capsule-memory.ts | 656
packets | olt/scripts/src/packets/command-authority.ts | 605
packets | olt/scripts/src/packets/dynamic-steps.ts | 415
packets | olt/scripts/src/packets/packet-slicing.ts | 951
packets | olt/scripts/src/packets/role-contract.ts | 525
plan | olt/scripts/src/plan/pre-enhancer.ts | 1199
policy | olt/scripts/src/policy/rbac-engine.ts | 776
policy | olt/scripts/src/policy/repo-policy.ts | 1130
policy | olt/scripts/src/policy/review-protocol.ts | 301
reporting | olt/scripts/src/reporting/behavioral-auditor.ts | 822
reporting | olt/scripts/src/reporting/doctor.ts | 404
reporting | olt/scripts/src/reporting/doctor/adversarial-doctor.ts | 929
reporting | olt/scripts/src/reporting/doctor/tier-confinement.ts | 1091
reporting | olt/scripts/src/reporting/event-stream.ts | 495
reporting | olt/scripts/src/reporting/living-tracer.ts | 1254
reporting | olt/scripts/src/reporting/socratic-validator.ts | 504
reporting | olt/scripts/src/reporting/sugiyama-dag.ts | 1234
reporting | olt/scripts/src/reporting/theme-contrast-matrix.ts | 1056
reporting | olt/scripts/src/reporting/time-telemetry.ts | 1215
reporting | olt/scripts/src/reporting/unified.ts | 716
roles | olt/scripts/src/roles/cheat-sheets.ts | 424
root-tooling | scripts/testing/reporting/html/client-script.ts | 326
root-tooling | scripts/testing/reporting/html/styles.ts | 374
runtime | olt/scripts/src/runtime/agent-metadata.ts | 824
summary | olt/scripts/src/summary/graph/graph-edge-factory.ts | 354
summary | olt/scripts/src/summary/graph/graph-run-facts.ts | 305
summary | olt/scripts/src/summary/graph/graph-types.ts | 358
summary | olt/scripts/src/summary/markdown/markdown-execution-sections.ts | 321
summary | olt/scripts/src/summary/markdown/markdown-sources.ts | 376
summary | olt/scripts/src/summary/metrics/host-telemetry.ts | 337
summary | olt/scripts/src/summary/metrics/metrics-collector-helpers.ts | 348
summary | olt/scripts/src/summary/metrics/timeline-collector.ts | 436
telemetry | olt/scripts/src/telemetry/circuit-breaker.ts | 469
telemetry | olt/scripts/src/telemetry/collectors/antigravity.ts | 314
telemetry | olt/scripts/src/telemetry/collectors/claude.ts | 364
telemetry | olt/scripts/src/telemetry/collectors/openai.ts | 475
telemetry | olt/scripts/src/telemetry/dag-snapshot.ts | 523
telemetry | olt/scripts/src/telemetry/engine.ts | 332
testing | olt/scripts/src/testing/concurrency-lock.ts | 579
testing | olt/scripts/src/testing/isolation.ts | 444
testing | olt/scripts/src/testing/scoped-execution.ts | 550
validation | olt/scripts/src/validation/anti-leak.ts | 758
validation | olt/scripts/src/validation/ast-linter.ts | 706
validation | olt/scripts/src/validation/dual-channel-analyzer.ts | 897
validation | olt/scripts/src/validation/mutation-gate.ts | 496
watchdog | olt/scripts/src/watchdog/autonomic-watchdog.ts | 1101
watchdog | olt/scripts/src/watchdog/boot-gate-enforcer.ts | 488
watchdog | olt/scripts/src/watchdog/process-timeout.ts | 904
workflow | olt/scripts/src/workflow/agents/grants.ts | 449
workflow | olt/scripts/src/workflow/agents/telemetry-merge.ts | 364
workflow | olt/scripts/src/workflow/agents/transcript-telemetry.ts | 331
workflow | olt/scripts/src/workflow/completion/auto-sync-and-commit.ts | 344
workflow | olt/scripts/src/workflow/completion/critic-feedback-loop.ts | 301
workflow | olt/scripts/src/workflow/review/validate-review.ts | 318
```

## Exact fanout ownership

```text
directory | direct_ts_files
olt/scripts/src/authority | 12
olt/scripts/src/core/contracts | 14
olt/scripts/src/engine/runner | 63
olt/scripts/src/engine/scheduler | 18
olt/scripts/src/engine/store | 32
olt/scripts/src/graph | 36
olt/scripts/src/health | 19
olt/scripts/src/installer | 24
olt/scripts/src/mind | 51
olt/scripts/src/orchestrator | 25
olt/scripts/src/packets | 46
olt/scripts/src/platform | 16
olt/scripts/src/reporting | 43
olt/scripts/src/summary | 52
olt/scripts/src/summary/graph | 22
olt/scripts/src/summary/markdown | 14
olt/scripts/src/validation | 15
olt/scripts/src/workflow/branch | 11
olt/scripts/src/workflow/completion | 23
olt/scripts/src/workflow/lease | 12
olt/scripts/src/workflow/review | 15
olt/agents | 28
olt/references | 13
```

## Exact missing-facade ownership

```text
olt/scripts [P02: `olt/scripts/index.ts`; direct files `generate-cli-manifest.ts`, `harness.ts`]
olt/scripts/src/authority
olt/scripts/src/core/config
olt/scripts/src/core/contracts
olt/scripts/src/core/errors
olt/scripts/src/core/shared
olt/scripts/src/critic
olt/scripts/src/engine
olt/scripts/src/engine/runner
olt/scripts/src/installer
olt/scripts/src/integration
olt/scripts/src/linter
olt/scripts/src/orchestrator
olt/scripts/src/packets
olt/scripts/src/plan
olt/scripts/src/policy
olt/scripts/src/requirements
olt/scripts/src/roles
olt/scripts/src/runtime
olt/scripts/src/task
olt/scripts/src/testing
scripts [P03: `scripts/index.ts`; direct files `sync-global.ts`, `validate-agent-manifests.ts`, `verify-gen5.ts`]
scripts/testing [P03: `scripts/testing/index.ts`; direct files `test-changed.ts`, `test-mutex.ts`, `test-runner.ts`]
```

For directories beneath `olt/scripts/src`, the facade owner is the domain wave named by its first path
segment. P02 alone owns `olt/scripts/index.ts`; P03’s S7 wave alone owns `scripts/index.ts` and
`scripts/testing/index.ts`. Nested facades are owned by the wave that creates that slice. No other
worker edits those indexes.

### Exact executable-directory ownership

```text
P02 | olt/scripts/generate-cli-manifest.ts
P02 | olt/scripts/harness.ts
P02 | olt/scripts/index.ts
P03-S7 | scripts/sync-global.ts
P03-S7 | scripts/validate-agent-manifests.ts
P03-S7 | scripts/verify-gen5.ts
P03-S7 | scripts/index.ts
P03-S7 | scripts/testing/test-changed.ts
P03-S7 | scripts/testing/test-mutex.ts
P03-S7 | scripts/testing/test-runner.ts
P03-S7 | scripts/testing/index.ts
```

There is no TypeScript exception for executables. Each importable entrypoint exposes a named `main`
or library function and guards process execution with `import.meta.main`; importing either facade must
not run a command, mutate files, or exit the process.

## Domain DAG

```text
S1 core + platform + runtime
  └── S2 engine + scheduler + runner
        ├── S3 graph + heuristics + packets + requirements + policy + validation
        ├── S4 mind + logging + agents + roles + telemetry
        └── S5 workflow + authority + task + plan + watchdog
              └── S6 reporting + summary + health + capture
                    └── S7 critic + hooks + installer + integration + linter + orchestrator + testing + root-tooling + governance catalogs
```

Waves at the same indentation may run concurrently only when their exact path lists and facade paths are disjoint. Cross-domain export requests land through the destination’s facade owner before consumer rewrites.

## Per-file extraction protocol

Every oversized path in the ownership table follows this exact protocol:

1. Identify exported symbols and externally observed side effects.
2. Select an existing targeted assertion and prove it fails under a temporary counterfactual; tests remain read-only.
3. Restore the counterfactual and run that test green on the unsplit implementation.
4. Extract one cohesive responsibility into a named subdirectory or sibling module.
5. Keep the original public symbol at its existing facade; do not introduce a compatibility export-star.
6. Convert cross-directory consumers to the destination facade, retaining `import type` or `export type`.
7. Run targeted tests and `bun scripts/modularity/check.ts --mode ratchet --source index ...`.
8. Stop if behavior changes or any metric worsens.

### Task 1: S1 core and platform foundations

**Files:**

- Modify: rows whose wave is `core`, `platform`, or `runtime`.
- Create/modify facades: `olt/scripts/src/core/{config,contracts,errors,shared}/index.ts`, `olt/scripts/src/platform/index.ts`.
- Test: existing `tests/unit/core/**`, `tests/unit/contracts/**`, and platform tests.

**Interfaces:**

- Produces: stable contracts, errors, safe filesystem/process primitives, and explicit type/value facades.
- Consumes: no higher OLT domain.

- [ ] **Step 1: Select and falsify existing characterization assertions**

Assert serialized contracts, error codes, path validation, durable-write stages, and platform capability results.

- [ ] **Step 2: Run red-by-revert proof**

Temporarily redirect one asserted branch to the wrong result, run its targeted test, observe FAIL, then restore before implementation.
Expected: the test is falsifiable.

- [ ] **Step 3: Extract cohesive slices**

Keep contracts free of workflow imports. Split platform by locking, process identity, filesystem, and host capability. Ensure every new directory has at most nine implementation files plus its index.

- [ ] **Step 4: Run green gates**

Run: `bun scripts/testing/test-runner.ts tests/unit/core tests/unit/contracts`
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit and push**

Run: `git commit -m "refactor(core): establish bounded platform facades"`
Run: `git push origin main`
Expected: push succeeds.

### Task 2: S2 engine, scheduler, and runner

**Files:**

- Modify: rows whose wave is `engine`.
- Modify single-owner facades: `olt/scripts/src/engine/index.ts`, `engine/store/index.ts`, `engine/scheduler/index.ts`, and new runner slice indexes.
- Test: existing `tests/unit/engine/**`, `tests/unit/runner/**`, `tests/unit/scheduler/**`, and `tests/unit/store/**`.

**Interfaces:**

- Consumes: S1 contracts/platform facades.
- Produces: store, transaction, scheduler, attempt, process, and evidence APIs without engine-internal SCCs.

- [ ] **Step 1: Characterize store and runner boundaries**

Cover transaction commit classification, lock acquisition, process ownership, output pumping, cleanup, receipt signing, scheduler state transitions, and recovery.

- [ ] **Step 2: Split in this order**

`store → process identity → execution attempt → cleanup/recovery → scheduler`. This order prevents the runner’s low-level modules from importing scheduler orchestration.

- [ ] **Step 3: Break runner SCCs**

Move shared data types into leaf contract modules; make platform-specific pipe discovery depend on process identity, never the reverse. Separate signature calculation from validation input assembly.

- [ ] **Step 4: Run targeted gates**

Run: `bun scripts/testing/test-runner.ts tests/unit/engine tests/unit/runner tests/unit/scheduler tests/unit/store`
Expected: PASS.

Run the ratchet.
Expected: engine-owned line/fanout findings decrease and its four two-file SCCs disappear.

- [ ] **Step 5: Commit and push**

Run: `git commit -m "refactor(engine): split store runner and scheduler slices"`
Run: `git push origin main`
Expected: push succeeds.

### Task 3: S3 graph, requirements, policy, and validation

**Files:**

- Modify: rows whose wave is `graph`, `heuristics`, `packets`, `requirements`, `policy`, or `validation`.
- Modify facades: `graph/index.ts`, new `requirements/index.ts`, new `policy/index.ts`, and `validation/index.ts`.
- Test: matching test domains.

**Interfaces:**

- Consumes: S1–S2 facades.
- Produces: acyclic graph algorithms, plan contracts, RBAC/review policy, and validation engines.

- [ ] **Step 1: Characterize algorithms and policy decisions**

Use table-driven tests for topology, gate proof, dynamic expansion, role confinement, command authorization, anti-mock, and dual-channel analysis.

- [ ] **Step 2: Extract pure graph kernels**

Move adjacency, SCC-independent topology, gate modeling, and render adapters into separate slices. Resolve the `dag-forensics/parallel-decoupler/topology` SCC by directing all three to a leaf graph-contract module.

- [ ] **Step 3: Resolve requirements cycle**

Place shared enhanced-plan types in a leaf contract file so Markdown rendering depends on the model and not the reverse.

- [ ] **Step 4: Run green gates and ratchet**

Run matching `tests/unit/{graph,requirements,policy,validation}` paths.
Expected: PASS and zero owned SCCs.

- [ ] **Step 5: Commit and push**

Run: `git commit -m "refactor(policy): isolate graph and validation kernels"`
Run: `git push origin main`
Expected: push succeeds.

### Task 4: S4 mind, logging, agents, and roles

**Files:**

- Modify: rows whose wave is `mind`, `logging`, `agents`, `roles`, or `telemetry`.
- Modify facades: `mind/index.ts`, `mind/defects/index.ts`, `mind/lanes/index.ts`, `logging/index.ts`, `agents/index.ts`, and new `roles/index.ts`.
- Test: matching mind/logging/agents/roles tests.

**Interfaces:**

- Consumes: S1–S3.
- Produces: mind lifecycle, queues, defects, lanes, agent telemetry, and role descriptors.

- [ ] **Step 1: Characterize authority-bearing state transitions**

Cover admission, task/feedback queue mutation, defect promotion, pulse/round transitions, lane rescue, memory, and agent metadata.

- [ ] **Step 2: Split by state owner**

Separate parse/validate, pure decision, persistence transaction, and Markdown presentation. A persistence slice owns each ledger mutation; callers never perform unlocked read-modify-write.

- [ ] **Step 3: Break the 13-file defect/queue SCC**

Move shared defect and queue record types into leaf contracts. Logging consumes those types; mind persistence consumes logging’s append facade. Logging must not import mind aggregation.

- [ ] **Step 4: Break mind archival and rounds SCC**

Extract immutable round/archival transition inputs into a leaf state module; `archival.ts`, `gates.ts`, and `rounds.ts` depend on it in one direction.

- [ ] **Step 5: Run green gates, ratchet, commit, and push**

Run matching test domains and the ratchet.
Expected: zero S4 line/fanout/cycle findings.

Run: `git commit -m "refactor(mind): split lifecycle queues and defect services"`
Run: `git push origin main`.

### Task 5: S5 workflow, authority, task, and plan

**Files:**

- Modify: rows whose wave is `workflow`, `authority`, `task`, `plan`, or `watchdog`.
- Modify facades: every existing workflow index plus new `authority/index.ts`, `task/index.ts`, and `plan/index.ts`.
- Test: matching authority/task/plan/workflow tests.

**Interfaces:**

- Consumes: S1–S4.
- Produces: grant/session authority, task lifecycle, plan lifecycle, review, completion, lease, and worktree APIs.

- [ ] **Step 1: Characterize security and recovery paths**

Assert verified-session semantics, grant lifecycle, shell/RBAC enforcement, claim-submit-review transitions, committed-recovery-pending outcomes, and durable compensation.

- [ ] **Step 2: Split workflow by transition**

Each transition slice owns validation, event construction, state mutation, and result classification for one lifecycle operation. Shared records live in leaf contracts.

- [ ] **Step 3: Remove workflow type cycle**

Move the common completion/workflow record definitions into a leaf workflow contracts slice so `workflow/completion/types.ts` and `workflow/types.ts` no longer import each other.

- [ ] **Step 4: Run green gates and ratchet**

Run matching test domains.
Expected: PASS; no owned line/fanout/cycle finding remains.

- [ ] **Step 5: Commit and push**

Run: `git commit -m "refactor(workflow): isolate authority and lifecycle transitions"`
Run: `git push origin main`.

### Task 6: S6 reporting, summary, health, and capture

**Files:**

- Modify: rows whose wave is `reporting`, `summary`, `health`, or `capture`.
- Modify corresponding explicit facades.
- Test: matching reporting/summary/health/capture tests.

**Interfaces:**

- Consumes: stable domain facades only.
- Produces: reporting projections, summary models/renderers, health diagnostics, and capture validation.

- [ ] **Step 1: Characterize rendered output**

Snapshot Markdown, JSON, graph nodes/edges, timelines, health findings, capture manifests, and optical metrics.

- [ ] **Step 2: Separate projection from presentation**

Reporting and summary modules receive domain DTOs through facades; they may not import workflow persistence internals. Break presentation helpers into bounded renderer slices.

- [ ] **Step 3: Remove reporting participation in the former largest SCC**

Inject action registries or pure DTOs from composition roots. Reporting never imports CLI registries or command handlers.

- [ ] **Step 4: Run green gates, ratchet, commit, and push**

Run matching test domains.
Expected: byte-compatible output and zero S6 findings.

Run: `git commit -m "refactor(reporting): split projections renderers and diagnostics"`
Run: `git push origin main`.

### Task 7: S7 remaining domains and root tooling

**Files:**

- Modify: rows whose wave is `critic`, `hooks`, `installer`, `integration`, `linter`, `orchestrator`, `testing`, or `root-tooling`; also own fanout-only `olt/scripts/src/installer`, missing-facade-only `critic`, `integration`, and `installer`, `olt/agents/**`, and direct `olt/references/*` files outside P02-owned `cli-capabilities/**`.
- Modify corresponding facades.
- Modify: `scripts/sync-global.ts:1-6`.
- Modify: `scripts/validate-agent-manifests.ts:1-126`.
- Modify: `scripts/verify-gen5.ts:1-8`.
- Create: `scripts/index.ts:1`.
- Modify: `scripts/testing/test-changed.ts:1-248`.
- Modify: `scripts/testing/test-mutex.ts:1-101`.
- Modify: `scripts/testing/test-runner.ts:1-44`.
- Create: `scripts/testing/index.ts:1`.
- Modify: `scripts/testing/reporting/html/styles.ts`.
- Modify: `scripts/testing/reporting/html/client-script.ts`.
- Test: matching installer/integration/hooks/testing/orchestrator tests.

**Interfaces:**

- Consumes: final S1–S6 facades.
- Produces: bounded installers, hooks, orchestration services, test reporting assets, and remaining source slices.

- [ ] **Step 1: Characterize remaining behavior**

Cover installation transactions, lifecycle hooks, orchestration selection, and byte output of HTML reporting.

- [ ] **Step 2: Split root reporting payloads**

Move coherent CSS sections and client behaviors into bounded TypeScript modules under semantic subdirectories. They remain TypeScript and receive no line exemption.

- [ ] **Step 3: Shard governance manifests and references**

Group `olt/agents` manifests into role-tier semantic subdirectories and direct `olt/references` files into subject catalogs. Add explicit Markdown catalog indexes, update every repository consumer to the new catalog paths, keep each directory at ten files or fewer, and leave generated CLI capability artifacts under P02 ownership.

- [ ] **Step 4: Create safe root script facades**

Refactor the seven exact direct script entrypoints above so import-time evaluation is inert, export their
named callable APIs from `scripts/index.ts` and `scripts/testing/index.ts`, and retain direct CLI
behavior behind `import.meta.main`. Prove importing either index produces no stdout/stderr, filesystem
mutation, or process exit.

- [ ] **Step 5: Resolve remaining two-file SCCs**

For installer release actions/copy, put shared plan types in a leaf contract. Run the graph report and address any remaining component through dependency inversion, never a dynamic-import escape.

- [ ] **Step 6: Create all missing source indexes**

The exact 23-directory list above must be empty after this step. P03 resolves its 22 owned directories;
the P02-owned `olt/scripts` facade must already be green. Each index uses named exports and separates
`export type`.

- [ ] **Step 7: Run production strict candidate**

Run: `bun scripts/modularity/check.ts --mode ratchet --source index --baseline scripts/modularity/baseline/index.json --format json`
Expected: zero production line, production fanout, missing-facade, export-star, facade-bypass, and cycle findings. Test-only findings may remain for P04.

- [ ] **Step 8: Independent completeness review**

SOL/high reconciles every exact inventory row to a landed slice. Terra/high reviewer searches for behavior loss, compatibility re-exports, type/value import drift, unlocked persistence movement, and new cycles.

- [ ] **Step 9: Commit and push**

Run: `git commit -m "refactor(olt): complete production feature slices"`
Run: `git push origin main`
Expected: push succeeds.
