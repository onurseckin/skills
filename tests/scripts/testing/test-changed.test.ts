import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as childProcess from "node:child_process";
import {
  parseDiffOutput,
  parseGitStatusPorcelain,
  parseUnifiedDiffHeaders,
  run,
  main,
} from "../../../scripts/testing/test-changed.ts";

describe("test-changed script (in-memory virtual)", () => {
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;
  let spawnSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
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

  test("diff parsing functions handle various git diff headers and porcelain outputs", () => {
    expect(parseDiffOutput("a.ts\nb.ts\n\n")).toEqual(["a.ts", "b.ts"]);

    const porcelain = " M foo.ts\n?? bar.ts\nR  old.ts -> new.ts\n";
    expect(parseGitStatusPorcelain(porcelain).sort()).toEqual(["bar.ts", "foo.ts", "new.ts"]);

    const unified = "diff --git a/src/a.ts b/src/a.ts\n+++ b/src/b.ts\n";
    expect(parseUnifiedDiffHeaders(unified).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("handles --help flag directly without child process spawn", async () => {
    const code = await run(["--help"]);
    expect(code).toBe(0);
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

    const exitCode = await main([]);
    expect(exitCode).toBe(0);
  });
});
