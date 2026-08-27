# OLT Test Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split every oversized or crowded test domain into mirrored, focused suites while preserving all assertions, hooks, fixtures, and behavioral coverage.

**Architecture:** Test waves follow the final production feature slices from P03. Shared fixtures and builders move behind explicit test-helper facades; test modules are never imported by an index. A before/after manifest proves that no test or assertion disappears during mechanical splitting.

**Tech Stack:** Bun test, existing repository test runner, TypeScript 5.7, P01 modularity guard

**Spec:** `docs/superpowers/specs/2026-08-27-olt-modularity-guardrail-design.md`

## Global Constraints

- Every TypeScript test and fixture is limited to 300 physical lines.
- Every test directory has at most 10 direct files, including helper indexes.
- Test directories mirror production feature slices.
- Test indexes export helpers, builders, and assertions only; they never import or export `*.test.ts`.
- Existing test names, assertion counts, hooks, timeouts, and serial/concurrent semantics are preserved.
- P04 owns `tests/**` except P01 guard tests; P05-owned `tests/unit/architecture/modularity-enforcement.test.ts`, `tests/unit/architecture/modularity-enforcement-fixture.ts`, and `tests/unit/authority/root-hygiene-guard.test.ts`; and the seven exact P02 paths below until explicit transfer.
- Production code is read-only in this plan.
- SOL/high reconciles coverage manifests; Terra/high implements and independently reviews.
- Every reviewed subgroup commits conventionally and pushes main.

### Temporary P02 test exclusion and transfer

```text
tests/unit/cli/manifest.test.ts
tests/unit/cli/manifest-sharding.test.ts
tests/unit/cli/registry-boundaries.test.ts
tests/unit/cli/registry.test.ts
tests/unit/cli/plan-formatter.test.ts
tests/unit/cli/next-actions.test.ts
tests/unit/cli/execute-middleware.test.ts
```

P04 treats these paths as read-only until P02 records its independent review verdict and pushed commit
SHA. The master then records the transfer; from that point P04 owns any required physical split and P02
is read-only. P04 never changes P02 assertions while P02 is active.

---

## Exact oversized-test ownership

