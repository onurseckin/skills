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
  ["olt/scripts/src/authority/manifest-parser.ts", 1],
  ["olt/scripts/src/authority/manifest-schema.ts", 1],
  ["olt/scripts/src/authority/persona-grounding.ts", 1],
  ["olt/scripts/src/authority/review-pushback.ts", 2],
  ["olt/scripts/src/authority/session-registry.ts", 3],
  ["olt/scripts/src/authority/watchdog-manager.ts", 3],
  ["olt/scripts/src/cli/commands/dag.ts", 1],
  ["olt/scripts/src/cli/commands/diagnostics-ops.ts", 2],
  ["olt/scripts/src/cli/commands/mind-audit.ts", 3],
  ["olt/scripts/src/cli/commands/mind-init.ts", 1],
  ["olt/scripts/src/cli/commands/mind-pulse.ts", 3],
  ["olt/scripts/src/cli/commands/mind-quiesce.ts", 1],
  ["olt/scripts/src/cli/commands/mind-rotate.ts", 1],
  ["olt/scripts/src/cli/commands/mind-wake.ts", 1],
  ["olt/scripts/src/cli/commands/plan-brainstorm.ts", 3],
  ["olt/scripts/src/cli/commands/run-ops.ts", 1],
  ["olt/scripts/src/cli/commands/shell.ts", 2],
  ["olt/scripts/src/cli/commands/smart-task-ops.ts", 1],
  ["olt/scripts/src/cli/commands/task-finding-input.ts", 2],
  ["olt/scripts/src/cli/commands/task-review.ts", 1],
  ["olt/scripts/src/cli/commands/test-summary.ts", 2],
  ["olt/scripts/src/cli/commands/watchdog-ops.ts", 3],
  ["olt/scripts/src/core/runtime-tree.ts", 2],
  ["olt/scripts/src/engine/scheduler/core-engine.ts", 2],
  ["olt/scripts/src/engine/scheduler/dynamic-topology.ts", 1],
  ["olt/scripts/src/engine/store/index.ts", 1],
  ["olt/scripts/src/engine/worktree/domain-sync.ts", 1],
  ["olt/scripts/src/graph/dag-expansion.ts", 1],
  ["olt/scripts/src/graph/parallel-decoupler.ts", 5],
  ["olt/scripts/src/installer/tree-digest.ts", 1],
  ["olt/scripts/src/mind/audit.ts", 4],
  ["olt/scripts/src/mind/brief.ts", 3],
  ["olt/scripts/src/mind/cognitive-flavor.ts", 2],
  ["olt/scripts/src/mind/counterfactual.ts", 1],
  ["olt/scripts/src/mind/defects.ts", 9],
  ["olt/scripts/src/mind/deploy.ts", 3],
  ["olt/scripts/src/mind/digest.ts", 3],
  ["olt/scripts/src/mind/dynamic-roles.ts", 2],
  ["olt/scripts/src/mind/feedback-queue.ts", 4],
  ["olt/scripts/src/mind/gates.ts", 5],
  ["olt/scripts/src/mind/lanes/rescue.ts", 1],
  ["olt/scripts/src/mind/liveness.ts", 3],
  ["olt/scripts/src/mind/meta-auditor.ts", 3],
  ["olt/scripts/src/mind/mind.ts", 2],
  ["olt/scripts/src/mind/proposal.ts", 5],
  ["olt/scripts/src/mind/pushbacks.ts", 3],
  ["olt/scripts/src/mind/quiesce.ts", 1],
  ["olt/scripts/src/mind/recycler.ts", 2],
  ["olt/scripts/src/mind/role-auditing.ts", 5],
  ["olt/scripts/src/mind/rotate.ts", 1],
  ["olt/scripts/src/mind/rounds.ts", 2],
  ["olt/scripts/src/mind/self-evolution.ts", 3],
  ["olt/scripts/src/mind/smart-task-manager.ts", 16],
  ["olt/scripts/src/mind/task-discovery.ts", 2],
  ["olt/scripts/src/mind/task-queue.ts", 6],
  ["olt/scripts/src/orchestrator/completion-audio.ts", 2],
  ["olt/scripts/src/orchestrator/recursive-critic-feedback.ts", 2],
  ["olt/scripts/src/orchestrator/watchdog.ts", 1],
  ["olt/scripts/src/platform/index.ts", 3],
  ["olt/scripts/src/platform/index.ts", 3],
  ["olt/scripts/src/platform/index.ts", 5],
  ["olt/scripts/src/platform/index.ts", 6],
  ["olt/scripts/src/platform/index.ts", 3],
  ["olt/scripts/src/platform/index.ts", 2],
  ["olt/scripts/src/policy/rbac-engine.ts", 1],
  ["olt/scripts/src/reporting/dag-view.ts", 2],
  ["olt/scripts/src/reporting/doctor/tier-confinement.ts", 2],
  ["olt/scripts/src/reporting/living-tracer.ts", 5],
  ["olt/scripts/src/reporting/sugiyama-dag.ts", 6],
  ["olt/scripts/src/reporting/time-telemetry.ts", 1],
  ["olt/scripts/src/summary/assets/asset-mapper.ts", 1],
  ["olt/scripts/src/summary/graph/graph-generator-critic-nodes.ts", 1],
  ["olt/scripts/src/summary/metrics/metrics-collector-helpers.ts", 7],
  ["olt/scripts/src/summary/metrics/metrics-collector.ts", 2],
  ["olt/scripts/src/testing/concurrency-lock.ts", 1],
  ["olt/scripts/src/watchdog/boot-gate-enforcer.ts", 6],
  ["olt/scripts/src/workflow/scope-partitioner.ts", 1],
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
