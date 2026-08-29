import { describe, expect, test } from "bun:test";
import { defaultLayout, runHealthCheck } from "../../../olt/scripts/src/health/index.ts";
import type { HealthCheckId, HealthFinding } from "../../../olt/scripts/src/health/types.ts";

const CONSUMER = new URL("../../../../gvui/", import.meta.url).pathname;

/**
 * B8.5: a fix without a regression test is a fix that returns. These are the structural bars over
 * the real tree.
 *
 * The two ratchets below are counts of violations that exist TODAY and are owned by other backlog
 * items. They are a ceiling, never a permission: a new violation in any file fails the suite, a
 * violation in a file not listed fails the suite, and every one of them is still reported as a
 * failure by `harness.ts health`. Lower a number as its file is cleaned; the numbers only go down.
 */
const FALLBACK_CEILING: ReadonlyMap<string, number> = new Map([
  ["olt/scripts/src/authority/guards/singleton-auditor-guard.ts", 1],
  ["olt/scripts/src/authority/persona/eval-invariants.ts", 1],
  ["olt/scripts/src/authority/review/audit.ts", 2],
  ["olt/scripts/src/authority/session/resolver.ts", 3],
  ["olt/scripts/src/authority/watchdog/ops-cleanup.ts", 2],
  ["olt/scripts/src/authority/watchdog/ops-registration.ts", 1],
  ["olt/scripts/src/cli/commands/dag.ts", 1],
  ["olt/scripts/src/cli/commands/diagnostics-ops.ts", 2],
  ["olt/scripts/src/cli/commands/explain-data-platform.ts", 2],
  ["olt/scripts/src/cli/commands/finding-ops.ts", 1],
  ["olt/scripts/src/cli/commands/mind-audit.ts", 3],
  ["olt/scripts/src/cli/commands/mind-init.ts", 1],
  ["olt/scripts/src/cli/commands/mind-pulse.ts", 2],
  ["olt/scripts/src/cli/commands/mind-quiesce.ts", 1],
  ["olt/scripts/src/cli/commands/mind-rotate.ts", 1],
  ["olt/scripts/src/cli/commands/mind-wake.ts", 1],
  ["olt/scripts/src/cli/commands/plan-brainstorm.ts", 3],
  ["olt/scripts/src/cli/commands/run-ops.ts", 1],
  ["olt/scripts/src/cli/commands/shell.ts", 1],
  ["olt/scripts/src/cli/commands/smart-task-ops.ts", 1],
  ["olt/scripts/src/cli/commands/task-finding-input.ts", 2],
  ["olt/scripts/src/cli/commands/task-review.ts", 1],
  ["olt/scripts/src/cli/commands/test-summary.ts", 2],
  ["olt/scripts/src/cli/commands/watchdog-ops.ts", 1],
  ["olt/scripts/src/communication/mailbox/chatter-guard.ts", 2],
  ["olt/scripts/src/communication/mailbox/envelope.ts", 2],
  ["olt/scripts/src/communication/mailbox/mailbox-stream.ts", 3],
  ["olt/scripts/src/core/runtime-tree.ts", 2],
  ["olt/scripts/src/engine/scheduler/core/loop-doctor.ts", 2],
  ["olt/scripts/src/engine/scheduler/core/state.ts", 1],
  ["olt/scripts/src/engine/scheduler/diagnostics/diagnostics.ts", 1],
  ["olt/scripts/src/engine/scheduler/topology/dynamic-allocations.ts", 1],
  ["olt/scripts/src/engine/store/capsule/capsule.ts", 1],
  ["olt/scripts/src/engine/worktree/domain-sync.ts", 1],
  ["olt/scripts/src/graph/dag-expansion.ts", 1],
  ["olt/scripts/src/graph/parallel-decoupler.ts", 5],
  ["olt/scripts/src/installer/tree-digest.ts", 1],
  ["olt/scripts/src/logging/defects/dedup.ts", 4],
  ["olt/scripts/src/mind/archival/quiesce/evaluator.ts", 1],
  ["olt/scripts/src/mind/archival/recycler/collector.ts", 1],
  ["olt/scripts/src/mind/archival/recycler/pruner.ts", 1],
  ["olt/scripts/src/mind/archival/rotate/rotator.ts", 1],
  ["olt/scripts/src/mind/auditing/counterfactual/types.ts", 1],
  ["olt/scripts/src/mind/auditing/flavor/pillars.ts", 1],
  ["olt/scripts/src/mind/auditing/flavor/scorer.ts", 1],
  ["olt/scripts/src/mind/auditing/meta/forensics.ts", 1],
  ["olt/scripts/src/mind/auditing/meta/heuristics-extended.ts", 2],
  ["olt/scripts/src/mind/auditing/questionnaire/prompts.ts", 1],
  ["olt/scripts/src/mind/auditing/questionnaire/reporter.ts", 3],
  ["olt/scripts/src/mind/auditing/roles/batch-auditor.ts", 1],
  ["olt/scripts/src/mind/auditing/roles/similarity.ts", 3],
  ["olt/scripts/src/mind/chatter-guard.ts", 1],
  ["olt/scripts/src/mind/concurrency-cap.ts", 4],
  ["olt/scripts/src/mind/core/discovery-command.ts", 1],
  ["olt/scripts/src/mind/core/evolution-command.ts", 1],
  ["olt/scripts/src/mind/defects/dedup/live-dedup.ts", 1],
  ["olt/scripts/src/mind/defects/loop/audit.ts", 3],
  ["olt/scripts/src/mind/defects/loop/candidates.ts", 2],
  ["olt/scripts/src/mind/defects/loop/defect-loop.ts", 1],
  ["olt/scripts/src/mind/defects/loop/deliberation/actions.ts", 1],
  ["olt/scripts/src/mind/defects/loop/ops/candidates.ts", 2],
  ["olt/scripts/src/mind/defects/loop/regression-gen.ts", 2],
  ["olt/scripts/src/mind/defects/sync/lifecycle-sync.ts", 4],
  ["olt/scripts/src/mind/defects/sync/order-enforcement.ts", 1],
  ["olt/scripts/src/mind/defects/sync/signature.ts", 1],
  ["olt/scripts/src/mind/defects/sync/state-machine.ts", 2],
  ["olt/scripts/src/mind/feedback/pushbacks/ingest.ts", 1],
  ["olt/scripts/src/mind/feedback/pushbacks/parser.ts", 2],
  ["olt/scripts/src/mind/feedback/queue/ops.ts", 4],
  ["olt/scripts/src/mind/lanes/rescue/orchestrator.ts", 1],
  ["olt/scripts/src/mind/lifecycle/deploy/builder.ts", 2],
  ["olt/scripts/src/mind/lifecycle/deploy/types.ts", 1],
  ["olt/scripts/src/mind/lifecycle/evolution/proposal.ts", 3],
  ["olt/scripts/src/mind/lifecycle/ghost-reconciler.ts", 1],
  ["olt/scripts/src/mind/lifecycle/liveness/probe.ts", 1],
  ["olt/scripts/src/mind/lifecycle/liveness/types.ts", 2],
  ["olt/scripts/src/mind/lifecycle/observe/index.ts", 1],
  ["olt/scripts/src/mind/lifecycle/orchestrator-ledger.ts", 1],
  ["olt/scripts/src/mind/lifecycle/rounds/round-open.ts", 2],
  ["olt/scripts/src/mind/memory/digest/candidates.ts", 1],
  ["olt/scripts/src/mind/memory/digest/formatter.ts", 2],
  ["olt/scripts/src/mind/memory/digest/reader.ts", 1],
  ["olt/scripts/src/mind/memory/telemetry.ts", 3],
  ["olt/scripts/src/mind/memory/value/calculator.ts", 1],
  ["olt/scripts/src/mind/proposals/brief/assembler.ts", 2],
  ["olt/scripts/src/mind/proposals/gates/evaluator.ts", 3],
  ["olt/scripts/src/mind/proposals/gates/table.ts", 2],
  ["olt/scripts/src/mind/proposals/proposal/brief.ts", 1],
  ["olt/scripts/src/mind/proposals/proposal/creation.ts", 2],
  ["olt/scripts/src/mind/proposals/proposal/transitions.ts", 2],
  ["olt/scripts/src/mind/roles/dynamic/mutator.ts", 1],
  ["olt/scripts/src/mind/roles/dynamic/synthesizer.ts", 1],
  ["olt/scripts/src/mind/tasks/discovery/scanners/health-scanner.ts", 1],
  ["olt/scripts/src/mind/tasks/discovery/scanners/remediation-scanner.ts", 5],
  ["olt/scripts/src/mind/tasks/discovery/slices/scans.ts", 1],
  ["olt/scripts/src/task/queue/transitions.ts", 3],
  ["olt/scripts/src/task/queue/types.ts", 3],
  ["olt/scripts/src/mind/tasks/smart/executor/dispatch.ts", 1],
  ["olt/scripts/src/mind/tasks/smart/executor/evolution.ts", 3],
  ["olt/scripts/src/mind/tasks/smart/executor/priorities.ts", 4],
  ["olt/scripts/src/mind/tasks/smart/executor/product-owner.ts", 3],
  ["olt/scripts/src/mind/tasks/smart/executor/self-evolution.ts", 3],
  ["olt/scripts/src/mind/tasks/smart/executor/synthesis.ts", 2],
  ["olt/scripts/src/mind/tasks/smart/planner/anti-batching.ts", 3],
  ["olt/scripts/src/mind/tasks/smart/planner/collisions.ts", 3],
  ["olt/scripts/src/mind/tasks/smart/planner/partitioning.ts", 2],
  ["olt/scripts/src/orchestrator/completion-audio.ts", 2],
  ["olt/scripts/src/orchestrator/recursive-critic-feedback.ts", 2],
  ["olt/scripts/src/orchestrator/velocity-rebalancer.ts", 1],
  ["olt/scripts/src/orchestrator/watchdog.ts", 1],
  ["olt/scripts/src/packets/command-authority.ts", 2],
  ["olt/scripts/src/platform/host/antigravity.ts", 3],
  ["olt/scripts/src/platform/host/chatgpt.ts", 3],
  ["olt/scripts/src/platform/host/claude-code.ts", 5],
  ["olt/scripts/src/platform/host/codex.ts", 4],
  ["olt/scripts/src/platform/host/cursor.ts", 3],
  ["olt/scripts/src/platform/host/unfulfilled-demand.ts", 2],
  ["olt/scripts/src/policy/hooks/interpolator.ts", 1],
  ["olt/scripts/src/policy/rbac/authorizer.ts", 1],
  ["olt/scripts/src/reporting/dag-view.ts", 2],
  ["olt/scripts/src/reporting/doctor/anti-mock-engine.ts", 2],
  ["olt/scripts/src/reporting/doctor/git-index-engine.ts", 1],
  ["olt/scripts/src/reporting/doctor/lock-cleaner.ts", 2],
  ["olt/scripts/src/reporting/doctor/tier-confinement/audit-supervisor.ts", 2],
  ["olt/scripts/src/reporting/living-tracer/render.ts", 4],
  ["olt/scripts/src/reporting/living-tracer/timeline.ts", 1],
  ["olt/scripts/src/reporting/sugiyama-dag/render-box.ts", 4],
  ["olt/scripts/src/reporting/sugiyama-dag/render.ts", 1],
  ["olt/scripts/src/reporting/sugiyama-dag/routing.ts", 1],
  ["olt/scripts/src/reporting/sugiyama-dag/subagent-expansion.ts", 2],
  ["olt/scripts/src/reporting/time-telemetry/report-builder.ts", 1],
  ["olt/scripts/src/reporting/unified/report-builder.ts", 3],
  ["olt/scripts/src/summary/assets/asset-mapper.ts", 1],
  ["olt/scripts/src/summary/graph/graph-generator-critic-nodes.ts", 1],
  ["olt/scripts/src/summary/metrics/metrics-collector-helpers.ts", 7],
  ["olt/scripts/src/summary/metrics/metrics-collector.ts", 2],
  ["olt/scripts/src/testing/concurrency-lock.ts", 1],
  ["olt/scripts/src/watchdog/boot-gate-enforcer/enforcer.ts", 2],
  ["olt/scripts/src/watchdog/boot-gate-enforcer/recorder.ts", 4],
  ["olt/scripts/src/workflow/scope-partitioner.ts", 1],
  ["olt/scripts/src/workflow/worktree/landing.ts", 1],
  ["olt/scripts/src/workflow/worktree/manager.ts", 1],
]);

