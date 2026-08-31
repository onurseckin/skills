import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as childProcess from "node:child_process";
import * as reporting from "../../scripts/testing/reporting/index.ts";
import { computeIsMain, executeTestRunner, main } from "../../scripts/testing/test-runner.ts";

describe("test-runner script", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
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

    try {
      main();
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
      spawnSyncSpy.mockRestore();
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
      const code = executeTestRunner(["tests/unit/testing/test-runner.test.ts"]);
      expect(code).toBe(0);
      expect(spawnSyncSpy).toHaveBeenCalledTimes(1);
      const callArgs = spawnSyncSpy.mock.calls[0];
      expect(callArgs[0]).toBe("bun");
      expect(callArgs[1]).toEqual([
        "test",
        "--timeout",
        "30000",
        "--parallel",
        "--no-isolate",
        "tests/unit/testing/test-runner.test.ts",
      ]);
      const opts = callArgs[2] as { env?: Record<string, string> };
      expect(opts.env?.OLT_VIRTUAL_FS).toBe("1");
      expect(opts.env?.BUN_ENV).toBe("test");
    } finally {
      spawnSyncSpy.mockRestore();
    }
  });

  test("executeTestRunner runs broad test suite with --coverage flag and processes coverage artifacts", () => {
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
      totalPct: 100,
      summaryPath: "/tmp/coverage-summary.json",
      reportPath: "/tmp/REPORT.md",
      htmlPath: "/tmp/index.html",
    });

    try {
      const code = executeTestRunner(["--coverage", "tests/unit"]);
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

  test("executeTestRunner with default args runs broad scope with injected env", () => {
    const spawnSyncSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      pid: 1234,
      output: [],
      stdout: "",
      stderr: "",
      signal: null,
    });

    try {
      const code = executeTestRunner([]);
      expect(code).toBe(0);
      const callArgs = spawnSyncSpy.mock.calls[0];
      const opts = callArgs[2] as { env?: Record<string, string> };
      expect(opts.env?.OLT_VIRTUAL_FS).toBe("1");
      expect(opts.env?.BUN_ENV).toBe("test");
    } finally {
      spawnSyncSpy.mockRestore();
    }
  });
});
