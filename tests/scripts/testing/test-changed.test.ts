/**
 * @file test-changed.test.ts
 * Unit tests for test-changed script with 100% in-memory virtual filesystem mocking.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import type { PurityAuditResult } from "../../../scripts/testing/guardrails/index.ts";
import {
  main,
  parseDiffOutput,
  parseGitStatusPorcelain,
  parseUnifiedDiffHeaders,
  resolveAffectedTestFiles,
  resolveChangedTestFiles,
  run,
} from "../../../scripts/testing/test-changed.ts";

describe("test-changed script (in-memory virtual)", () => {
  let vfsSession: VirtualFSSession;
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;
  let spawnSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    vfsSession = createVirtualFSSession(new VirtualMemoryFS());
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
    vfsSession.cleanup();
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

describe("purity audit scope decoupling", () => {
  const ALL_TESTS = ["tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts"];

  function makeGitSpy(changedOutput: string): ReturnType<typeof spyOn> {
    return spyOn(childProcess, "spawnSync").mockImplementation((cmd, args) => {
      const command = String(cmd);
      const argList = Array.isArray(args) ? args.map(String) : [];
      const empty = { stdout: "", stderr: "", status: 0, pid: 1, output: [], signal: null };
      if (command === "git" && argList.includes("diff") && argList.includes("--name-only")) {
        return { ...empty, stdout: changedOutput };
      }
      return empty;
    });
  }

  function failingAudit(
    captured: string[][],
  ): (options: { readonly files?: readonly string[] | undefined }) => Promise<PurityAuditResult> {
    return async (options) => {
      captured.push([...(options.files ?? [])]);
      return {
        passed: false,
        scope: "explicit",
        requestedFiles: (options.files ?? []).length,
        scannedFiles: (options.files ?? []).length,
        vacuous: false,
        violations: [],
        terminalReport: "stub-report",
        markdownReport: "stub-report",
      };
    };
  }

  test("a critical config file still selects every test file for execution", () => {
    const selection = resolveAffectedTestFiles(["package.json"], false, "tests", ALL_TESTS);
    expect(selection.all).toBe(true);
    expect(selection.testFiles).toEqual(ALL_TESTS);
  });

  test("purity targets are the intersection of changed files and selected test files", () => {
    expect(resolveChangedTestFiles(["package.json"], ALL_TESTS)).toEqual([]);
    expect(resolveChangedTestFiles(["tsconfig.json", "bunfig.toml"], ALL_TESTS)).toEqual([]);
    expect(resolveChangedTestFiles(["package.json", "tests/b.test.ts"], ALL_TESTS)).toEqual([
      "tests/b.test.ts",
    ]);
    expect(resolveChangedTestFiles(["tests/removed.test.ts"], ALL_TESTS)).toEqual([]);
  });

  test("editing only a critical config file never invokes the purity audit", async () => {
    const captured: string[][] = [];
    const spy = makeGitSpy("package.json\n");
    try {
      const code = await run([], { auditTestPurity: failingAudit(captured) });
      expect(captured).toEqual([]);
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  test("a changed test file that fails the purity audit still blocks the run", async () => {
    const captured: string[][] = [];
    const changedTest = "tests/scripts/testing/test-mutex.test.ts";
    const spy = makeGitSpy(`package.json\n${changedTest}\n`);
    try {
      const code = await run([], { auditTestPurity: failingAudit(captured) });
      expect(captured).toEqual([[changedTest]]);
      expect(code).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