```text
wave | path | physical_lines
agents | tests/unit/agents/agent-naming-integration.test.ts | 407
agents | tests/unit/agents/agent-reset.test.ts | 363
agents | tests/unit/agents/agent-triad.test.ts | 472
agents | tests/unit/agents/telemetry-merge.test.ts | 315
agents | tests/unit/agents/whoami-profiling.test.ts | 381
authority | tests/unit/authority/manifest-parser.test.ts | 1656
authority | tests/unit/authority/persona-grounding.test.ts | 790
authority | tests/unit/authority/review-pushback.test.ts | 710
authority | tests/unit/authority/session-registry.test.ts | 1245
authority | tests/unit/authority/thread-identifier.test.ts | 865
authority | tests/unit/authority/verbatim-role-injector.test.ts | 488
authority | tests/unit/authority/watchdog-manager.test.ts | 1761
capture | tests/unit/capture/focus-ring-optical.test.ts | 916
capture | tests/unit/capture/layout-shift-tracker.test.ts | 936
capture | tests/unit/capture/runner-manifest.test.ts | 383
cli | tests/unit/cli/agent-ops-command.test.ts | 729
cli | tests/unit/cli/branch-ops-command.test.ts | 423
cli | tests/unit/cli/cognitive-auditor-commands.test.ts | 303
cli | tests/unit/cli/critic-ready-fixture.ts | 316
cli | tests/unit/cli/critic-remediate.test.ts | 304
cli | tests/unit/cli/critic-start-review.test.ts | 481
cli | tests/unit/cli/dag-view.test.ts | 1100
cli | tests/unit/cli/diagnostics-ops-command.test.ts | 362
cli | tests/unit/cli/gate-prove-command.test.ts | 360
cli | tests/unit/cli/inspection-ops-command.test.ts | 304
cli | tests/unit/cli/meta-audit.test.ts | 487
cli | tests/unit/cli/next-actions.test.ts | 667
cli | tests/unit/cli/orchestrate-command.test.ts | 372
cli | tests/unit/cli/orchestrator-ops.test.ts | 308
cli | tests/unit/cli/plan-add-single-task.test.ts | 315
cli | tests/unit/cli/plan-brainstorm-command.test.ts | 438
cli | tests/unit/cli/plan-compile-replan.test.ts | 403
cli | tests/unit/cli/plan-formatter.test.ts | 374
cli | tests/unit/cli/plan-replan-helpers.test.ts | 459
cli | tests/unit/cli/plan-validate.test.ts | 446
cli | tests/unit/cli/queue-run-summary.test.ts | 383
cli | tests/unit/cli/registry.test.ts | 398
cli | tests/unit/cli/shell-interlock.test.ts | 616
cli | tests/unit/cli/task-brief.test.ts | 386
cli | tests/unit/cli/task-check.test.ts | 335
cli | tests/unit/cli/task-claim-submit.test.ts | 757
cli | tests/unit/cli/task-reject-repair.test.ts | 673
cli | tests/unit/cli/task-review-dual-channel.test.ts | 909
cli | tests/unit/cli/task-review-support.test.ts | 433
cli | tests/unit/cli/task-validate-probe-review.test.ts | 548
cli | tests/unit/cli/todo-ops.test.ts | 848
cli | tests/unit/cli/unified-reporting.test.ts | 462
cli | tests/unit/cli/watchdog-ops.test.ts | 448
cli | tests/unit/cli/whoami.test.ts | 387
config | tests/unit/config/harness-config.test.ts | 430
contracts | tests/unit/contracts/branch.test.ts | 302
contracts | tests/unit/contracts/formatters.test.ts | 383
contracts | tests/unit/contracts/shared-paths.test.ts | 397
core | tests/unit/core/dual-time.test.ts | 454
core | tests/unit/core/durable-runtime.test.ts | 436
core | tests/unit/core/safe-fs.test.ts | 356
defects | tests/unit/defects/defect-pipeline.test.ts | 1029
doctor | tests/unit/doctor/adversarial-doctor.test.ts | 421
doctor | tests/unit/doctor/tier-confinement.test.ts | 427
engine | tests/unit/engine/scheduler.test.ts | 364
graph | tests/unit/graph/dag-expansion.test.ts | 577
graph | tests/unit/graph/dag-forensics.test.ts | 567
graph | tests/unit/graph/dynamic-expansion.test.ts | 312
graph | tests/unit/graph/gate-proof.test.ts | 694
graph | tests/unit/graph/parallel-decoupler.test.ts | 524
health | tests/unit/health/intent.test.ts | 340
heuristics | tests/unit/heuristics/heuristics-edge-cases.test.ts | 1492
hooks | tests/unit/hooks/lifecycle-hooks.test.ts | 1194
installer | tests/unit/installer/release-actions.test.ts | 440
installer | tests/unit/installer/release-recovery.test.ts | 418
installer | tests/unit/installer/release-transaction.test.ts | 344
integration | tests/integration/cognitive-auditors-e2e.test.ts | 496
linter | tests/unit/linter/ast-enforcer.test.ts | 781
logging | tests/unit/logging/defect-logger.test.ts | 546
mind | tests/unit/mind/admission-gates.test.ts | 831
mind | tests/unit/mind/admission-negative.test.ts | 1950
mind | tests/unit/mind/anti-batching-pipeline.test.ts | 674
mind | tests/unit/mind/audit-planted.test.ts | 1405
mind | tests/unit/mind/audit.test.ts | 796
mind | tests/unit/mind/auditor-liveness-and-scope.test.ts | 408
mind | tests/unit/mind/briefing-builder.test.ts | 721
mind | tests/unit/mind/budget.test.ts | 841
mind | tests/unit/mind/cadence-rollover.test.ts | 845
mind | tests/unit/mind/cognitive-auditors.test.ts | 532
mind | tests/unit/mind/completed-tasks.test.ts | 952
mind | tests/unit/mind/counterfactual.test.ts | 579
mind | tests/unit/mind/damage.test.ts | 975
mind | tests/unit/mind/defect-audit.test.ts | 656
mind | tests/unit/mind/defect-promotion.test.ts | 967
mind | tests/unit/mind/defect-remediation-46.test.ts | 351
mind | tests/unit/mind/defects.test.ts | 880
mind | tests/unit/mind/digest.test.ts | 505
mind | tests/unit/mind/dynamic-roles.test.ts | 634
mind | tests/unit/mind/feedback-queue.test.ts | 694
mind | tests/unit/mind/generational-archival.test.ts | 1355
mind | tests/unit/mind/hierarchy-deploy.test.ts | 463
mind | tests/unit/mind/hierarchy-regression.test.ts | 644
mind | tests/unit/mind/hyper-cognition.test.ts | 597
mind | tests/unit/mind/lane-repair.test.ts | 525
mind | tests/unit/mind/lane-rescue.test.ts | 759
mind | tests/unit/mind/lane-selector.test.ts | 559
mind | tests/unit/mind/memory.test.ts | 703
mind | tests/unit/mind/meta-auditor.test.ts | 1572
mind | tests/unit/mind/mind-init.test.ts | 435
mind | tests/unit/mind/mind-pulse-open.test.ts | 683
mind | tests/unit/mind/mind-pulse-perpetual.test.ts | 380
mind | tests/unit/mind/mind-rotate.test.ts | 541
mind | tests/unit/mind/mind-wake.test.ts | 468
mind | tests/unit/mind/plan-91-dynamic-hierarchy.test.ts | 366
mind | tests/unit/mind/plan-revision.test.ts | 794
mind | tests/unit/mind/product-owner-dispatch.test.ts | 765
mind | tests/unit/mind/proposals.test.ts | 607
mind | tests/unit/mind/pulse-lifecycle-and-rotate-grant.test.ts | 327
mind | tests/unit/mind/pulse-reclaim.test.ts | 537
mind | tests/unit/mind/pulse-sh.test.ts | 331
mind | tests/unit/mind/quiesce.test.ts | 613
mind | tests/unit/mind/recycler.test.ts | 878
mind | tests/unit/mind/remote-safety.test.ts | 317
mind | tests/unit/mind/role-auditing.test.ts | 470
mind | tests/unit/mind/role-boundary-watchdog.test.ts | 453
mind | tests/unit/mind/rounds.test.ts | 796
mind | tests/unit/mind/smart-task-manager.test.ts | 1089
mind | tests/unit/mind/soak-injections.test.ts | 1137
mind | tests/unit/mind/sources.test.ts | 709
mind | tests/unit/mind/strategic-purpose.test.ts | 366
mind | tests/unit/mind/task-discovery.test.ts | 584
mind | tests/unit/mind/task-queue.test.ts | 923
mind | tests/unit/mind/todo-storage.test.ts | 400
mind | tests/unit/mind/value.test.ts | 481
mind | tests/unit/mind/witness.test.ts | 737
orchestrator | tests/unit/orchestrator/background-finalization.test.ts | 557
orchestrator | tests/unit/orchestrator/completion-audio.test.ts | 416
orchestrator | tests/unit/orchestrator/loop-runner.test.ts | 369
orchestrator | tests/unit/orchestrator/multi-capsule.test.ts | 500
orchestrator | tests/unit/orchestrator/topology-synthesis.test.ts | 546
packets | tests/unit/packets/capsule-memory.test.ts | 459
packets | tests/unit/packets/cli-query-integration.test.ts | 350
packets | tests/unit/packets/command-authority-fail-closed.test.ts | 944
packets | tests/unit/packets/command-authority.test.ts | 548
packets | tests/unit/packets/decoupled-memory.test.ts | 505
packets | tests/unit/packets/packet-slicing.test.ts | 652
packets | tests/unit/packets/rich-instructions.test.ts | 334
packets | tests/unit/packets/validation-round-context.test.ts | 535
plan | tests/unit/plan/pre-enhancer.test.ts | 560
policy | tests/unit/policy/rbac-engine.test.ts | 849
policy | tests/unit/policy/repo-policy.test.ts | 563
policy | tests/unit/policy/review-protocol.test.ts | 382
reporting | tests/unit/reporting/adversarial-doctor.test.ts | 468
reporting | tests/unit/reporting/behavioral-health.test.ts | 1039
reporting | tests/unit/reporting/event-stream.test.ts | 576
reporting | tests/unit/reporting/graph-json.test.ts | 378
reporting | tests/unit/reporting/handoff-argv-registry.test.ts | 418
reporting | tests/unit/reporting/integration-verification.test.ts | 318
reporting | tests/unit/reporting/living-tracer.test.ts | 579
reporting | tests/unit/reporting/screenshot-ingestion.test.ts | 421
reporting | tests/unit/reporting/split-channel-defect-router.test.ts | 328
reporting | tests/unit/reporting/state-machine-auditor.test.ts | 528
reporting | tests/unit/reporting/sugiyama-dag-subagent-expansion.test.ts | 399
reporting | tests/unit/reporting/sugiyama-dag.test.ts | 505
reporting | tests/unit/reporting/theme-contrast-matrix.test.ts | 720
reporting | tests/unit/reporting/tier-confinement.test.ts | 822
reporting | tests/unit/reporting/time-telemetry.test.ts | 500
reporting | tests/unit/reporting/unified.test.ts | 358
reporting | tests/unit/reporting/workflow-view.test.ts | 359
roles | tests/unit/roles/meta-auditor-role.test.ts | 342
runner | tests/unit/runner/attempt-failure-cleanup.test.ts | 359
runner | tests/unit/runner/attempt-success-evidence.test.ts | 308
runner | tests/unit/runner/process-timeout-watchdog.test.ts | 732
runner | tests/unit/runner/run-command.test.ts | 860
runtime | tests/unit/runtime/agent-metadata.test.ts | 422
scheduler | tests/unit/scheduler/core-engine.test.ts | 845
scheduler | tests/unit/scheduler/critic-feedback.test.ts | 636
scheduler | tests/unit/scheduler/dynamic-topology.test.ts | 525
scheduler | tests/unit/scheduler/multi-domain-dispatch.test.ts | 830
scheduler | tests/unit/scheduler/script-backed-diagnostics.test.ts | 538
scheduler | tests/unit/scheduler/skill-auditor-policy.test.ts | 362
scheduler | tests/unit/scheduler/unlimited-depth.test.ts | 693
scripts | tests/unit/scripts/coverage-reporting.test.ts | 443
store | tests/unit/store/capsule-index.test.ts | 375
store | tests/unit/store/event-append.test.ts | 366
store | tests/unit/store/event-stream.test.ts | 382
store | tests/unit/store/layout-integrity.test.ts | 413
summary | tests/unit/summary/completeness-run-phases.ts | 353
summary | tests/unit/summary/graph-branch-subgraph.test.ts | 304
summary | tests/unit/summary/graph-node-evidence.test.ts | 357
summary | tests/unit/summary/graph-validator-nodes.test.ts | 332
summary | tests/unit/summary/host-telemetry.test.ts | 317
summary | tests/unit/summary/markdown-fixtures.ts | 390
summary | tests/unit/summary/markdown-formatter-topology.test.ts | 375
summary | tests/unit/summary/markdown-run-report-fixture.ts | 502
summary | tests/unit/summary/timeline-collector.test.ts | 457
tasks | tests/unit/tasks/review-pushback.test.ts | 641
telemetry | tests/unit/telemetry/circuit-breaker.test.ts | 386
telemetry | tests/unit/telemetry/collectors.test.ts | 784
telemetry | tests/unit/telemetry/dag-snapshot.test.ts | 417
test-isolation.test.ts | tests/unit/test-isolation.test.ts | 329
testing | tests/unit/testing/concurrency-lock.test.ts | 389
testing | tests/unit/testing/scoped-execution.test.ts | 365
validation | tests/unit/validation/anti-batching.test.ts | 689
validation | tests/unit/validation/anti-leak.test.ts | 609
validation | tests/unit/validation/anti-mock-engine.test.ts | 718
validation | tests/unit/validation/dual-channel-analyzer.test.ts | 1091
validation | tests/unit/validation/dual-channel-negative-bounds.test.ts | 313
validation | tests/unit/validation/validator-hardlock.test.ts | 618
validation | tests/unit/validation/validator-specialization.test.ts | 621
watchdog | tests/unit/watchdog/process-timeout.test.ts | 711
watchdog | tests/unit/watchdog/reactive-wakeups.test.ts | 524
watchdog | tests/unit/watchdog/watchdog-timer.test.ts | 736
workflow | tests/unit/workflow/agents/grants.test.ts | 569
workflow | tests/unit/workflow/agents/telemetry-merge.test.ts | 439
workflow | tests/unit/workflow/authority-decisions.test.ts | 308
workflow | tests/unit/workflow/branch/repository-observation.test.ts | 302
workflow | tests/unit/workflow/branch/sub-tasks.test.ts | 342
workflow | tests/unit/workflow/gates-completion.test.ts | 310
workflow | tests/unit/workflow/heuristics-workflow.test.ts | 830
workflow | tests/unit/workflow/micro-cycle.test.ts | 485
workflow | tests/unit/workflow/plan-review.test.ts | 449
workflow | tests/unit/workflow/review/probe.test.ts | 339
workflow | tests/unit/workflow/sync-workflow.test.ts | 770
workflow | tests/unit/workflow/task-check.test.ts | 1097
workflow | tests/unit/workflow/worktree/consolidate.test.ts | 308
workflow | tests/unit/workflow/worktree/provision.test.ts | 341
workflow | tests/unit/workflow/write-scope-hash.test.ts | 351
worktree | tests/unit/worktree/domain-sync.test.ts | 680
worktree | tests/unit/worktree/git-preservation-integration.test.ts | 339
worktree | tests/unit/worktree/phase-commits.test.ts | 462
```

