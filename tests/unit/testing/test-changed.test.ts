import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as childProcess from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeIsMain,
  findAllTestFiles,
  getChangedFiles,
  gitOutput,
  main,
  parseCoverageOutput,
  resolveAffectedTestFiles,
  run,
} from "../../../scripts/testing/test-changed.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("test-changed script", () => {
  const scriptPath = join(process.cwd(), "scripts/testing/test-changed.ts");
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe("gitOutput", () => {
    test("returns stdout trimmed when git command succeeds", () => {
      const output = gitOutput(["status", "--short"]);
      expect(typeof output).toBe("string");
    });

    test("returns empty string when command throws or fails", () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() => {
        throw new Error("Git spawn failure");
      });
      try {
        expect(gitOutput(["invalid"])).toBe("");
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  describe("getChangedFiles", () => {
    test("runs with default gitOutput function", () => {
      const files = getChangedFiles();
      expect(Array.isArray(files)).toBe(true);
    });

    test("aggregates uncommitted, staged, and branch diff files with merge base", () => {
      const mockGit = (args: string[]) => {
        if (args.includes("merge-base")) return "origin-main-sha";
        if (args.includes("diff") && args.includes("--cached")) return "staged.ts\n";
        if (args.includes("diff") && args.includes("origin-main-sha...HEAD")) return "branch.ts\n";
        if (args.includes("diff")) return "uncommitted.ts\n";
        return "";
      };

      const files = getChangedFiles(mockGit);
      expect(files).toContain("uncommitted.ts");
      expect(files).toContain("staged.ts");
      expect(files).toContain("branch.ts");
    });

    test("falls back to HEAD~1 when merge-base returns empty", () => {
      const mockGit = (args: string[]) => {
        if (args.includes("merge-base")) return "";
        if (args.includes("HEAD~1")) return "fallback-commit.ts\n";
        return "";
      };

      const files = getChangedFiles(mockGit);
      expect(files).toContain("fallback-commit.ts");
    });
  });

  describe("findAllTestFiles", () => {
    test("returns empty list if directory does not exist", () => {
      expect(findAllTestFiles("/non/existent/path")).toEqual([]);
    });

    test("recursively finds .test.ts and .spec.ts files", () => {
      const root = scratchRoot(import.meta.path, "find-all-tests");
      const sub = join(root, "nested");
      mkdirSync(sub, { recursive: true });

      writeFileSync(join(root, "a.test.ts"), "", "utf-8");
      writeFileSync(join(sub, "b.spec.ts"), "", "utf-8");
      writeFileSync(join(root, "c.ts"), "", "utf-8");

      const found = findAllTestFiles(root);
      expect(found.length).toBe(2);
      expect(found).toContain(join(root, "a.test.ts"));
      expect(found).toContain(join(sub, "b.spec.ts"));
    });
  });

  describe("resolveAffectedTestFiles", () => {
    test("returns all: true if runAll flag is true", () => {
      const res = resolveAffectedTestFiles(["any.ts"], true);
      expect(res.all).toBe(true);
      expect(res.testFiles).toEqual([]);
    });

    test("returns all: true if a critical global file changed", () => {
      const res = resolveAffectedTestFiles(["package.json"], false);
      expect(res.all).toBe(true);
      expect(res.testFiles).toEqual([]);
    });

    test("includes changed test files directly if they exist", () => {
      const root = scratchRoot(import.meta.path, "resolve-test-files");
      const testFile = join(root, "sample.test.ts");
      writeFileSync(testFile, "", "utf-8");

      const res = resolveAffectedTestFiles([testFile], false, root);
      expect(res.all).toBe(false);
      expect(res.testFiles).toContain(testFile);
    });

    test("matches source files to test files with matching stems including tsx", () => {
      const root = scratchRoot(import.meta.path, "resolve-source-stem");
      const testFile = join(root, "my-feature.test.ts");
      writeFileSync(testFile, "", "utf-8");

      const resTs = resolveAffectedTestFiles(["src/my-feature.ts"], false, root);
      expect(resTs.all).toBe(false);
      expect(resTs.testFiles).toContain(testFile);

      const resTsx = resolveAffectedTestFiles(["src/my-feature.tsx"], false, root);
      expect(resTsx.all).toBe(false);
      expect(resTsx.testFiles).toContain(testFile);

      const resOther = resolveAffectedTestFiles(["docs/readme.md"], false, root);
      expect(resOther.all).toBe(false);
      expect(resOther.testFiles).toEqual([]);
    });

    test("ignores non-existent test file paths", () => {
      const root = scratchRoot(import.meta.path, "resolve-missing-test-file");
      const missingTest = join(root, "ghost.test.ts");

      const res = resolveAffectedTestFiles([missingTest], false, root);
      expect(res.all).toBe(false);
      expect(res.testFiles).toEqual([]);
    });
  });

  describe("computeIsMain", () => {
    test("evaluates main flag and entry argument correctly", () => {
      expect(computeIsMain(true)).toBe(true);
      expect(computeIsMain(false, undefined)).toBe(false);
      expect(computeIsMain(false, "/repo/scripts/testing/test-changed.ts")).toBe(true);
      expect(computeIsMain(false, "/repo/scripts/testing/test-changed")).toBe(true);
      expect(computeIsMain(false, "/repo/scripts/sync/index.ts")).toBe(false);
    });
  });

  describe("parseCoverageOutput", () => {
    test("parses lines, statement percentages, and uncovered lines correctly", () => {
      const output = [
        "scripts/testing/test-mutex.ts | 100.00 | 98.50 | 12-14",
        "scripts/testing/sample.ts | 80.00 | 75.00 | 5, 8",
        "not a coverage line",
      ].join("\n");

      const records = parseCoverageOutput(output);
      expect(records.length).toBe(2);
      expect(records[0]!.file).toBe("scripts/testing/test-mutex.ts");
      expect(records[0]!.linesPct).toBe(100.0);
      expect(records[0]!.stmtsPct).toBe(98.5);
      expect(records[0]!.uncovered).toBe("12-14");
    });
  });

  describe("run() orchestration", () => {
    test("handles --help flag and returns 0", async () => {
      const code = await run(["--help"]);
      expect(code).toBe(0);
    });

    test("handles -h flag and returns 0", async () => {
      const code = await run(["-h"]);
      expect(code).toBe(0);
    });

    test("returns 0 when no test files are affected", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
        status: 0,
        pid: 1234,
        output: [],
        stdout: "",
        stderr: "",
        signal: null,
      });

      try {
        const code = await run(["--changed-none"]);
        expect(code).toBe(0);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("executes targeted affected test files and passes", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd, args) => {
        const argList = Array.isArray(args) ? args.map(String) : [];
        if (cmd === "git") {
          if (argList.includes("diff") && argList.includes("--name-only")) {
            return {
              stdout: "tests/unit/testing/concurrency-lock.test.ts\n",
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
        return {
          stdout: "scripts/testing/test-mutex.ts | 100.00 | 100.00 | \n",
          stderr: "Test runner log",
          status: 0,
          pid: 1234,
          output: [],
          signal: null,
        };
      });

      try {
        const code = await run([]);
        expect(code).toBe(0);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("executes all tests when --all flag is passed and handles coverage failure", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd) => {
        if (cmd === "git") {
          return {
            stdout: "",
            stderr: "",
            status: 0,
            pid: 1234,
            output: [],
            signal: null,
          };
        }
        return {
          stdout: "scripts/testing/failing.ts | 80.00 | 80.00 | 1-10\n",
          stderr: "Errors",
          status: 0,
          pid: 1234,
          output: [],
          signal: null,
        };
      });

      try {
        const code = await run(["--all"]);
        expect(code).toBe(1);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("handles bun test execution failure status", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd) => {
        if (cmd === "git") {
          return {
            stdout: "",
            stderr: "",
            status: 0,
            pid: 1234,
            output: [],
            signal: null,
          };
        }
        return {
          stdout: "Test failure output",
          stderr: "Error details",
          status: 2,
          pid: 1234,
          output: [],
          signal: null,
        };
      });

      try {
        const code = await run(["--all"]);
        expect(code).toBe(2);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("main() executes run and returns exit code", async () => {
      const code = await main(["--help"]);
      expect(code).toBe(0);
    });

    test("main() handles execution exceptions gracefully and returns 1", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() => {
        throw new Error("Unexpected crash");
      });

      try {
        const code = await main(["--all"]);
        expect(code).toBe(1);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("runs standalone script via spawnSync", () => {
      const result = childProcess.spawnSync("bun", [scriptPath, "--help"], {
        encoding: "utf-8",
        cwd: process.cwd(),
        timeout: 30000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: bun scripts/testing/test-changed.ts");
    });
  });
});
