import { describe, expect, test } from "bun:test";
import {
  MANDATORY_COVERAGE_THRESHOLD,
  processTestStreamEvents,
  evaluateCoverageGate,
  renderHtml5CoverageDashboard,
  sanitizeVirtualPath,
  simulateVirtualFsIsolation,
  computeParetoSkew,
  formatDeepLink,
  escapeHtml,
  type TestStreamEvent,
  type CoverageBreakdown,
} from "../../olt/scripts/src/mind/implement-live-streaming-test-runner-90-mandatory-coverage-gate-fast-in-memory-test-suite-and-sleek-html5-coverage-analytics-dashboard-fb-1788286600000-tcovh.ts";

describe("Live Streaming Test Runner & +90% Coverage Gate Dashboard", () => {
  test("Probe 1: maintains strict 90% coverage threshold constant", () => {
    expect(MANDATORY_COVERAGE_THRESHOLD).toBe(90);
  });

  test("Probe 2: processes test stream events with timing and pass rate metrics", () => {
    const events: readonly TestStreamEvent[] = [
      { id: "e1", testName: "unit-1", suiteName: "mind-core", durationMs: 15, status: "pass" },
      { id: "e2", testName: "unit-2", suiteName: "mind-core", durationMs: 25, status: "pass" },
      { id: "e3", testName: "unit-3", suiteName: "mind-core", durationMs: 10, status: "skip" },
    ];
    const summary = processTestStreamEvents(events);
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.totalDurationMs).toBe(50);
    expect(summary.passRate).toBe(67);
  });

  test("Probe 3: empty stream event collection produces 100% pass rate and zero duration", () => {
    const summary = processTestStreamEvents([]);
    expect(summary.total).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.totalDurationMs).toBe(0);
    expect(summary.passRate).toBe(100);
  });

  test("Probe 4: negative durations in stream events are clamped to zero", () => {
    const events: readonly TestStreamEvent[] = [
      { id: "e1", testName: "neg-1", suiteName: "suite", durationMs: -50, status: "pass" },
      { id: "e2", testName: "pos-1", suiteName: "suite", durationMs: 30, status: "pass" },
    ];
    const summary = processTestStreamEvents(events);
    expect(summary.totalDurationMs).toBe(30);
    expect(summary.minDurationMs).toBe(0);
  });

  test("Probe 5: NaN durations in stream events are sanitized to zero", () => {
    const events: readonly TestStreamEvent[] = [
      { id: "e1", testName: "nan-1", suiteName: "suite", durationMs: Number.NaN, status: "fail" },
    ];
    const summary = processTestStreamEvents(events);
    expect(summary.totalDurationMs).toBe(0);
    expect(summary.failed).toBe(1);
  });

  test("Probe 6: malformed test statuses default to skipped without breaking aggregation", () => {
    const malformed = [
      { id: "m1", testName: "m-1", suiteName: "suite", durationMs: 5, status: "unknown" as "skip" },
    ];
    const summary = processTestStreamEvents(malformed);
    expect(summary.skipped).toBe(1);
    expect(summary.passed).toBe(0);
  });

  test("Probe 7: bimodal test durations are aggregated accurately with correct extremes", () => {
    const events: readonly TestStreamEvent[] = [
      { id: "e1", testName: "heavy", suiteName: "suite", durationMs: 60000, status: "pass" },
      { id: "e2", testName: "micro", suiteName: "suite", durationMs: 2, status: "pass" },
    ];
    const summary = processTestStreamEvents(events);
    expect(summary.totalDurationMs).toBe(60002);
    expect(summary.maxDurationMs).toBe(60000);
    expect(summary.minDurationMs).toBe(2);
  });

  test("Probe 8: evaluates coverage gate when exceeding 90% threshold", () => {
    const high: CoverageBreakdown = {
      linesPercentage: 94.5,
      statementsPercentage: 93.0,
      functionsPercentage: 92.0,
      branchesPercentage: 91.0,
    };
    const verdict = evaluateCoverageGate(high);
    expect(verdict.meetsGate).toBe(true);
    expect(verdict.deficit).toBe(0);
  });

  test("Probe 9: rejects coverage gate when below 90% threshold with exact deficit", () => {
    const low: CoverageBreakdown = {
      linesPercentage: 85.0,
      statementsPercentage: 82.0,
      functionsPercentage: 80.0,
      branchesPercentage: 75.0,
    };
    const verdict = evaluateCoverageGate(low);
    expect(verdict.meetsGate).toBe(false);
    expect(verdict.deficit).toBeGreaterThan(0);
  });

  test("Probe 10: exact 90.0% boundary meets coverage gate with zero deficit", () => {
    const exact: CoverageBreakdown = {
      linesPercentage: 90,
      statementsPercentage: 90,
      functionsPercentage: 90,
      branchesPercentage: 90,
    };
    const verdict = evaluateCoverageGate(exact);
    expect(verdict.meetsGate).toBe(true);
    expect(verdict.averageCoverage).toBe(90);
    expect(verdict.deficit).toBe(0);
  });

  test("Probe 11: 89.9% sub-threshold deficit triggers gate failure with exact 0.1 deficit", () => {
    const deficit: CoverageBreakdown = {
      linesPercentage: 89.9,
      statementsPercentage: 89.9,
      functionsPercentage: 89.9,
      branchesPercentage: 89.9,
    };
    const verdict = evaluateCoverageGate(deficit);
    expect(verdict.meetsGate).toBe(false);
    expect(verdict.deficit).toBe(0.1);
  });

  test("Probe 12: 0.0% zero coverage yields exact 90.0 deficit and rejects gate", () => {
    const zero: CoverageBreakdown = {
      linesPercentage: 0,
      statementsPercentage: 0,
      functionsPercentage: 0,
      branchesPercentage: 0,
    };
    const verdict = evaluateCoverageGate(zero);
    expect(verdict.meetsGate).toBe(false);
    expect(verdict.deficit).toBe(90);
  });

  test("Probe 13: NaN coverage percentage inputs are clamped to zero without crashing", () => {
    const nanCov: CoverageBreakdown = {
      linesPercentage: Number.NaN,
      statementsPercentage: 90,
      functionsPercentage: 90,
      branchesPercentage: 90,
    };
    const verdict = evaluateCoverageGate(nanCov);
    expect(verdict.averageCoverage).toBe(67.5);
    expect(verdict.meetsGate).toBe(false);
  });

  test("Probe 14: percentages exceeding 100.0% are clamped to 100.0%", () => {
    const over: CoverageBreakdown = {
      linesPercentage: 150,
      statementsPercentage: 100,
      functionsPercentage: 100,
      branchesPercentage: 100,
    };
    const verdict = evaluateCoverageGate(over);
    expect(verdict.averageCoverage).toBe(100);
  });

  test("Probe 15: sanitizeVirtualPath prevents path traversal escape past root", () => {
    expect(sanitizeVirtualPath("/a/b/../../../../escape")).toBe("/escape");
    expect(sanitizeVirtualPath("nested/../deep/file.ts", "/root")).toBe("/root/deep/file.ts");
    expect(sanitizeVirtualPath("C:\\Windows\\System32\\file.txt")).toBe(
      "/C:/Windows/System32/file.txt",
    );
  });

  test("Probe 16: simulateVirtualFsIsolation supports deep directory nesting without disk writes", () => {
    const fs = simulateVirtualFsIsolation();
    fs.write("/workspace/src/core/module.ts", "export const v = 1;");
    expect(fs.exists("/workspace/src/core/module.ts")).toBe(true);
    expect(fs.read("/workspace/src/core/module.ts")).toBe("export const v = 1;");
  });

  test("Probe 17: snapshot isolation ensures mutations do not affect dumped snapshots", () => {
    const fs = simulateVirtualFsIsolation({ "/a.txt": "first" });
    const snap = fs.snapshot();
    fs.write("/a.txt", "second");
    expect(snap["/a.txt"]).toBe("first");
    expect(fs.read("/a.txt")).toBe("second");
  });

  test("Probe 18: reset cleanliness restores virgin virtual filesystem state", () => {
    const fs = simulateVirtualFsIsolation({ "/temp.txt": "data" });
    fs.reset();
    expect(fs.exists("/temp.txt")).toBe(false);
    expect(fs.snapshot()).toEqual({});
  });

  test("Probe 19: traversal prevention throws when accessing unmapped traversed file", () => {
    const fs = simulateVirtualFsIsolation();
    expect(() => fs.read("/missing/traversal/target")).toThrow();
  });

  test("Probe 20: empty durations produce zero Pareto counts without division by zero", () => {
    const p = computeParetoSkew([]);
    expect(p.p50Count).toBe(0);
    expect(p.p90Count).toBe(0);
    expect(p.totalDurationMs).toBe(0);
    expect(p.isSkewed).toBe(false);
  });

  test("Probe 21: all-zero durations produce zero total duration without NaN", () => {
    const p = computeParetoSkew([0, 0, 0]);
    expect(p.totalDurationMs).toBe(0);
    expect(p.p50Count).toBe(3);
    expect(p.p90Count).toBe(3);
  });

  test("Probe 22: extreme bimodal distribution concentrates P50 in single slowest item", () => {
    const durations = [100000, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const p = computeParetoSkew(durations);
    expect(p.p50Count).toBe(1);
    expect(p.p90Count).toBe(1);
    expect(p.isSkewed).toBe(true);
  });

  test("Probe 23: uniform durations produce balanced Pareto percentiles", () => {
    const durations = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
    const p = computeParetoSkew(durations);
    expect(p.p50Count).toBe(5);
    expect(p.p90Count).toBe(9);
    expect(p.isSkewed).toBe(false);
  });

  test("Probe 24: single item duration satisfies both P50 and P90 with count 1", () => {
    const p = computeParetoSkew([500]);
    expect(p.p50Count).toBe(1);
    expect(p.p90Count).toBe(1);
    expect(p.totalDurationMs).toBe(500);
  });

  test("Probe 25: renders Obsidian theme tokens and CSS variables in HTML dashboard", () => {
    const summary = processTestStreamEvents([]);
    const verdict = evaluateCoverageGate({
      linesPercentage: 92,
      statementsPercentage: 92,
      functionsPercentage: 92,
      branchesPercentage: 92,
    });
    const html = renderHtml5CoverageDashboard(summary, verdict);
    expect(html).toContain("--bg-primary: #1e1e1e;");
    expect(html).toContain("--text-normal: #dcddde;");
    expect(html).toContain("--interactive-accent: #7c3aed;");
  });

  test("Probe 26: deep link routing formats links adhering to #coverage/path:L42 format", () => {
    expect(formatDeepLink("src/index.ts", 42)).toBe("#coverage/src/index.ts:L42");
    expect(formatDeepLink("src/index.ts")).toBe("#coverage/src/index.ts");
    expect(formatDeepLink("\\src\\win.ts", 10)).toBe("#coverage/src/win.ts:L10");
  });

  test("Probe 27: escapes HTML special characters to prevent XSS injection in dashboard", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
    const summary = processTestStreamEvents([]);
    const verdict = evaluateCoverageGate({
      linesPercentage: 95,
      statementsPercentage: 95,
      functionsPercentage: 95,
      branchesPercentage: 95,
    });
    const html = renderHtml5CoverageDashboard(summary, verdict, {
      title: "<img src=x onerror=alert(1)>",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  test("Probe 28: highlights active deep link target in rendered dashboard markup", () => {
    const summary = processTestStreamEvents([]);
    const verdict = evaluateCoverageGate({
      linesPercentage: 95,
      statementsPercentage: 95,
      functionsPercentage: 95,
      branchesPercentage: 95,
    });
    const html = renderHtml5CoverageDashboard(summary, verdict, {
      activeDeepLink: "scripts/runner.ts",
    });
    expect(html).toContain("#coverage/scripts/runner.ts:L42");
  });
});