// Empty now that the health check's own vendor sweep carries the same PRODUCT_GRAMMAR_MODULES
// exemption tests/unit/architecture/vendor-identifiers.test.ts already reasoned through: this file
// speaks several products' command grammars by name on purpose, not by accident.
const VENDOR_CEILING: ReadonlyMap<string, number> = new Map();

// One sweep, shared by every bar below: loading both trees is the expensive part of the check.
const REPORT = runHealthCheck({ ...defaultLayout(), consumerRoot: CONSUMER }, [
  "literal-fallbacks",
  "vendor-identifiers",
  "unused-code",
  "dead-code",
]);

function findingsFor(check: HealthCheckId): readonly HealthFinding[] {
  return REPORT.checks.filter((result) => result.check === check).flatMap((r) => r.findings);
}

function byFile(findings: readonly HealthFinding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of findings) counts.set(entry.file, (counts.get(entry.file) ?? 0) + 1);
  return counts;
}

function overCeiling(
  findings: readonly HealthFinding[],
  ceiling: ReadonlyMap<string, number>,
): string[] {
  return [...byFile(findings).entries()]
    .filter(([file, count]) => count > (ceiling.get(file) ?? 0))
    .map(([file, count]) => `${file}: ${count} > ${ceiling.get(file) ?? 0}`);
}

