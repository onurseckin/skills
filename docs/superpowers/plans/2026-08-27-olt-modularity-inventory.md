# OLT Modularity Baseline Inventory

**Snapshot:** Git index at `1e3b96c0ae297a1a037b5b5a11fa4447e76e4556` on 2026-08-27
**Scope:** Round 26 only
**Authority:** [OLT Modularity Guardrail Design](../specs/2026-08-27-olt-modularity-guardrail-design.md)

## Measurement contract

The inventory is derived from Git-index blobs, never the mutable working tree. Physical lines are newline-delimited source lines; a file passes at 300 and fails at 301. Direct fanout counts direct in-scope files in a directory, including `index.ts`. The scan includes tracked first-party TypeScript-family files and first-party generated CLI JSON/Markdown. It excludes `.olt/**`, `.git/**`, `node_modules/**`, `scratch/**`, `capsules/**`, runtime output directories, `coverage/**`, cache directories, `dist/**`, `build/**`, `out/**`, `vendored/**`, `vendor/**`, `third_party/**`, and lockfiles.

A preliminary audit reported 1,811 TypeScript files and 403 oversized files because it omitted root `scripts/**` and treated first-party `olt/scripts/src/runtime/**` as generated runtime output. This inventory supersedes it. `olt/scripts/src/runtime/**` is production source, and `tests/unit/runtime/**` is test source.

## Summary

| Measure                                                   | Baseline |
| --------------------------------------------------------- | -------: |
| Tracked TypeScript-family files                           |    1,844 |
| Files over 300 physical lines                             |      406 |
| Oversized files under `olt/**`                            |      178 |
| Oversized files under `tests/**`                          |      226 |
| Oversized files under root `scripts/**`                   |        2 |
| Directories with more than 10 direct in-scope files       |       52 |
| TS-family fanout violations                               |       45 |
| Generated CLI fanout violations                           |        5 |
| Other Markdown/YAML/JSON fanout violations                |        2 |
| Production source directories missing `index.ts`          |       23 |
| Cross-folder imports/exports bypassing an existing facade |    1,234 |
| Strongly connected components                             |       12 |
| Files participating in SCCs                               |       93 |
| Largest SCC                                               |       57 |
| Generated CLI artifacts                                   |      147 |
| Generated CLI files over 300 lines                        |        4 |
| Generated CLI directories over fanout limit               |        5 |

## Oversized TypeScript-family files

Every row is a current violation. There are no TypeScript line-count exemptions.

