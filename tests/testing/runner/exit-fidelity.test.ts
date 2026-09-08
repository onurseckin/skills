import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import * as reporting from "../../../scripts/testing/reporting/index.ts";
import * as testMutex from "../../../scripts/testing/index.ts";
import { executeTestRunner } from "../../../scripts/testing/test-runner.ts";
import type { TestRunnerPorts } from "../../../scripts/testing/test-runner.ts";
import { createSpawnMock } from "./index.ts";
import type {
  PurityAuditOptions,
  PurityAuditResult,
} from "../../../scripts/testing/guardrails/index.ts";

const CLEAN_AUDIT_PORTS: TestRunnerPorts = {
  auditTestPuritySync: (_options: PurityAuditOptions): PurityAuditResult => ({
    passed: true,
    scope: "repository",
    requestedFiles: 1,
    scannedFiles: 1,
    vacuous: false,
    violations: [],
    terminalReport: "PURITY_OK",
    markdownReport: "",
  }),
};

const PASSING_COVERAGE_SUMMARY = {
  total: {
    lines: { total: 100, covered: 95, skipped: 0, pct: 95.0 },
    statements: { total: 100, covered: 95, skipped: 0, pct: 95.0 },
    functions: { total: 10, covered: 10, skipped: 0, pct: 100.0 },
  },
};

describe("test runner exit fidelity", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let errSpy: ReturnType<typeof spyOn>;
  let lockSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errSpy = spyOn(console, "error").mockImplementation(() => {});
    lockSpy = spyOn(testMutex, "acquireTestLock").mockReturnValue(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    lockSpy.mockRestore();
  });

  test("preserves non-zero exit code 1 when child fails and coverage gate passes", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      createSpawnMock({ status: 1 }),
    );
    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: true,
      filesCount: 5,
      totalPct: 95.0,
      summary: PASSING_COVERAGE_SUMMARY,
      summaryPath: "/tmp/coverage-summary.json",
      reportPath: "/tmp/REPORT.md",
      htmlPath: "/tmp/index.html",
    });

    try {
      const code = await executeTestRunner(["--coverage", "tests/sample"], CLEAN_AUDIT_PORTS);
      expect(code).toBe(1);
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("preserves non-zero exit code 2 when child fails with code 2 and coverage gate passes", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      createSpawnMock({ status: 2 }),
    );
    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: true,
      filesCount: 5,
      totalPct: 95.0,
      summary: PASSING_COVERAGE_SUMMARY,
      summaryPath: "/tmp/coverage-summary.json",
      reportPath: "/tmp/REPORT.md",
      htmlPath: "/tmp/index.html",
    });

    try {
      const code = await executeTestRunner(["--coverage", "tests/sample"], CLEAN_AUDIT_PORTS);
      expect(code).toBe(2);
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("returns 0 when child succeeds and coverage gate passes", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      createSpawnMock({ status: 0 }),
    );
    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: true,
      filesCount: 5,
      totalPct: 95.0,
      summary: PASSING_COVERAGE_SUMMARY,
      summaryPath: "/tmp/coverage-summary.json",
      reportPath: "/tmp/REPORT.md",
      htmlPath: "/tmp/index.html",
    });

    try {
      const code = await executeTestRunner(["--coverage", "tests/sample"], CLEAN_AUDIT_PORTS);
      expect(code).toBe(0);
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("raises exit code from 0 to 1 when child succeeds but coverage gate fails", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      createSpawnMock({ status: 0 }),
    );
    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: true,
      filesCount: 5,
      totalPct: 50.0,
      summary: {
        total: {
          lines: { total: 100, covered: 50, skipped: 0, pct: 50.0 },
          statements: { total: 100, covered: 50, skipped: 0, pct: 50.0 },
          functions: { total: 10, covered: 5, skipped: 0, pct: 50.0 },
        },
      },
      summaryPath: "/tmp/coverage-summary.json",
      reportPath: "/tmp/REPORT.md",
      htmlPath: "/tmp/index.html",
    });

    try {
      const code = await executeTestRunner(["--coverage", "tests/sample"], CLEAN_AUDIT_PORTS);
      expect(code).toBe(1);
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });
});
