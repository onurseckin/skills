import { describe, expect, test } from "bun:test";
import { formatTerminalReport } from "../../../../scripts/testing/guardrails/reporter.ts";
import type {
  PurityTolerance,
  PurityViolation,
} from "../../../../scripts/testing/guardrails/index.ts";
import {
  carryOverReasons,
  comparePurityBaseline,
  summarizeViolations,
} from "../../../../scripts/testing/purity-ratchet/index.ts";
import type {
  PurityBaseline,
  PurityBaselineEntry,
} from "../../../../scripts/testing/purity-ratchet/index.ts";

function violation(file: string, rule: string): PurityViolation {
  return {
    file,
    line: 1,
    column: 1,
    category: "filesystem",
    rule,
    message: `synthetic ${rule}`,
  };
}

function baselineOf(entries: readonly PurityBaselineEntry[]): PurityBaseline {
  return { schema: "olt-purity-baseline/v1", entries };
}

const BACKLOG = baselineOf([
  { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 3 },
  { file: "tests/beta.test.ts", rule: "no-unmocked-subprocess-call", count: 1 },
]);

describe("purity ratchet violation summarisation", () => {
  test("groups violations per file and per rule with stable ordering", () => {
    const summary = summarizeViolations([
      violation("tests/beta.test.ts", "no-physical-fs-call"),
      violation("tests/alpha.test.ts", "no-physical-fs-call"),
      violation("tests/alpha.test.ts", "no-physical-fs-call"),
      violation("tests/alpha.test.ts", "no-unmocked-subprocess-call"),
    ]);

    expect(summary).toEqual([
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 2 },
      { file: "tests/alpha.test.ts", rule: "no-unmocked-subprocess-call", count: 1 },
      { file: "tests/beta.test.ts", rule: "no-physical-fs-call", count: 1 },
    ]);
  });

  test("produces no entries for a clean audit", () => {
    expect(summarizeViolations([])).toHaveLength(0);
  });
});

describe("purity ratchet baseline comparison", () => {
  test("passes when the observed backlog matches the baseline exactly", () => {
    const result = comparePurityBaseline(BACKLOG, BACKLOG.entries);

    expect(result.passed).toBe(true);
    expect(result.baselineDelta.added).toHaveLength(0);
    expect(result.baselineDelta.worsened).toHaveLength(0);
    expect(result.baselineDelta.resolved).toHaveLength(0);
  });

  test("fails and names the file and rule when a new violation appears", () => {
    const result = comparePurityBaseline(BACKLOG, [
      ...BACKLOG.entries,
      { file: "tests/gamma.test.ts", rule: "no-physical-fs-import", count: 1 },
    ]);

    expect(result.passed).toBe(false);
    expect(result.baselineDelta.added).toEqual([
      { file: "tests/gamma.test.ts", rule: "no-physical-fs-import", observed: 1, baseline: 0 },
    ]);
    expect(result.baselineDelta.worsened).toHaveLength(0);
  });

  test("fails when an already baselined file gains more violations of the same rule", () => {
    const result = comparePurityBaseline(BACKLOG, [
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 4 },
      { file: "tests/beta.test.ts", rule: "no-unmocked-subprocess-call", count: 1 },
    ]);

    expect(result.passed).toBe(false);
    expect(result.baselineDelta.worsened).toEqual([
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", observed: 4, baseline: 3 },
    ]);
    expect(result.baselineDelta.added).toHaveLength(0);
  });

  test("fails when a baselined file gains a rule it did not previously violate", () => {
    const result = comparePurityBaseline(BACKLOG, [
      ...BACKLOG.entries,
      { file: "tests/alpha.test.ts", rule: "no-unmocked-bun-spawn", count: 1 },
    ]);

    expect(result.passed).toBe(false);
    expect(result.baselineDelta.added.map((delta) => delta.rule)).toEqual([
      "no-unmocked-bun-spawn",
    ]);
  });

  test("catches a violation moved between files instead of netting it out to zero", () => {
    const result = comparePurityBaseline(BACKLOG, [
      { file: "tests/beta.test.ts", rule: "no-unmocked-subprocess-call", count: 1 },
      { file: "tests/delta.test.ts", rule: "no-physical-fs-call", count: 3 },
    ]);

    expect(result.passed).toBe(false);
    expect(result.baselineDelta.added).toEqual([
      { file: "tests/delta.test.ts", rule: "no-physical-fs-call", observed: 3, baseline: 0 },
    ]);
    expect(result.baselineDelta.resolved).toEqual([
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", observed: 0, baseline: 3 },
    ]);
  });

  test("records a removed violation as resolved and never fails the gate", () => {
    const result = comparePurityBaseline(BACKLOG, [
      { file: "tests/beta.test.ts", rule: "no-unmocked-subprocess-call", count: 1 },
    ]);

    expect(result.passed).toBe(true);
    expect(result.baselineDelta.resolved).toEqual([
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", observed: 0, baseline: 3 },
    ]);
    expect(result.baselineDelta.added).toHaveLength(0);
    expect(result.baselineDelta.worsened).toHaveLength(0);
  });

  test("treats a reduced violation count as an improvement that cannot fail the gate", () => {
    const result = comparePurityBaseline(BACKLOG, [
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 1 },
      { file: "tests/beta.test.ts", rule: "no-unmocked-subprocess-call", count: 1 },
    ]);

    expect(result.passed).toBe(true);
    expect(result.baselineDelta.added).toHaveLength(0);
    expect(result.baselineDelta.worsened).toHaveLength(0);
  });

  test("passes when the whole backlog is resolved at once", () => {
    const result = comparePurityBaseline(BACKLOG, []);

    expect(result.passed).toBe(true);
    expect(result.baselineDelta.resolved).toHaveLength(2);
  });

  test("rejects a baseline carrying a duplicate file and rule identity", () => {
    const duplicated = baselineOf([
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 1 },
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 2 },
    ]);

    expect(() => comparePurityBaseline(duplicated, [])).toThrow("duplicate identity");
  });
});

