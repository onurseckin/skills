import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as childProcess from "node:child_process";
import * as reporting from "../../../scripts/testing/reporting/index.ts";
import * as testMutex from "../../../scripts/testing/test-mutex.ts";
import { computeIsMain, executeTestRunner, main } from "../../../scripts/testing/test-runner.ts";

describe("test-runner script", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let lockSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    lockSpy = spyOn(testMutex, "acquireTestLock").mockReturnValue(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    lockSpy.mockRestore();
  });

  test("main() executes runner and calls process.exit", () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    const spawnSyncSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      pid: 1234,
      output: [],
      stdout: "",
      stderr: "",
      signal: null,
    });
    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: true,
      filesCount: 5,
      totalPct: 100,
      summary: {
        total: {
          lines: { total: 50, covered: 50, skipped: 0, pct: 100 },
          statements: { total: 50, covered: 50, skipped: 0, pct: 100 },
          functions: { total: 5, covered: 5, skipped: 0, pct: 100 },
        },
      },
    });

    try {
      main();
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
      spawnSyncSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("computeIsMain detects main and argv path correctly", () => {
    expect(computeIsMain(true)).toBe(true);
    expect(computeIsMain(false, undefined)).toBe(false);
    expect(computeIsMain(false, "/repo/scripts/testing/test-runner.ts")).toBe(true);
    expect(computeIsMain(false, "/repo/scripts/testing/test-runner")).toBe(true);
    expect(computeIsMain(false, "/repo/other.ts")).toBe(false);
  });

  test("executeTestRunner runs targeted test suite with injected test environment", () => {
    const spawnSyncSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      pid: 1234,
      output: [],
      stdout: "",
      stderr: "",
      signal: null,
    });

    try {
      const code = executeTestRunner(["tests/testing/runner/test-runner.test.ts"]);
      expect(code).toBe(0);
      expect(spawnSyncSpy).toHaveBeenCalledTimes(1);
      const callArgs = spawnSyncSpy.mock.calls[0];
      expect(callArgs[0]).toBe("bun");
      expect(callArgs[1]).toEqual([
        "test",
        "--timeout",
        "30000",
        "--parallel",
        "tests/testing/runner/test-runner.test.ts",
      ]);
      const opts = callArgs[2] as { env?: Record<string, string>; maxBuffer?: number };
      expect(opts.maxBuffer).toBe(100 * 1024 * 1024);
      expect(opts.env?.OLT_VIRTUAL_FS).toBe("1");
      expect(opts.env?.BUN_ENV).toBe("test");
    } finally {
      spawnSyncSpy.mockRestore();
    }
  });

  test("executeTestRunner runs broad test suite with --coverage flag and passes 90% quality gate", () => {
    const spawnSyncSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      pid: 1234,
      output: [],
      stdout: "",
      stderr: "",
      signal: null,
    });

    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: true,
      filesCount: 15,
      totalPct: 95.0,
      summary: {
        total: {
          lines: { total: 100, covered: 95, skipped: 0, pct: 95.0 },
          statements: { total: 100, covered: 95, skipped: 0, pct: 95.0 },
          functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
        },
      },
      summaryPath: "/tmp/coverage-summary.json",
      reportPath: "/tmp/REPORT.md",
      htmlPath: "/tmp/index.html",
    });

    try {
      const code = executeTestRunner(["--coverage", "tests/testing"]);
      expect(code).toBe(0);
      expect(reportSpy).toHaveBeenCalled();
      const callArgs = spawnSyncSpy.mock.calls[0];
      const opts = callArgs[2] as { env?: Record<string, string> };
      expect(opts.env?.OLT_VIRTUAL_FS).toBe("1");
      expect(opts.env?.BUN_ENV).toBe("test");
    } finally {
      spawnSyncSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("executeTestRunner rejects and returns exit code 1 when coverage falls below 90% quality gate", () => {
    const spawnSyncSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      pid: 1234,
      output: [],
      stdout: "",
      stderr: "",
      signal: null,
    });

    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: true,
      filesCount: 10,
      totalPct: 75.0,
      summary: {
        total: {
          lines: { total: 100, covered: 75, skipped: 0, pct: 75.0 },
          statements: { total: 100, covered: 75, skipped: 0, pct: 75.0 },
          functions: { total: 10, covered: 8, skipped: 0, pct: 80.0 },
        },
      },
    });

    const errSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = executeTestRunner(["tests"]);
      expect(code).toBe(1);
      expect(reportSpy).toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      spawnSyncSpy.mockRestore();
      reportSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("executeTestRunner with --no-coverage skips coverage even on broad scope", () => {
    const spawnSyncSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      pid: 1234,
      output: [],
      stdout: "",
      stderr: "",
      signal: null,
    });

    const reportSpy = spyOn(reporting, "processCoverageArtifacts");

    try {
      const code = executeTestRunner(["--no-coverage", "tests"]);
      expect(code).toBe(0);
      expect(reportSpy).not.toHaveBeenCalled();
      const callArgs = spawnSyncSpy.mock.calls[0];
      expect(callArgs[1]).not.toContain("--coverage");
    } finally {
      spawnSyncSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("executeTestRunner with default args runs broad scope with default coverage and injected env", () => {
    const spawnSyncSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      pid: 1234,
      output: [],
      stdout: "",
      stderr: "",
      signal: null,
    });

    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: true,
      filesCount: 5,
      totalPct: 100,
      summary: {
        total: {
          lines: { total: 50, covered: 50, skipped: 0, pct: 100 },
          statements: { total: 50, covered: 50, skipped: 0, pct: 100 },
          functions: { total: 5, covered: 5, skipped: 0, pct: 100 },
        },
      },
    });

    try {
      const code = executeTestRunner([]);
      expect(code).toBe(0);
      expect(reportSpy).toHaveBeenCalled();
      const callArgs = spawnSyncSpy.mock.calls[0];
      expect(callArgs[1]).toContain("--coverage");
      const opts = callArgs[2] as { env?: Record<string, string> };
      expect(opts.env?.OLT_VIRTUAL_FS).toBe("1");
      expect(opts.env?.BUN_ENV).toBe("test");
    } finally {
      spawnSyncSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });
});
