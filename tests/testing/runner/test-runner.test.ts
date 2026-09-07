import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as childProcess from "node:child_process";
import * as reporting from "../../../scripts/testing/reporting/index.ts";
import * as testMutex from "../../../scripts/testing/index.ts";
import { computeIsMain, executeTestRunner, main } from "../../../scripts/testing/test-runner.ts";
import type { TestRunnerPorts } from "../../../scripts/testing/test-runner.ts";
import { createSpawnMock } from "./index.ts";
import type {
  PurityAuditOptions,
  PurityAuditResult,
} from "../../../scripts/testing/guardrails/index.ts";

function createAuditRecorder(passed: boolean): {
  readonly calls: PurityAuditOptions[];
  readonly ports: TestRunnerPorts;
} {
  const calls: PurityAuditOptions[] = [];
  return {
    calls,
    ports: {
      auditTestPuritySync: (options: PurityAuditOptions): PurityAuditResult => {
        calls.push(options);
        return {
          passed,
          scope: "repository",
          requestedFiles: 3,
          scannedFiles: 3,
          vacuous: false,
          violations: [],
          terminalReport: passed ? "PURITY_OK" : "PURITY_FAILED",
          markdownReport: "",
        };
      },
    },
  };
}

const CLEAN_AUDIT_PORTS: TestRunnerPorts = createAuditRecorder(true).ports;

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

  test("main() executes runner and calls process.exit", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());
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
      await main(CLEAN_AUDIT_PORTS);
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
      spawnSpy.mockRestore();
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

  test("executeTestRunner runs targeted test suite with injected test environment", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());

    try {
      const code = await executeTestRunner(["tests/testing/runner/test-runner.test.ts"]);
      expect(code).toBe(0);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const callArgs = spawnSpy.mock.calls[0];
      expect(callArgs[0]).toBe("bun");
      expect(callArgs[1]).toEqual([
        "test",
        "--timeout",
        "30000",
        "--parallel",
        "tests/testing/runner/test-runner.test.ts",
      ]);
      const opts = callArgs[2] as { env?: Record<string, string>; stdio?: readonly string[] };
      expect(opts.stdio).toEqual(["inherit", "inherit", "pipe"]);
      expect(opts.env?.OLT_VIRTUAL_FS).toBe("1");
      expect(opts.env?.BUN_ENV).toBe("test");
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("executeTestRunner runs broad test suite with --coverage flag and passes 90% quality gate", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());

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
      const code = await executeTestRunner(["--coverage", "tests/testing"], CLEAN_AUDIT_PORTS);
      expect(code).toBe(0);
      expect(reportSpy).toHaveBeenCalled();
      const callArgs = spawnSpy.mock.calls[0];
      const opts = callArgs[2] as { env?: Record<string, string> };
      expect(opts.env?.OLT_VIRTUAL_FS).toBe("1");
      expect(opts.env?.BUN_ENV).toBe("test");
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("executeTestRunner rejects and returns exit code 1 when coverage falls below 90% quality gate", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());

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
      const code = await executeTestRunner(["tests"], CLEAN_AUDIT_PORTS);
      expect(code).toBe(1);
      expect(reportSpy).toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("executeTestRunner with --no-coverage skips coverage even on broad scope", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());

    const reportSpy = spyOn(reporting, "processCoverageArtifacts");

    try {
      const code = await executeTestRunner(["--no-coverage", "tests"], CLEAN_AUDIT_PORTS);
      expect(code).toBe(0);
      expect(reportSpy).not.toHaveBeenCalled();
      const callArgs = spawnSpy.mock.calls[0];
      expect(callArgs[1]).not.toContain("--coverage");
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("executeTestRunner with default args runs broad scope with default coverage and injected env", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());

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
      const code = await executeTestRunner([], CLEAN_AUDIT_PORTS);
      expect(code).toBe(0);
      expect(reportSpy).toHaveBeenCalled();
      const callArgs = spawnSpy.mock.calls[0];
      expect(callArgs[1]).toContain("--coverage");
      const opts = callArgs[2] as { env?: Record<string, string> };
      expect(opts.env?.OLT_VIRTUAL_FS).toBe("1");
      expect(opts.env?.BUN_ENV).toBe("test");
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("executeTestRunner audits whole-repo purity on broad scope and aborts before spawning", async () => {
    const recorder = createAuditRecorder(false);
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());
    const errSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await executeTestRunner(["tests"], recorder.ports);
      expect(code).toBe(1);
      expect(recorder.calls).toEqual([{ all: true }]);
      expect(spawnSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith("PURITY_FAILED");
    } finally {
      spawnSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("executeTestRunner audits whole-repo purity whenever coverage is requested", async () => {
    const recorder = createAuditRecorder(true);
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());
    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: false,
      filesCount: 0,
      totalPct: 0,
    });

    try {
      const code = await executeTestRunner(["--coverage", "tests/testing"], recorder.ports);
      expect(code).toBe(0);
      expect(recorder.calls).toEqual([{ all: true }]);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  test("executeTestRunner skips the purity audit for a narrow non-coverage scope", async () => {
    const recorder = createAuditRecorder(false);
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());

    try {
      const code = await executeTestRunner(
        ["tests/testing/runner/arg-parser.test.ts"],
        recorder.ports,
      );
      expect(code).toBe(0);
      expect(recorder.calls).toEqual([]);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("executeTestRunner skips the purity audit when OLT_SKIP_PURITY is set", async () => {
    const recorder = createAuditRecorder(false);
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());
    const previous = process.env.OLT_SKIP_PURITY;
    process.env.OLT_SKIP_PURITY = "1";

    try {
      const code = await executeTestRunner(["--no-coverage", "tests"], recorder.ports);
      expect(code).toBe(0);
      expect(recorder.calls).toEqual([]);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) {
        delete process.env.OLT_SKIP_PURITY;
      } else {
        process.env.OLT_SKIP_PURITY = previous;
      }
      spawnSpy.mockRestore();
    }
  });
});
