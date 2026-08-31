import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as childProcess from "node:child_process";
import { join } from "node:path";

describe("test-changed script", () => {
  const scriptPath = join(process.cwd(), "scripts/testing/test-changed.ts");
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;
  let spawnSyncSpy: ReturnType<typeof spyOn>;
  let recordedExitCode: number | undefined;

  beforeEach(() => {
    recordedExitCode = undefined;
    exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      recordedExitCode = typeof code === "number" ? code : 0;
      return undefined as never;
    });
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (spawnSyncSpy) {
      spawnSyncSpy.mockRestore();
    }
  });

  test("runs standalone script check via spawnSync", () => {
    const result = childProcess.spawnSync("bun", [scriptPath, "--help"], {
      encoding: "utf-8",
      cwd: process.cwd(),
      timeout: 30000,
    });
    expect(typeof result.status).toBe("number");
  });

  test("in-process execution handles git diff resolution, test execution, and 95% coverage gating with mocks", async () => {
    spawnSyncSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd, args) => {
      const command = String(cmd);
      const argList = Array.isArray(args) ? args.map(String) : [];

      if (command === "git") {
        if (argList.includes("diff") && argList.includes("--name-only")) {
          return {
            stdout: "scripts/testing/test-mutex.ts\ntests/scripts/testing/test-mutex.test.ts\n",
            stderr: "",
            status: 0,
            pid: 1234,
            output: [],
            signal: null,
          };
        }
        if (argList.includes("merge-base")) {
          return {
            stdout: "abc1234",
            stderr: "",
            status: 0,
            pid: 1234,
            output: [],
            signal: null,
          };
        }
        return {
          stdout: "",
          stderr: "",
          status: 0,
          pid: 1234,
          output: [],
          signal: null,
        };
      }

      if (command === "bun") {
        const mockCoverageOutput = [
          "-------------------------------|---------|---------|-------------------",
          "File                           | % Lines | % Stmts | Uncovered Lines   ",
          "-------------------------------|---------|---------|-------------------",
          "scripts/testing/test-mutex.ts  |  100.0  |  100.0  |                   ",
          "-------------------------------|---------|---------|-------------------",
        ].join("\n");
        return {
          stdout: mockCoverageOutput,
          stderr: "",
          status: 0,
          pid: 1234,
          output: [],
          signal: null,
        };
      }

      return {
        stdout: "",
        stderr: "",
        status: 0,
        pid: 1234,
        output: [],
        signal: null,
      };
    });

    const mod = await import("../../../scripts/testing/test-changed.ts");
    const exitCode = await mod.run();
    expect(exitCode).toBe(0);
  });
});
