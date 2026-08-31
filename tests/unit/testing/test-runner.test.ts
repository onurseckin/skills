import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as childProcess from "node:child_process";
import * as reporting from "../../../scripts/testing/reporting/index.ts";
import { computeIsMain, executeTestRunner, main } from "../../../scripts/testing/test-runner.ts";

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

  test("executeTestRunner runs targeted test suite without coverage", () => {
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
      expect(spawnSyncSpy).toHaveBeenCalled();
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
    } finally {
      spawnSyncSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("executeTestRunner with default args runs broad scope", () => {
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
    } finally {
      spawnSyncSpy.mockRestore();
    }
  });
});