## Exact test-fanout ownership

```text
directory | direct_ts_files
tests/unit/agents | 15
tests/unit/cli | 85
tests/unit/contracts | 21
tests/unit/graph | 43
tests/unit/health | 16
tests/unit/installer | 26
tests/unit/mind | 85
tests/unit/orchestrator | 25
tests/unit/packets | 60
tests/unit/reporting | 45
tests/unit/runner | 74
tests/unit/scheduler | 17
tests/unit/store | 33
tests/unit/summary | 51
tests/unit/telemetry | 11
tests/unit/validation | 11
tests/unit/workflow | 54
tests/unit/workflow/branch | 13
tests/unit/workflow/completion | 13
tests/unit/workflow/review | 13
```

## Wave DAG and facade ownership

```text
T1 config + contracts + core + runtime + store + testing + test-isolation
  ├── T2 engine + runner + scheduler + watchdog
  ├── T3 mind + agents + roles + logging + defects + telemetry
  └── T4 authority + cli + packets + plan + policy + tasks + validation + workflow + worktree
        └── T5 capture + doctor + graph + health + heuristics + reporting + summary
              └── T6 hooks + installer + integration + linter + orchestrator + scripts
```

Each top-level test domain has one helper-facade owner. Nested production slices receive matching nested test directories. Workers may move tests into their owned nested directories but may not edit another wave’s `index.ts`.

