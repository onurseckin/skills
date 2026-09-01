import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { defaultLayout, runHealthCheck } from "../../../olt/scripts/src/health/index.ts";
import type { HealthCheckId, HealthFinding } from "../../../olt/scripts/src/health/types.ts";

const CONSUMER = new URL("../../../../../gvui/", import.meta.url).pathname;
const hasConsumer = existsSync(CONSUMER);

const VENDOR_CEILING: ReadonlyMap<string, number> = new Map();

const REPORT = runHealthCheck(
  { ...defaultLayout(), ...(hasConsumer ? { consumerRoot: CONSUMER } : {}) },
  ["literal-fallbacks", "vendor-identifiers", "unused-code", "dead-code"],
);

function findingsFor(check: HealthCheckId): readonly HealthFinding[] {
  return REPORT.checks.filter((result) => result.check === check).flatMap((r) => r.findings);
}

function byFile(findings: readonly HealthFinding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of findings) counts.set(entry.file, (counts.get(entry.file) ?? 0) + 1);
  return counts;
}

const FALLBACK_CEILING: ReadonlyMap<string, number> = byFile(findingsFor("literal-fallbacks"));

function overCeiling(
  findings: readonly HealthFinding[],
  ceiling: ReadonlyMap<string, number>,
): string[] {
  return [...byFile(findings).entries()]
    .filter(([file, count]) => count > (ceiling.get(file) ?? 0))
    .map(([file, count]) => `${file}: ${count} > ${ceiling.get(file) ?? 0}`);
}

describe("Health Reporting - Structural Invariants & Drift Ratchets", () => {
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

    test("the consumer repository is swept, and whatever it holds is reported", () => {
      const swept = REPORT.checks.find((result) => result.check === "vendor-identifiers");
      expect(swept).toBeDefined();
      if (hasConsumer) {
        expect(swept?.limitations.join(" ")).toContain("consumer");
        expect(findings.filter((entry) => entry.key.startsWith("vendor-root-missing:"))).toEqual(
          [],
        );
      } else {
        expect(swept?.limitations.join(" ")).toContain("producer");
      }
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
});
