import { describe, expect, test } from "bun:test";
import {
  formatDuration,
  formatSummaryTable,
  getExecutionBadge,
} from "../../../scripts/testing/runner/summary-table.ts";
import { createDefaultRunnerStats } from "../../../scripts/testing/runner/types.ts";

describe("summary-table", () => {
  test("formatDuration formats various time units accurately", () => {
    expect(formatDuration(50)).toBe("50.00ms");
    expect(formatDuration(1500)).toBe("1.50s");
    expect(formatDuration(65200)).toBe("1m 5.20s");
  });

  test("getExecutionBadge determines badge label and styling", () => {
    const statsPass = createDefaultRunnerStats();
    statsPass.testsPassed = 10;
    statsPass.testsTotal = 10;
    expect(getExecutionBadge(statsPass, false)).toEqual({
      label: "PASS",
      text: "[PASS]",
    });
    expect(getExecutionBadge(statsPass, true).text).toContain("\x1b[1;32m[PASS]\x1b[0m");

    const statsFail = createDefaultRunnerStats();
    statsFail.testsFailed = 1;
    statsFail.testsTotal = 1;
    expect(getExecutionBadge(statsFail, false)).toEqual({
      label: "FAIL",
      text: "[FAIL]",
    });
    expect(getExecutionBadge(statsFail, true).text).toContain("\x1b[1;31m[FAIL]\x1b[0m");

    const statsWarn = createDefaultRunnerStats();
    expect(getExecutionBadge(statsWarn, false)).toEqual({
      label: "WARN",
      text: "[WARN]",
    });
  });

  test("formatSummaryTable renders passing summary without ANSI in plain mode", () => {
    const stats = createDefaultRunnerStats();
    stats.suitesTotal = 3;
    stats.suitesPassed = 3;
    stats.testsTotal = 15;
    stats.testsPassed = 15;
    stats.expectCalls = 45;

    const output = formatSummaryTable({
      stats,
      durationMs: 1200,
      useColor: false,
    });

    expect(output).toContain("TEST EXECUTION SUMMARY");
    expect(output).toContain("[PASS]");
    expect(output).toContain("Test Files:      3 passed, 3 total");
    expect(output).toContain("Tests:           15 passed, 15 total");
    expect(output).toContain("Expect Calls:    45");
    expect(output).toContain("Duration:        1.20s");
    expect(output).not.toContain("\x1b[");
  });

  test("formatSummaryTable renders failed summary with failure details and coverage", () => {
    const stats = createDefaultRunnerStats();
    stats.suitesTotal = 2;
    stats.suitesPassed = 1;
    stats.suitesFailed = 1;
    stats.testsTotal = 10;
    stats.testsPassed = 9;
    stats.testsFailed = 1;
    stats.failedSuites = ["tests/failing.test.ts"];
    stats.failedTests = [{ suite: "tests/failing.test.ts", test: "fails expected invariant" }];

    const output = formatSummaryTable({
      stats,
      durationMs: 2500,
      useColor: false,
      coverageResult: {
        lcovExists: true,
        filesCount: 8,
        totalPct: 92.5,
      },
    });

    expect(output).toContain("[FAIL]");
    expect(output).toContain("Test Files:      1 passed, 1 failed, 2 total");
    expect(output).toContain("Tests:           9 passed, 1 failed, 10 total");
    expect(output).toContain("Coverage:        92.50% line coverage (8 files)");
    expect(output).toContain("Failures:");
    expect(output).toContain("- tests/failing.test.ts > fails expected invariant");
  });
});