## Preservation manifest

Before splitting an oversized test, record a machine-readable in-memory manifest from Bun’s test output:

```ts
export interface TestManifestEntry {
  readonly fullName: string;
  readonly sourcePath: string;
  readonly status: "pass" | "skip";
}
```

The before/after comparison requires the same set of full test names and the same skip set. Assertion-specific coverage is protected by characterization and mutation/falsification checks; raw assertion count alone is not accepted as proof.

### Task 1: Build test splitting helpers and invariants

**Files:**

- Create: `tests/support/test-manifest.ts:1`
- Create: `tests/support/test-module-boundary.ts:1`
- Modify: `tests/support/index.ts:1` if present, otherwise create it.
- Create: `tests/unit/test-architecture/test-index-boundary.test.ts:1`
- Create: `tests/unit/test-architecture/test-manifest.test.ts:1`
- Create: `tests/unit/test-architecture/index.ts:1`

**Interfaces:**

- Produces: `parseTestManifest(output: string): readonly TestManifestEntry[]`, `compareTestManifests(before, after): void`, `assertHelperIndex(sourcePath, bytes): void`.
- Consumes: Bun test reporter output and Git-indexed test blobs.

- [ ] **Step 1: Write failing boundary tests**

```ts
test("rejects an index that imports a test module", () => {
  expect(() =>
    assertHelperIndex("tests/unit/x/index.ts", 'export { x } from "./x.test.ts";'),
  ).toThrow("test modules");
});
test("rejects a missing test name after a split", () => {
  expect(() =>
    compareTestManifests(
      [{ fullName: "suite > case", sourcePath: "old.test.ts", status: "pass" }],
      [],
    ),
  ).toThrow("suite > case");
});
```