describe("purity ratchet reason carry-over", () => {
  test("carries over human reason attributes by (file, rule) join byte-for-byte", () => {
    const reasonAlpha = "containment auditor: asserts against live fs by design";
    const reasonBeta = "subprocess auditor: unmocked binary execution";

    const baselineEntries: PurityBaselineEntry[] = [
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 2, reason: reasonAlpha },
      {
        file: "tests/beta.test.ts",
        rule: "no-unmocked-subprocess-call",
        count: 1,
        reason: reasonBeta,
      },
      { file: "tests/delta.test.ts", rule: "no-physical-fs-call", count: 5 },
    ];

    const current: PurityBaselineEntry[] = [
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 3 },
      { file: "tests/beta.test.ts", rule: "no-unmocked-subprocess-call", count: 1 },
      { file: "tests/delta.test.ts", rule: "no-physical-fs-call", count: 5 },
      { file: "tests/gamma.test.ts", rule: "no-physical-tmpdir-import", count: 1 },
    ];

    const joined = carryOverReasons(current, baselineEntries);

    expect(joined).toEqual([
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 3, reason: reasonAlpha },
      {
        file: "tests/beta.test.ts",
        rule: "no-unmocked-subprocess-call",
        count: 1,
        reason: reasonBeta,
      },
      { file: "tests/delta.test.ts", rule: "no-physical-fs-call", count: 5 },
      { file: "tests/gamma.test.ts", rule: "no-physical-tmpdir-import", count: 1 },
    ]);
  });

  test("cleanly drops resolved entries and never resurrects them", () => {
    const resolvedReason = "historic exception now resolved";
    const baselineEntries: PurityBaselineEntry[] = [
      {
        file: "tests/resolved.test.ts",
        rule: "no-physical-fs-call",
        count: 1,
        reason: resolvedReason,
      },
      {
        file: "tests/active.test.ts",
        rule: "no-physical-fs-call",
        count: 2,
        reason: "active reason",
      },
    ];

    const current: PurityBaselineEntry[] = [
      { file: "tests/active.test.ts", rule: "no-physical-fs-call", count: 2 },
    ];

    const joined = carryOverReasons(current, baselineEntries);

    expect(joined).toHaveLength(1);
    expect(joined[0]?.file).toBe("tests/active.test.ts");
    expect(joined[0]?.reason).toBe("active reason");
    expect(joined.some((entry) => entry.file === "tests/resolved.test.ts")).toBe(false);
  });
});

describe("purity exceedance reason formatting", () => {
  test("displays reason in terminal report when present", () => {
    const tolerance: PurityTolerance = {
      blocking: [violation("tests/alpha.test.ts", "no-physical-fs-call")],
      tolerated: [],
      exceedances: [
        {
          file: "tests/alpha.test.ts",
          rule: "no-physical-fs-call",
          observed: 5,
          allowed: 2,
          reason: "live fs required for containment",
        },
      ],
    };

    const report = formatTerminalReport(1, tolerance.blocking, undefined, tolerance);

    expect(report).toContain(
      "  - tests/alpha.test.ts [no-physical-fs-call]: observed 5 > allowed 2: live fs required for containment",
    );
  });

  test("formats exceedance without trailing reason when reason is undefined", () => {
    const tolerance: PurityTolerance = {
      blocking: [violation("tests/alpha.test.ts", "no-physical-fs-call")],
      tolerated: [],
      exceedances: [
        {
          file: "tests/alpha.test.ts",
          rule: "no-physical-fs-call",
          observed: 5,
          allowed: 2,
        },
      ],
    };

    const report = formatTerminalReport(1, tolerance.blocking, undefined, tolerance);

    expect(report).toContain(
      "  - tests/alpha.test.ts [no-physical-fs-call]: observed 5 > allowed 2\n",
    );
  });
});