```text
path | physical_lines
olt/scripts/src/agents/agent-triad.ts | 752
olt/scripts/src/agents/naming.ts | 484
olt/scripts/src/authority/manifest-parser.ts | 1331
olt/scripts/src/authority/persona-grounding.ts | 945
olt/scripts/src/authority/pillars.ts | 303
olt/scripts/src/authority/review-pushback.ts | 763
olt/scripts/src/authority/session-registry.ts | 863
olt/scripts/src/authority/supervisory-persona-reminder.ts | 1212
olt/scripts/src/authority/thread-identifier.ts | 983
olt/scripts/src/authority/watchdog-manager.ts | 1243
olt/scripts/src/capture/runners/dom-event-simulator.ts | 664
olt/scripts/src/capture/runners/layout-shift-tracker.ts | 749
olt/scripts/src/capture/runners/live-capture-runner.ts | 346
olt/scripts/src/capture/validator/cognitive/cognitive-questions.ts | 408
olt/scripts/src/capture/validator/mechanical/focus-ring-optical.ts | 828
olt/scripts/src/cli/commands/agent-ops.ts | 320
olt/scripts/src/cli/commands/critic-ops.ts | 374
olt/scripts/src/cli/commands/dag-view.ts | 1061
olt/scripts/src/cli/commands/dag.ts | 303
olt/scripts/src/cli/commands/defect-audit.ts | 954
olt/scripts/src/cli/commands/diagnostics-ops.ts | 324
olt/scripts/src/cli/commands/mind-admit.ts | 349
olt/scripts/src/cli/commands/mind-audit.ts | 472
olt/scripts/src/cli/commands/mind-pulse-open.ts | 318
olt/scripts/src/cli/commands/mind-pulse.ts | 955
olt/scripts/src/cli/commands/mind-round.ts | 365
olt/scripts/src/cli/commands/plan.ts | 438
olt/scripts/src/cli/commands/run-ops.ts | 584
olt/scripts/src/cli/commands/shell.ts | 382
olt/scripts/src/cli/commands/smart-task-ops.ts | 437
olt/scripts/src/cli/commands/task-brief.ts | 343
olt/scripts/src/cli/commands/task-check.ts | 857
olt/scripts/src/cli/commands/task-claim.ts | 438
olt/scripts/src/cli/commands/task-review-support.ts | 315
olt/scripts/src/cli/commands/task-review.ts | 452
olt/scripts/src/cli/commands/todo-ops.ts | 516
olt/scripts/src/cli/commands/watchdog-ops.ts | 478
olt/scripts/src/cli/execute.ts | 301
olt/scripts/src/cli/formatters/next-actions.ts | 1218
olt/scripts/src/cli/formatters/plan-formatter.ts | 419
olt/scripts/src/cli/formatters/task-formatter.ts | 311
olt/scripts/src/cli/registry/mind.ts | 725
olt/scripts/src/cli/registry/plan.ts | 506
olt/scripts/src/cli/registry/reporting.ts | 488
olt/scripts/src/cli/registry/task.ts | 418
olt/scripts/src/core/config/harness-config.ts | 527
olt/scripts/src/core/dual-time.ts | 911
olt/scripts/src/core/shared/safe-fs.ts | 340
olt/scripts/src/engine/runner/process-timeout-watchdog.ts | 902
olt/scripts/src/engine/runner/run-command.ts | 439
olt/scripts/src/engine/scheduler/core-engine.ts | 1974
olt/scripts/src/engine/scheduler/critic-feedback.ts | 716
olt/scripts/src/engine/scheduler/diagnostics.ts | 731
olt/scripts/src/engine/scheduler/dynamic-topology.ts | 608
olt/scripts/src/engine/scheduler/multi-domain-dispatch.ts | 783
olt/scripts/src/engine/scheduler/pulse.ts | 367
olt/scripts/src/engine/scheduler/unlimited-depth.ts | 544
olt/scripts/src/engine/store/capsule-index.ts | 382
olt/scripts/src/engine/store/content-normalization/ecmascript-whitespace.ts | 314
olt/scripts/src/engine/store/content-normalization/yaml-canonical.ts | 476
olt/scripts/src/engine/store/event-append.ts | 335
olt/scripts/src/engine/worktree/domain-sync.ts | 724
olt/scripts/src/engine/worktree/phase-commits.ts | 496
olt/scripts/src/graph/brainstorm-engine.ts | 393
olt/scripts/src/graph/dag-expansion.ts | 806
olt/scripts/src/graph/dag-forensics.ts | 1162
olt/scripts/src/graph/dynamic-expansion.ts | 1030
olt/scripts/src/graph/gate-proof.ts | 539
olt/scripts/src/graph/parallel-decoupler.ts | 971
olt/scripts/src/graph/plan-audit.ts | 474
olt/scripts/src/graph/unified-plan.ts | 514
olt/scripts/src/heuristics/glass-surfaces.ts | 593
olt/scripts/src/heuristics/modal-focus-traps.ts | 320
olt/scripts/src/heuristics/multi-viewport-manifest.ts | 888
olt/scripts/src/heuristics/subpixel-borders.ts | 658
olt/scripts/src/hooks/config.ts | 366
olt/scripts/src/hooks/dispatcher.ts | 708
olt/scripts/src/linter/ast-enforcer.ts | 1769
olt/scripts/src/logging/defect-logger.ts | 821
olt/scripts/src/mind/archival.ts | 1293
olt/scripts/src/mind/audit.ts | 983
olt/scripts/src/mind/brief.ts | 734
olt/scripts/src/mind/briefing-builder.ts | 1116
olt/scripts/src/mind/budget.ts | 484
olt/scripts/src/mind/cadence.ts | 605
olt/scripts/src/mind/charter.ts | 471
olt/scripts/src/mind/cognitive-auditors.ts | 664
olt/scripts/src/mind/cognitive-flavor.ts | 804
olt/scripts/src/mind/completed-tasks.ts | 719
olt/scripts/src/mind/counterfactual.ts | 632
olt/scripts/src/mind/defects.ts | 2099
olt/scripts/src/mind/defects/aggregator.ts | 355
olt/scripts/src/mind/defects/defect-loop.ts | 578
olt/scripts/src/mind/deploy.ts | 510
olt/scripts/src/mind/digest.ts | 953
olt/scripts/src/mind/dynamic-roles.ts | 1352
olt/scripts/src/mind/feedback-queue.ts | 1388
olt/scripts/src/mind/gates.ts | 967
olt/scripts/src/mind/hyper-cognition.ts | 1122
olt/scripts/src/mind/interval.ts | 568
olt/scripts/src/mind/lanes/rescue.ts | 922
olt/scripts/src/mind/liveness.ts | 527
olt/scripts/src/mind/memory.ts | 1609
olt/scripts/src/mind/meta-auditor.ts | 1430
olt/scripts/src/mind/mind.ts | 583
olt/scripts/src/mind/proposal.ts | 1429
olt/scripts/src/mind/pushbacks.ts | 508
olt/scripts/src/mind/quiesce.ts | 336
olt/scripts/src/mind/recycler.ts | 908
olt/scripts/src/mind/role-auditing.ts | 2208
olt/scripts/src/mind/rotate.ts | 401
olt/scripts/src/mind/rounds.ts | 624
olt/scripts/src/mind/self-evolution.ts | 1000
olt/scripts/src/mind/smart-task-manager.ts | 3577
olt/scripts/src/mind/sources.ts | 474
olt/scripts/src/mind/strategic-purpose.ts | 810
olt/scripts/src/mind/task-discovery.ts | 1711
olt/scripts/src/mind/task-queue.ts | 1873
olt/scripts/src/mind/witness.ts | 356
olt/scripts/src/orchestrator/completion-audio.ts | 607
olt/scripts/src/orchestrator/loop-runner.ts | 324
olt/scripts/src/orchestrator/multi-capsule.ts | 962
olt/scripts/src/orchestrator/supervision-loop.ts | 760
olt/scripts/src/orchestrator/supervisor.ts | 354
olt/scripts/src/orchestrator/topology-synthesis.ts | 1007
olt/scripts/src/orchestrator/watchdog.ts | 307
olt/scripts/src/packets/capsule-memory.ts | 656
olt/scripts/src/packets/command-authority.ts | 605
olt/scripts/src/packets/dynamic-steps.ts | 415
olt/scripts/src/packets/packet-slicing.ts | 951
olt/scripts/src/packets/role-contract.ts | 525
olt/scripts/src/plan/pre-enhancer.ts | 1199
olt/scripts/src/policy/rbac-engine.ts | 776
olt/scripts/src/policy/repo-policy.ts | 1130
olt/scripts/src/policy/review-protocol.ts | 301
olt/scripts/src/reporting/behavioral-auditor.ts | 822
olt/scripts/src/reporting/doctor.ts | 404
olt/scripts/src/reporting/doctor/adversarial-doctor.ts | 929
olt/scripts/src/reporting/doctor/tier-confinement.ts | 1091
olt/scripts/src/reporting/event-stream.ts | 495
olt/scripts/src/reporting/living-tracer.ts | 1254
olt/scripts/src/reporting/socratic-validator.ts | 504
olt/scripts/src/reporting/sugiyama-dag.ts | 1234
olt/scripts/src/reporting/theme-contrast-matrix.ts | 1056
olt/scripts/src/reporting/time-telemetry.ts | 1215
olt/scripts/src/reporting/unified.ts | 716
olt/scripts/src/roles/cheat-sheets.ts | 424
olt/scripts/src/runtime/agent-metadata.ts | 824
olt/scripts/src/summary/graph/graph-edge-factory.ts | 354
olt/scripts/src/summary/graph/graph-run-facts.ts | 305
olt/scripts/src/summary/graph/graph-types.ts | 358
olt/scripts/src/summary/markdown/markdown-execution-sections.ts | 321
olt/scripts/src/summary/markdown/markdown-sources.ts | 376
olt/scripts/src/summary/metrics/host-telemetry.ts | 337
olt/scripts/src/summary/metrics/metrics-collector-helpers.ts | 348
olt/scripts/src/summary/metrics/timeline-collector.ts | 436
olt/scripts/src/telemetry/circuit-breaker.ts | 469
olt/scripts/src/telemetry/collectors/antigravity.ts | 314
olt/scripts/src/telemetry/collectors/claude.ts | 364
olt/scripts/src/telemetry/collectors/openai.ts | 475
olt/scripts/src/telemetry/dag-snapshot.ts | 523
olt/scripts/src/telemetry/engine.ts | 332
olt/scripts/src/testing/concurrency-lock.ts | 579
olt/scripts/src/testing/isolation.ts | 444
olt/scripts/src/testing/scoped-execution.ts | 550
olt/scripts/src/validation/anti-leak.ts | 758
olt/scripts/src/validation/ast-linter.ts | 706
olt/scripts/src/validation/dual-channel-analyzer.ts | 897
olt/scripts/src/validation/mutation-gate.ts | 496
olt/scripts/src/watchdog/autonomic-watchdog.ts | 1101
olt/scripts/src/watchdog/boot-gate-enforcer.ts | 488
olt/scripts/src/watchdog/process-timeout.ts | 904
olt/scripts/src/workflow/agents/grants.ts | 449
olt/scripts/src/workflow/agents/telemetry-merge.ts | 364
olt/scripts/src/workflow/agents/transcript-telemetry.ts | 331
olt/scripts/src/workflow/completion/auto-sync-and-commit.ts | 344
olt/scripts/src/workflow/completion/critic-feedback-loop.ts | 301
olt/scripts/src/workflow/review/validate-review.ts | 318
scripts/testing/reporting/html/client-script.ts | 326
scripts/testing/reporting/html/styles.ts | 374
tests/integration/cognitive-auditors-e2e.test.ts | 496
tests/unit/agents/agent-naming-integration.test.ts | 407
tests/unit/agents/agent-reset.test.ts | 363
tests/unit/agents/agent-triad.test.ts | 472
tests/unit/agents/telemetry-merge.test.ts | 315
tests/unit/agents/whoami-profiling.test.ts | 381
tests/unit/authority/manifest-parser.test.ts | 1656
tests/unit/authority/persona-grounding.test.ts | 790
tests/unit/authority/review-pushback.test.ts | 710
tests/unit/authority/session-registry.test.ts | 1245
tests/unit/authority/thread-identifier.test.ts | 865
tests/unit/authority/verbatim-role-injector.test.ts | 488
tests/unit/authority/watchdog-manager.test.ts | 1761
tests/unit/capture/focus-ring-optical.test.ts | 916
tests/unit/capture/layout-shift-tracker.test.ts | 936
tests/unit/capture/runner-manifest.test.ts | 383
tests/unit/cli/agent-ops-command.test.ts | 729
tests/unit/cli/branch-ops-command.test.ts | 423
tests/unit/cli/cognitive-auditor-commands.test.ts | 303
tests/unit/cli/critic-ready-fixture.ts | 316
tests/unit/cli/critic-remediate.test.ts | 304
tests/unit/cli/critic-start-review.test.ts | 481
tests/unit/cli/dag-view.test.ts | 1100
tests/unit/cli/diagnostics-ops-command.test.ts | 362
tests/unit/cli/gate-prove-command.test.ts | 360
tests/unit/cli/inspection-ops-command.test.ts | 304
tests/unit/cli/meta-audit.test.ts | 487
tests/unit/cli/next-actions.test.ts | 667
tests/unit/cli/orchestrate-command.test.ts | 372
tests/unit/cli/orchestrator-ops.test.ts | 308
tests/unit/cli/plan-add-single-task.test.ts | 315
tests/unit/cli/plan-brainstorm-command.test.ts | 438
tests/unit/cli/plan-compile-replan.test.ts | 403
tests/unit/cli/plan-formatter.test.ts | 374
tests/unit/cli/plan-replan-helpers.test.ts | 459
tests/unit/cli/plan-validate.test.ts | 446
tests/unit/cli/queue-run-summary.test.ts | 383
tests/unit/cli/registry.test.ts | 398
tests/unit/cli/shell-interlock.test.ts | 616
tests/unit/cli/task-brief.test.ts | 386
tests/unit/cli/task-check.test.ts | 335
tests/unit/cli/task-claim-submit.test.ts | 757
tests/unit/cli/task-reject-repair.test.ts | 673
tests/unit/cli/task-review-dual-channel.test.ts | 909
tests/unit/cli/task-review-support.test.ts | 433
tests/unit/cli/task-validate-probe-review.test.ts | 548
tests/unit/cli/todo-ops.test.ts | 848
tests/unit/cli/unified-reporting.test.ts | 462
tests/unit/cli/watchdog-ops.test.ts | 448
tests/unit/cli/whoami.test.ts | 387
tests/unit/config/harness-config.test.ts | 430
tests/unit/contracts/branch.test.ts | 302
tests/unit/contracts/formatters.test.ts | 383
tests/unit/contracts/shared-paths.test.ts | 397
tests/unit/core/dual-time.test.ts | 454
tests/unit/core/durable-runtime.test.ts | 436
tests/unit/core/safe-fs.test.ts | 356
tests/unit/defects/defect-pipeline.test.ts | 1029
tests/unit/doctor/adversarial-doctor.test.ts | 421
tests/unit/doctor/tier-confinement.test.ts | 427
tests/unit/engine/scheduler.test.ts | 364
tests/unit/graph/dag-expansion.test.ts | 577
tests/unit/graph/dag-forensics.test.ts | 567
tests/unit/graph/dynamic-expansion.test.ts | 312
tests/unit/graph/gate-proof.test.ts | 694
tests/unit/graph/parallel-decoupler.test.ts | 524
tests/unit/health/intent.test.ts | 340
tests/unit/heuristics/heuristics-edge-cases.test.ts | 1492
tests/unit/hooks/lifecycle-hooks.test.ts | 1194
tests/unit/installer/release-actions.test.ts | 440
tests/unit/installer/release-recovery.test.ts | 418
tests/unit/installer/release-transaction.test.ts | 344
tests/unit/linter/ast-enforcer.test.ts | 781
tests/unit/logging/defect-logger.test.ts | 546
tests/unit/mind/admission-gates.test.ts | 831
tests/unit/mind/admission-negative.test.ts | 1950
tests/unit/mind/anti-batching-pipeline.test.ts | 674
tests/unit/mind/audit-planted.test.ts | 1405
tests/unit/mind/audit.test.ts | 796
tests/unit/mind/auditor-liveness-and-scope.test.ts | 408
tests/unit/mind/briefing-builder.test.ts | 721
tests/unit/mind/budget.test.ts | 841
tests/unit/mind/cadence-rollover.test.ts | 845
tests/unit/mind/cognitive-auditors.test.ts | 532
tests/unit/mind/completed-tasks.test.ts | 952
tests/unit/mind/counterfactual.test.ts | 579
tests/unit/mind/damage.test.ts | 975
tests/unit/mind/defect-audit.test.ts | 656
tests/unit/mind/defect-promotion.test.ts | 967
tests/unit/mind/defect-remediation-46.test.ts | 351
tests/unit/mind/defects.test.ts | 880
tests/unit/mind/digest.test.ts | 505
tests/unit/mind/dynamic-roles.test.ts | 634
tests/unit/mind/feedback-queue.test.ts | 694
tests/unit/mind/generational-archival.test.ts | 1355
tests/unit/mind/hierarchy-deploy.test.ts | 463
tests/unit/mind/hierarchy-regression.test.ts | 644
tests/unit/mind/hyper-cognition.test.ts | 597
tests/unit/mind/lane-repair.test.ts | 525
tests/unit/mind/lane-rescue.test.ts | 759
tests/unit/mind/lane-selector.test.ts | 559
tests/unit/mind/memory.test.ts | 703
tests/unit/mind/meta-auditor.test.ts | 1572
tests/unit/mind/mind-init.test.ts | 435
tests/unit/mind/mind-pulse-open.test.ts | 683
tests/unit/mind/mind-pulse-perpetual.test.ts | 380
tests/unit/mind/mind-rotate.test.ts | 541
tests/unit/mind/mind-wake.test.ts | 468
tests/unit/mind/plan-91-dynamic-hierarchy.test.ts | 366
tests/unit/mind/plan-revision.test.ts | 794
tests/unit/mind/product-owner-dispatch.test.ts | 765
tests/unit/mind/proposals.test.ts | 607
tests/unit/mind/pulse-lifecycle-and-rotate-grant.test.ts | 327
tests/unit/mind/pulse-reclaim.test.ts | 537
tests/unit/mind/pulse-sh.test.ts | 331
tests/unit/mind/quiesce.test.ts | 613
tests/unit/mind/recycler.test.ts | 878
tests/unit/mind/remote-safety.test.ts | 317
tests/unit/mind/role-auditing.test.ts | 470
tests/unit/mind/role-boundary-watchdog.test.ts | 453
tests/unit/mind/rounds.test.ts | 796
tests/unit/mind/smart-task-manager.test.ts | 1089
tests/unit/mind/soak-injections.test.ts | 1137
tests/unit/mind/sources.test.ts | 709
tests/unit/mind/strategic-purpose.test.ts | 366
tests/unit/mind/task-discovery.test.ts | 584
tests/unit/mind/task-queue.test.ts | 923
tests/unit/mind/todo-storage.test.ts | 400
tests/unit/mind/value.test.ts | 481
tests/unit/mind/witness.test.ts | 737
tests/unit/orchestrator/background-finalization.test.ts | 557
tests/unit/orchestrator/completion-audio.test.ts | 416
tests/unit/orchestrator/loop-runner.test.ts | 369
tests/unit/orchestrator/multi-capsule.test.ts | 500
tests/unit/orchestrator/topology-synthesis.test.ts | 546
tests/unit/packets/capsule-memory.test.ts | 459
tests/unit/packets/cli-query-integration.test.ts | 350
tests/unit/packets/command-authority-fail-closed.test.ts | 944
tests/unit/packets/command-authority.test.ts | 548
tests/unit/packets/decoupled-memory.test.ts | 505
tests/unit/packets/packet-slicing.test.ts | 652
tests/unit/packets/rich-instructions.test.ts | 334
tests/unit/packets/validation-round-context.test.ts | 535
tests/unit/plan/pre-enhancer.test.ts | 560
tests/unit/policy/rbac-engine.test.ts | 849
tests/unit/policy/repo-policy.test.ts | 563
tests/unit/policy/review-protocol.test.ts | 382
tests/unit/reporting/adversarial-doctor.test.ts | 468
tests/unit/reporting/behavioral-health.test.ts | 1039
tests/unit/reporting/event-stream.test.ts | 576
tests/unit/reporting/graph-json.test.ts | 378
tests/unit/reporting/handoff-argv-registry.test.ts | 418
tests/unit/reporting/integration-verification.test.ts | 318
tests/unit/reporting/living-tracer.test.ts | 579
tests/unit/reporting/screenshot-ingestion.test.ts | 421
tests/unit/reporting/split-channel-defect-router.test.ts | 328
tests/unit/reporting/state-machine-auditor.test.ts | 528
tests/unit/reporting/sugiyama-dag-subagent-expansion.test.ts | 399
tests/unit/reporting/sugiyama-dag.test.ts | 505
tests/unit/reporting/theme-contrast-matrix.test.ts | 720
tests/unit/reporting/tier-confinement.test.ts | 822
tests/unit/reporting/time-telemetry.test.ts | 500
tests/unit/reporting/unified.test.ts | 358
tests/unit/reporting/workflow-view.test.ts | 359
tests/unit/roles/meta-auditor-role.test.ts | 342
tests/unit/runner/attempt-failure-cleanup.test.ts | 359
tests/unit/runner/attempt-success-evidence.test.ts | 308
tests/unit/runner/process-timeout-watchdog.test.ts | 732
tests/unit/runner/run-command.test.ts | 860
tests/unit/runtime/agent-metadata.test.ts | 422
tests/unit/scheduler/core-engine.test.ts | 845
tests/unit/scheduler/critic-feedback.test.ts | 636
tests/unit/scheduler/dynamic-topology.test.ts | 525
tests/unit/scheduler/multi-domain-dispatch.test.ts | 830
tests/unit/scheduler/script-backed-diagnostics.test.ts | 538
tests/unit/scheduler/skill-auditor-policy.test.ts | 362
tests/unit/scheduler/unlimited-depth.test.ts | 693
tests/unit/scripts/coverage-reporting.test.ts | 443
tests/unit/store/capsule-index.test.ts | 375
tests/unit/store/event-append.test.ts | 366
tests/unit/store/event-stream.test.ts | 382
tests/unit/store/layout-integrity.test.ts | 413
tests/unit/summary/completeness-run-phases.ts | 353
tests/unit/summary/graph-branch-subgraph.test.ts | 304
tests/unit/summary/graph-node-evidence.test.ts | 357
tests/unit/summary/graph-validator-nodes.test.ts | 332
tests/unit/summary/host-telemetry.test.ts | 317
tests/unit/summary/markdown-fixtures.ts | 390
tests/unit/summary/markdown-formatter-topology.test.ts | 375
tests/unit/summary/markdown-run-report-fixture.ts | 502
tests/unit/summary/timeline-collector.test.ts | 457
tests/unit/tasks/review-pushback.test.ts | 641
tests/unit/telemetry/circuit-breaker.test.ts | 386
tests/unit/telemetry/collectors.test.ts | 784
tests/unit/telemetry/dag-snapshot.test.ts | 417
tests/unit/test-isolation.test.ts | 329
tests/unit/testing/concurrency-lock.test.ts | 389
tests/unit/testing/scoped-execution.test.ts | 365
tests/unit/validation/anti-batching.test.ts | 689
tests/unit/validation/anti-leak.test.ts | 609
tests/unit/validation/anti-mock-engine.test.ts | 718
tests/unit/validation/dual-channel-analyzer.test.ts | 1091
tests/unit/validation/dual-channel-negative-bounds.test.ts | 313
tests/unit/validation/validator-hardlock.test.ts | 618
tests/unit/validation/validator-specialization.test.ts | 621
tests/unit/watchdog/process-timeout.test.ts | 711
tests/unit/watchdog/reactive-wakeups.test.ts | 524
tests/unit/watchdog/watchdog-timer.test.ts | 736
tests/unit/workflow/agents/grants.test.ts | 569
tests/unit/workflow/agents/telemetry-merge.test.ts | 439
tests/unit/workflow/authority-decisions.test.ts | 308
tests/unit/workflow/branch/repository-observation.test.ts | 302
tests/unit/workflow/branch/sub-tasks.test.ts | 342
tests/unit/workflow/gates-completion.test.ts | 310
tests/unit/workflow/heuristics-workflow.test.ts | 830
tests/unit/workflow/micro-cycle.test.ts | 485
tests/unit/workflow/plan-review.test.ts | 449
tests/unit/workflow/review/probe.test.ts | 339
tests/unit/workflow/sync-workflow.test.ts | 770
tests/unit/workflow/task-check.test.ts | 1097
tests/unit/workflow/worktree/consolidate.test.ts | 308
tests/unit/workflow/worktree/provision.test.ts | 341
tests/unit/workflow/write-scope-hash.test.ts | 351
tests/unit/worktree/domain-sync.test.ts | 680
tests/unit/worktree/git-preservation-integration.test.ts | 339
tests/unit/worktree/phase-commits.test.ts | 462
```