- [ ] **Step 2: Run red tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/test-architecture`
Expected: FAIL because helper modules do not exist.

- [ ] **Step 3: Implement helpers**

Parse only stable test result lines; reject duplicate names and malformed output. The index check parses static imports/exports and rejects any specifier resolving to `.test.ts`.

- [ ] **Step 4: Run green tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/test-architecture`
Expected: PASS.

- [ ] **Step 5: Commit and push**

Run: `git commit -m "test(architecture): preserve suites during test slicing"`
Run: `git push origin main`.

### Task 2: Execute T1 foundation tests

**Files:**

- Modify: exact inventory rows with waves `config`, `contracts`, `core`, `runtime`, `store`, `test-isolation.test.ts`, and `testing`.
- Create: mirrored nested directories and helper-only indexes under those domains.

**Interfaces:**

- Consumes: P03 core/platform/store facades.
- Produces: focused contract, durability, filesystem, isolation, and test-runner suites.

- [ ] **Step 1: Capture before manifests**

Run each exact oversized test path through `bun scripts/testing/test-runner.ts <path>` and retain its parsed manifest in the reviewer evidence.

- [ ] **Step 2: Split by production responsibility**

Move shared setup into `fixture.ts`, `builders.ts`, or `assertions.ts`; export those through the local index. Move `describe` blocks into `*.test.ts` files matching the P03 slice.

