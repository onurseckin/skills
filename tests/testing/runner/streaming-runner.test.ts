import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import * as reporting from "../../../scripts/testing/reporting/index.ts";
import * as testMutex from "../../../scripts/testing/test-mutex.ts";
import { executeStreamingRunner } from "../../../scripts/testing/runner/streaming-runner.ts";

describe("streaming-runner", () => {
  let lockSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    lockSpy = spyOn(testMutex, "acquireTestLock").mockReturnValue(() => {});
  });

  afterEach(() => {
    lockSpy.mockRestore();
  });
  test("executeStreamingRunner spawns bun test and pipes stream to parser and ticker", async () => {
    const mockStdout = new EventEmitter();
    const mockStderr = new EventEmitter();
    const mockChild = Object.assign(new EventEmitter(), {
      stdout: mockStdout,
      stderr: mockStderr,
      exitCode: 0,
    });

    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
      setTimeout(() => {
        mockStdout.emit(
          "data",
          Buffer.from(
            "tests/unit.test.ts:\n(pass) unit > works [0.50ms]\n 1 pass\nRan 1 tests across 1 files. [50.00ms]\n",
          ),
        );
        setTimeout(() => {
          mockChild.emit("close", 0);
        }, 10);
      }, 5);
      return mockChild as unknown as childProcess.ChildProcess;
    });

    const written: string[] = [];
    const customStdout = {
      write: (str: string) => {
        written.push(str);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    try {
      const result = await executeStreamingRunner(["tests/unit.test.ts"], {
        interactive: false,
        stdout: customStdout,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stats.testsPassed).toBe(1);
      expect(result.stats.suitesTotal).toBe(1);
      expect(spawnSpy).toHaveBeenCalledTimes(1);

      const spawnArgs = spawnSpy.mock.calls[0];
      expect(spawnArgs[0]).toBe("bun");
      expect(spawnArgs[1]).toEqual([
        "test",
        "--timeout",
        "30000",
        "--parallel",
        "tests/unit.test.ts",
      ]);
      expect(written.some((w) => w.includes("TEST EXECUTION SUMMARY"))).toBe(true);
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("executeStreamingRunner processes coverage artifacts when --coverage is supplied", async () => {
    const mockStdout = new EventEmitter();
    const mockStderr = new EventEmitter();
    const mockChild = Object.assign(new EventEmitter(), {
      stdout: mockStdout,
      stderr: mockStderr,
      exitCode: 0,
    });

    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
      setTimeout(() => {
        mockStdout.emit(
          "data",
          Buffer.from("tests/cov.test.ts:\n(pass) cov > test [1.00ms]\n 1 pass\n"),
        );
        setTimeout(() => {
          mockChild.emit("close", 0);
        }, 10);
      }, 5);
      return mockChild as unknown as childProcess.ChildProcess;
    });

    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: true,
      filesCount: 12,
      totalPct: 95.0,
      summary: {
        total: {
          lines: { total: 100, covered: 95, skipped: 0, pct: 95.0 },
          statements: { total: 100, covered: 95, skipped: 0, pct: 95.0 },
          functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
        },
      },
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      const result = await executeStreamingRunner(["--coverage", "tests/cov.test.ts"], {
        interactive: false,
        stdout: { write: () => true } as unknown as NodeJS.WritableStream,
      });

      expect(result.exitCode).toBe(0);
      expect(reportSpy).toHaveBeenCalledTimes(1);
      expect(result.coverageResult?.totalPct).toBe(95.0);
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  test("executeStreamingRunner sets exitCode to 1 when coverage falls below 90% quality gate", async () => {
    const mockStdout = new EventEmitter();
    const mockStderr = new EventEmitter();
    const mockChild = Object.assign(new EventEmitter(), {
      stdout: mockStdout,
      stderr: mockStderr,
      exitCode: 0,
    });

    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
      setTimeout(() => {
        mockStdout.emit(
          "data",
          Buffer.from("tests/cov.test.ts:\n(pass) cov > test [1.00ms]\n 1 pass\n"),
        );
        setTimeout(() => {
          mockChild.emit("close", 0);
        }, 10);
      }, 5);
      return mockChild as unknown as childProcess.ChildProcess;
    });

    const reportSpy = spyOn(reporting, "processCoverageArtifacts").mockReturnValue({
      lcovExists: true,
      filesCount: 10,
      totalPct: 80.0,
      summary: {
        total: {
          lines: { total: 100, covered: 80, skipped: 0, pct: 80.0 },
          statements: { total: 100, covered: 80, skipped: 0, pct: 80.0 },
          functions: { total: 10, covered: 8, skipped: 0, pct: 80.0 },
        },
      },
    });

    const errSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await executeStreamingRunner(["tests"], {
        interactive: false,
        stdout: { write: () => true } as unknown as NodeJS.WritableStream,
      });

      expect(result.exitCode).toBe(1);
      expect(reportSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalled();
    } finally {
      spawnSpy.mockRestore();
      reportSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("executeStreamingRunner handles failure exit code cleanly", async () => {
    const mockStdout = new EventEmitter();
    const mockStderr = new EventEmitter();
    const mockChild = Object.assign(new EventEmitter(), {
      stdout: mockStdout,
      stderr: mockStderr,
      exitCode: 1,
    });

    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
      setTimeout(() => {
        mockStderr.emit(
          "data",
          Buffer.from("tests/fail.test.ts:\n(fail) fail > broken [1.00ms]\n 1 fail\n"),
        );
        setTimeout(() => {
          mockChild.emit("close", 1);
        }, 10);
      }, 5);
      return mockChild as unknown as childProcess.ChildProcess;
    });

    try {
      const result = await executeStreamingRunner(["tests/fail.test.ts"], {
        interactive: false,
        stdout: { write: () => true } as unknown as NodeJS.WritableStream,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stats.testsFailed).toBe(1);
    } finally {
      spawnSpy.mockRestore();
    }
  });
});