## Fanout violations

The preliminary 45-directory figure is the TS-family subset and is preserved below for exact migration reconciliation.

```text
directory | direct_ts_files
olt/scripts/src/authority | 12
olt/scripts/src/cli | 13
olt/scripts/src/cli/commands | 87
olt/scripts/src/cli/formatters | 12
olt/scripts/src/cli/registry | 23
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

Seven additional directories violate the same fanout rule once approved first-party generated JSON,
Markdown, and YAML are counted:

```text
directory | direct_in_scope_files
olt/agents | 28
olt/references | 13
olt/references/cli-capabilities/commands/mind | 25
olt/references/cli-capabilities/domains | 18
olt/references/cli-capabilities/commands/reporting | 17
olt/references/cli-capabilities/commands/plan | 13
olt/references/cli-capabilities/commands/task | 13
```

The authoritative total is 52: 45 TS-family directories, five generated CLI directories, and two
non-generated governance/reference directories.

## Missing production facades

These source directories contain direct TypeScript files but no explicit `index.ts`.

```text
olt/scripts
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
scripts
scripts/testing
```

## Import and cycle baseline

The import scan parses TypeScript `ImportDeclaration` and `ExportDeclaration` nodes, resolves relative specifiers using TypeScript file and directory-index resolution, permits direct imports within one directory, and records a bypass when a cross-directory reference names a file instead of the destination directory facade. It finds 1,169 import declarations and 65 export declarations, totaling 1,234 bypasses.

The resolved production graph contains 12 non-trivial SCCs spanning 93 files; the largest contains 57 files. The remaining component sizes are 12, 4, 3, 3, and seven components of 2 files. The largest component joins CLI command registration, scheduler, health, mind, orchestrator, reporting, and role-cheat-sheet modules. Cycle work must reduce the baseline monotonically and may not introduce a new component or enlarge an existing one.

## Generated CLI baseline

`olt/references/cli-capabilities/` contains 147 tracked generated artifacts. Four generated domain catalogs exceed 300 physical lines:

```text
olt/references/cli-capabilities/domains/mind.md | 575
olt/references/cli-capabilities/domains/reporting.md | 401
olt/references/cli-capabilities/domains/task.md | 333
olt/references/cli-capabilities/domains/plan.md | 320
```

Five generated directories exceed 10 direct files:

```text
olt/references/cli-capabilities/commands/mind | 25
olt/references/cli-capabilities/domains | 18
olt/references/cli-capabilities/commands/reporting | 17
olt/references/cli-capabilities/commands/plan | 13
olt/references/cli-capabilities/commands/task | 13
```

Generated output is not exempt. Domain catalogs and command JSON must be semantically sharded, and every generated shard directory must contain a generated catalog index.

## Exclusions

- Administrative/runtime: `.olt/**`, `.git/**`, `node_modules/**`, `scratch/**`, `capsules/**`, runtime output directories.
- Derived output: `coverage/**`, cache directories, `dist/**`, `build/**`, `out/**`.
- Third party: `vendor/**`, `vendored/**`, `third_party/**`.
- Lockfiles: `bun.lock` and conventional package-manager lockfiles.
- Markdown and YAML are line-limit exempt but count toward directory fanout.
- Non-TypeScript fixtures and snapshots may be line-limit exempt but count toward fanout.
- TypeScript fixtures are never exempt.
- First-party JSON is included; generated CLI paths override generic fixture/snapshot treatment.

## Fixed root conventional-file set

The repository root is not a compliant feature directory. These ten tracked conventional files are
allowed only by a fixed, no-growth exception and are not included in the 52-directory total:

```text
.capture.yaml
.gitignore
.oxfmtrc.json
AGENTS.md
LICENSE
README.md
bunfig.toml
lefthook.yml
package.json
tsconfig.json
```

`bun.lock` is excluded as a lockfile. Adding another root file is a violation unless the design specification is amended first.

## Baseline ownership

- Guard engine and baseline parser: Plan 01.
- CLI source, generated artifacts, and primary cycle seam: Plan 02.
- `olt/scripts/index.ts` and its direct generator/harness entrypoints: Plan 02.
- Remaining production source, `scripts/index.ts`, `scripts/testing/index.ts`, root reporting scripts, agent manifests, and direct reference catalogs: Plan 03.
- Test source: Plan 04.
- Ratchet, hook, CI, and boundary enforcement: Plan 05.