- [ ] **Step 3: Run after manifests and modularity ratchet**

Expected: identical full test-name/skip sets; zero T1 line/fanout findings.

- [ ] **Step 4: Commit and push**

Run: `git commit -m "test(core): split foundation suites by feature"`
Run: `git push origin main`.

### Task 3: Execute T2 execution lifecycle tests

**Files:**

- Modify: exact rows with waves `engine`, `runner`, `scheduler`, or `watchdog`.
- Create: mirrored test slices beneath those domains.
- Single-owner helper facades: each domain’s `index.ts`.

**Interfaces:**

- Consumes: P03 engine/runner/scheduler facades.
- Produces: focused attempt, process, cleanup, recovery, scheduler, and watchdog suites.

- [ ] **Step 1: Capture before manifests and timeout behavior**

Record test names, skips, explicit timeouts, fake-clock setup, and subprocess cleanup hooks.

- [ ] **Step 2: Split without sharing process state**

Each subprocess/concurrency suite keeps its own lifecycle hooks. Helpers may construct inputs but may not retain mutable process handles across test modules.

- [ ] **Step 3: Run targeted domains**

Run: `bun scripts/testing/test-runner.ts tests/unit/engine tests/unit/runner tests/unit/scheduler tests/unit/watchdog`
Expected: PASS with identical manifests and no leaked children.

- [ ] **Step 4: Run ratchet, review, commit, and push**

Expected: zero T2 test line/fanout findings.

Run: `git commit -m "test(engine): split execution lifecycle suites"`
Run: `git push origin main`.

### Task 4: Execute T3 mind and agent tests

**Files:**

- Modify: exact rows with waves `mind`, `agents`, `roles`, `logging`, `defects`, or `telemetry`.
- Create: mirrored test slices and helper-only indexes.

**Interfaces:**

- Consumes: P03 mind/logging/agents/roles facades.
- Produces: focused admission, pulse, queue, defects, memory, lane, grant, and role suites.

- [ ] **Step 1: Capture before manifests and ledger isolation**

Record every suite name and verify each module creates its own scratch repo or resets global hooks in `afterEach`.

- [ ] **Step 2: Split by state transition**

Separate happy path, invalid state, persistence fault injection, concurrency, and formatting into distinct bounded files inside the matching feature directory.

- [ ] **Step 3: Preserve adversarial cases**

No negative or injected-failure test may move into a generic “misc” module. Name it after the invariant it falsifies.

- [ ] **Step 4: Run domains and ratchet**

Run matching test directories.
Expected: PASS, identical manifests, zero T3 line/fanout findings.

- [ ] **Step 5: Commit and push**

Run: `git commit -m "test(mind): split governance and agent suites"`
Run: `git push origin main`.

### Task 5: Execute T4 CLI, packet, workflow, policy, and validation tests

**Files:**