describe("a plausible literal never stands in for a value the harness did not have", () => {
  const findings = findingsFor("literal-fallbacks");

  test("no file carries more fallbacks than it did when the check landed", () => {
    expect(overCeiling(findings, FALLBACK_CEILING)).toEqual([]);
  });

  test("the ceiling names no file that is already clean", () => {
    const counts = byFile(findings);
    expect([...FALLBACK_CEILING.keys()].filter((file) => !counts.has(file))).toEqual([]);
  });
});

describe("no vendor or product name names anything in either repository", () => {
  const findings = findingsFor("vendor-identifiers");

  test("the producer carries no vendor identifier beyond the ones it had", () => {
    expect(
      overCeiling(
        findings.filter((entry) => entry.file.startsWith("producer/")),
        VENDOR_CEILING,
      ),
    ).toEqual([]);
  });

  // The consumer's own bar belongs to the consumer's suite: this repository cannot hold a count of
  // a tree it does not own steady. What it CAN guarantee is that the consumer is swept and that
  // whatever is found is reported rather than quietly dropped.
  test("the consumer repository is swept, and whatever it holds is reported", () => {
    const swept = REPORT.checks.find((result) => result.check === "vendor-identifiers");
    expect(swept?.limitations.join(" ")).toContain("consumer");
    expect(findings.filter((entry) => entry.key.startsWith("vendor-root-missing:"))).toEqual([]);
  });
});

describe("the bars the tree already meets, kept met", () => {
  const findings = findingsFor("unused-code");

  test("no production function discards a parameter its caller passed", () => {
    expect(findings.filter((entry) => entry.key.startsWith("unread-parameter:"))).toEqual([]);
  });

  test("no allowance in the opt-out list has gone stale", () => {
    expect(findings.filter((entry) => entry.key.startsWith("stale-allowance:"))).toEqual([]);
  });

  test("no production source holds commented-out code", () => {
    expect(
      findingsFor("dead-code").filter((entry) => entry.key.startsWith("commented-out:")),
    ).toEqual([]);
  });
});
