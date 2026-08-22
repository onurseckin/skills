import { describe, expect, test } from "bun:test";
import {
  defaultLayout,
  runHealthCheck,
} from "../../../orchestrating-long-tasks/scripts/src/health/index.ts";
import type {
  HealthCheckId,
  HealthFinding,
} from "../../../orchestrating-long-tasks/scripts/src/health/types.ts";

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
  ["orchestrating-long-tasks/scripts/src/authority/watchdog-manager.ts", 2],
  ["orchestrating-long-tasks/scripts/src/cli/commands/mind-audit.ts", 3],
  ["orchestrating-long-tasks/scripts/src/cli/commands/mind-init.ts", 1],
  ["orchestrating-long-tasks/scripts/src/cli/commands/mind-pulse-close.ts", 1],
  ["orchestrating-long-tasks/scripts/src/cli/commands/mind-quiesce.ts", 1],
  ["orchestrating-long-tasks/scripts/src/cli/commands/mind-rotate.ts", 1],
  ["orchestrating-long-tasks/scripts/src/cli/commands/mind-wake.ts", 1],
  ["orchestrating-long-tasks/scripts/src/cli/commands/smart-task-ops.ts", 1],
  ["orchestrating-long-tasks/scripts/src/cli/commands/watchdog-ops.ts", 3],
  ["orchestrating-long-tasks/scripts/src/core/runtime-tree.ts", 2],
  ["orchestrating-long-tasks/scripts/src/installer/tree-digest.ts", 1],
  ["orchestrating-long-tasks/scripts/src/mind/audit.ts", 4],
  ["orchestrating-long-tasks/scripts/src/mind/brief.ts", 3],
  ["orchestrating-long-tasks/scripts/src/mind/counterfactual.ts", 1],
  ["orchestrating-long-tasks/scripts/src/mind/deploy.ts", 3],
  ["orchestrating-long-tasks/scripts/src/mind/digest.ts", 3],
  ["orchestrating-long-tasks/scripts/src/mind/gates.ts", 5],
  ["orchestrating-long-tasks/scripts/src/mind/lanes/rescue.ts", 1],
  ["orchestrating-long-tasks/scripts/src/mind/proposal.ts", 1],
  ["orchestrating-long-tasks/scripts/src/mind/pushbacks.ts", 3],
  ["orchestrating-long-tasks/scripts/src/mind/quiesce.ts", 1],
  ["orchestrating-long-tasks/scripts/src/mind/recycler.ts", 2],
  ["orchestrating-long-tasks/scripts/src/mind/rotate.ts", 1],
  ["orchestrating-long-tasks/scripts/src/mind/rounds.ts", 2],
  ["orchestrating-long-tasks/scripts/src/mind/smart-task-manager.ts", 4],
  ["orchestrating-long-tasks/scripts/src/mind/task-queue.ts", 6],
  ["orchestrating-long-tasks/scripts/src/mind/witness.ts", 2],
  ["orchestrating-long-tasks/scripts/src/orchestrator/recursive-critic-feedback.ts", 2],
  ["orchestrating-long-tasks/scripts/src/orchestrator/watchdog.ts", 1],
  ["orchestrating-long-tasks/scripts/src/scheduler/dynamic-topology.ts", 1],
  ["orchestrating-long-tasks/scripts/src/summary/asset-mapper.ts", 1],
  ["orchestrating-long-tasks/scripts/src/summary/graph-generator-critic-nodes.ts", 1],
  ["orchestrating-long-tasks/scripts/src/summary/metrics-collector-helpers.ts", 7],
  ["orchestrating-long-tasks/scripts/src/summary/metrics-collector.ts", 2],
  ["orchestrating-long-tasks/scripts/src/workflow/scope-partitioner.ts", 1],
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
