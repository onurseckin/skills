import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as childProcess from "node:child_process";
import { join } from "node:path";

describe("test-runner script", () => {
  const runnerScript = join(process.cwd(), "scripts/testing/test-runner.ts");
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  let recordedExitCode: number | undefined;

  beforeEach(() => {
    recordedExitCode = undefined;
    exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      recordedExitCode = typeof code === "number" ? code : 0;
      return undefined as never;
    });
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  test("runs in-process to cover test-runner module evaluation with mocked spawnSync", async () => {
    const origArgv = [...process.argv];
    process.argv = ["bun", runnerScript, "tests/scripts/testing/test-runner.test.ts"];

    const spawnSyncSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      pid: 1234,
      output: [],
      stdout: "",
      stderr: "",
      signal: null,
    });

    try {
      const { main: runMain } = await import("../../../scripts/testing/test-runner.ts");
      runMain();
    } finally {
      process.argv = origArgv;
      spawnSyncSpy.mockRestore();
    }

    expect(recordedExitCode).toBe(0);
  });
});