- Modify: exact rows with waves `authority`, `cli`, `packets`, `plan`, `policy`, `tasks`, `validation`, `workflow`, or `worktree`.
- Create: directories mirroring P02/P03 CLI and workflow feature slices.
- Single-owner helper indexes in each nested directory.
- Modify only after recorded transfer: the seven exact temporary P02 paths above; among them, split the oversized `registry.test.ts`, `plan-formatter.test.ts`, and `next-actions.test.ts` while preserving P02 assertions.

**Interfaces:**

- Consumes: final CLI registry/command facades and workflow/policy facades.
- Produces: focused command, authority-packet, lifecycle, RBAC, and validation suites.

- [ ] **Step 1: Capture before manifests and output snapshots**

Record command aliases, JSON/Markdown result snapshots, error codes, and authority fixtures.

- [ ] **Step 2: Split CLI tests by command family**

Mirror `commands/<feature>/`, `registry/<feature>/`, and `formatters/<feature>/`. Shared `execute` fixtures live behind a helper facade; no command test imports another command test.

- [ ] **Step 3: Split workflow tests by transition**

Mirror claim, submission, review, completion, branch, lease, worktree, authority, and recovery slices.

- [ ] **Step 4: Run targeted domains**

Run: `bun scripts/testing/test-runner.ts tests/unit/cli tests/unit/packets tests/unit/workflow tests/unit/policy tests/unit/validation`
Expected: PASS and identical manifests.

- [ ] **Step 5: Run ratchet, review, commit, and push**

Expected: zero T4 line/fanout findings.

Run: `git commit -m "test(workflow): split command and lifecycle suites"`
Run: `git push origin main`.

### Task 6: Execute T5 graph, reporting, summary, health, and capture tests

**Files:**

- Modify: exact rows with waves `capture`, `doctor`, `graph`, `health`, `heuristics`, `reporting`, or `summary`.
- Create: mirrored renderer, projection, graph, metric, and capture slices.

**Interfaces:**

- Consumes: P03 graph/reporting/summary/health/capture facades.
- Produces: focused algorithm, rendering, telemetry, and optical validation suites.

- [ ] **Step 1: Capture before manifests and byte snapshots**

Store test-name manifests and verify current Markdown/JSON/graph snapshots before movement.

- [ ] **Step 2: Split algorithm from rendering cases**

Graph fixtures remain reusable helpers; renderer assertions live in test modules. Summary fixture indexes expose data builders but never test suites.

- [ ] **Step 3: Run targeted domains**

Run matching directories.
Expected: PASS with byte-identical output and identical test manifests.

- [ ] **Step 4: Run ratchet, review, commit, and push**

Expected: zero T5 line/fanout findings.

Run: `git commit -m "test(reporting): split graph and presentation suites"`
Run: `git push origin main`.

### Task 7: Execute T6 remaining test domains and completeness reconciliation

**Files:**

- Modify: exact inventory rows with waves `hooks`, `installer`, `integration`, `linter`, `orchestrator`, or `scripts`.
- Create: matching bounded test slices and helper-only indexes.

**Interfaces:**

- Consumes: all final production facades.
- Produces: zero test line/fanout violations and a complete before/after manifest reconciliation.

- [ ] **Step 1: Split each remaining exact path**

Apply the preservation protocol without moving tests across domain ownership.

- [ ] **Step 2: Scan test indexes**

Run the helper-index architecture test across every `tests/**/index.ts`.
Expected: no index references a `.test.ts` module.

- [ ] **Step 3: Run test strict candidate**

Run: `bun scripts/modularity/check.ts --mode ratchet --source index --baseline scripts/modularity/baseline/index.json --format json`
Expected: zero test line and fanout findings.

- [ ] **Step 4: Run complete tests**

Run: `bun run test`
Expected: PASS with the same full test-name set and skip set as the reconciled baseline.

- [ ] **Step 5: Independent completeness review**

SOL/high maps every one of the 226 inventory rows and every test fanout directory to a committed slice. Terra/high reviewer checks hooks, timeouts, concurrency isolation, negative cases, and helper-only indexes.

- [ ] **Step 6: Commit and push**

Run: `git commit -m "test(olt): complete mirrored feature suites"`
Run: `git push origin main`
Expected: push succeeds.
