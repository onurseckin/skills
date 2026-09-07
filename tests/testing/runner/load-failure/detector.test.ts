import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import * as testMutex from "../../../../scripts/testing/index.ts";
import {
  countReportedUnhandledErrors,
  detectSuiteLoadFailures,
  formatSuiteLoadFailureReport,
  isModuleLoadErrorMessage,
} from "../../../../scripts/testing/runner/index.ts";
import { executeStreamingRunner } from "../../../../scripts/testing/runner/streaming-runner.ts";
import { executeTestRunner } from "../../../../scripts/testing/test-runner.ts";

const BROKEN_FIXTURE = "./tests/testing/runner/load-failure/broken-load-fixture.ts";

const UNLOADABLE_SUITE_OUTPUT = [
  "bun test v1.4.0 (34cbb9a40)",
  "",
  "tests/mind/eval/auditing/charter-auditing.test.ts:",
  "",
  "# Unhandled error between tests",
  "-------------------------------",
  "SyntaxError: Export named 'parseCharter' not found in module '/repo/olt/index.ts'.",
  "-------------------------------",
  "",
  "",
  " 0 pass",
  " 1 fail",
  " 1 error",
  "Ran 1 test across 1 file. [16.00ms]",
].join("\n");

const EMPTY_SUITE_OUTPUT = [
  "bun test v1.4.0 (34cbb9a40)",
  "",
  " 0 pass",
  " 0 fail",
  "Ran 0 tests across 1 file. [35.00ms]",
].join("\n");

describe("module load failure detection", () => {
  test("names the unloadable file and its underlying error", () => {
    const failures = detectSuiteLoadFailures(UNLOADABLE_SUITE_OUTPUT);
    expect(failures.length).toBe(1);
    expect(failures[0]?.file).toBe("tests/mind/eval/auditing/charter-auditing.test.ts");
    expect(failures[0]?.message).toContain("Export named 'parseCharter' not found");
    expect(failures[0]?.isModuleLoadFailure).toBe(true);
  });

  test("a file that legitimately registers zero tests is not a load failure", () => {
    expect(detectSuiteLoadFailures(EMPTY_SUITE_OUTPUT)).toEqual([]);
    expect(countReportedUnhandledErrors(EMPTY_SUITE_OUTPUT)).toBe(0);
  });

  test("classifies load-time errors apart from ordinary runtime errors", () => {
    expect(isModuleLoadErrorMessage("SyntaxError: Unexpected token")).toBe(true);
    expect(isModuleLoadErrorMessage("error: Cannot find module './nope.ts'")).toBe(true);
    expect(isModuleLoadErrorMessage("Error: connection refused")).toBe(false);
  });

  test("only counts the bun summary error line, never report text that resembles it", () => {
    expect(countReportedUnhandledErrors(UNLOADABLE_SUITE_OUTPUT)).toBe(1);
    expect(countReportedUnhandledErrors("Findings summary\n3 errors\nDone")).toBe(0);
  });

  test("reports an unattributed error when bun counts more errors than blocks parsed", () => {
    const failures = detectSuiteLoadFailures(" 0 pass\n 1 fail\n 2 errors\n");
    expect(failures.length).toBe(1);
    expect(failures[0]?.file).toBe("<unattributed test file>");
  });

  test("the rendered report is loud and names every offending file", () => {
    const report = formatSuiteLoadFailureReport(detectSuiteLoadFailures(UNLOADABLE_SUITE_OUTPUT));
    expect(report).toContain("MODULE LOAD FAILURE");
    expect(report).toContain("tests/mind/eval/auditing/charter-auditing.test.ts");
    expect(report).toContain("Export named 'parseCharter' not found");
    expect(report).toContain("registers ZERO tests");
  });
});

describe("runner integration for unloadable test files", () => {
  let lockSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    lockSpy = spyOn(testMutex, "acquireTestLock").mockReturnValue(() => {});
  });

  afterEach(() => {
    lockSpy.mockRestore();
  });

  test("streaming runner fails the run even when bun exits zero", async () => {
    const mockStdout = new EventEmitter();
    const mockStderr = new EventEmitter();
    const mockChild = Object.assign(new EventEmitter(), {
      stdout: mockStdout,
      stderr: mockStderr,
      exitCode: 0,
    });

    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
      setTimeout(() => {
        mockStderr.emit("data", Buffer.from(UNLOADABLE_SUITE_OUTPUT));
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
      const result = await executeStreamingRunner(["tests/some.test.ts"], {
        interactive: false,
        stdout: customStdout,
      });

      expect(result.exitCode).toBe(1);
      expect(result.loadFailures?.length).toBe(1);
      const rendered = written.join("");
      expect(rendered).toContain("MODULE LOAD FAILURE");
      expect(rendered).toContain("tests/mind/eval/auditing/charter-auditing.test.ts");
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("the synchronous runner exits non-zero and names a fixture that cannot be imported", () => {
    const reported: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      reported.push(args.map((entry) => String(entry)).join(" "));
    });
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const code = executeTestRunner(["--no-coverage", BROKEN_FIXTURE]);
      const rendered = reported.join("\n");
      expect(code).toBe(1);
      expect(rendered).toContain("MODULE LOAD FAILURE");
      expect(rendered).toContain("broken-load-fixture.ts");
      expect(rendered).toContain("Cannot find module");
    } finally {
      stderrSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }, 60000);
});
