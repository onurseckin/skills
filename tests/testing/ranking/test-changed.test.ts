import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  buildTestIndex,
  computeIsMain,
  findAllTestFiles,
  getChangedFiles,
  gitOutput,
  main,
  parseCoverageOutput,
  parseDiffOutput,
  parseGitStatusPorcelain,
  parseUnifiedDiffHeaders,
  resolveAffectedTestFiles,
  run,
} from "../../../scripts/testing/test-changed.ts";

const TEST_SCRATCH_DIR = "/virtual/coverage-scratch/test-changed-runner";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession | undefined;

function getEphemeralDir(label: string): string {
  const dir = join(TEST_SCRATCH_DIR, label);
  vfs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("test-changed script", () => {
  const scriptPath = join(process.cwd(), "scripts/testing/test-changed.ts");
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(TEST_SCRATCH_DIR, { recursive: true });
    session = createVirtualFSSession(vfs);
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = undefined;
    }
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe("in-memory diff & git parsers", () => {
    test("gitOutput returns trimmed stdout or empty on error", () => {
      expect(typeof gitOutput(["status", "--short"])).toBe("string");
      const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() => {
        throw new Error("Git failure");
      });
      try {
        expect(gitOutput(["invalid"])).toBe("");
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("parseDiffOutput parses and deduplicates filenames", () => {
      expect(parseDiffOutput("  a.ts \n\n b.ts\n  a.ts  \n")).toEqual(["a.ts", "b.ts"]);
    });

    test("parseGitStatusPorcelain parses status porcelain lines including renames", () => {
      const statusText = [
        " M src/index.ts",
        "A  src/new.ts",
        "R  old.ts -> renamed.ts",
        "?? un.ts",
      ].join("\n");
      const files = parseGitStatusPorcelain(statusText);
      expect(files).toContain("src/index.ts");
      expect(files).toContain("src/new.ts");
      expect(files).toContain("renamed.ts");
      expect(files).toContain("un.ts");
    });

    test("parseUnifiedDiffHeaders parses git headers and +++ diff paths", () => {
      const diff = ["diff --git a/src/a.ts b/src/a.ts", "--- a/src/b.ts", "+++ b/src/b.ts"].join(
        "\n",
      );
      const files = parseUnifiedDiffHeaders(diff);
      expect(files).toContain("src/a.ts");
      expect(files).toContain("src/b.ts");
    });

    test("getChangedFiles aggregates diffs with merge base and fallback to HEAD~1", () => {
      const mockGit1 = (args: string[]) => {
        if (args.includes("merge-base")) return "origin-sha";
        if (args.includes("--cached")) return "staged.ts\n";
        if (args.includes("origin-sha...HEAD")) return "branch.ts\n";
        if (args.includes("diff")) return "uncommitted.ts\n";
        return "";
      };
      expect(getChangedFiles(mockGit1)).toEqual(["uncommitted.ts", "staged.ts", "branch.ts"]);

      const mockGit2 = (args: string[]) => {
        if (args.includes("merge-base")) return "";
        if (args.includes("HEAD~1")) return "fallback.ts\n";
        return "";
      };
      expect(getChangedFiles(mockGit2)).toContain("fallback.ts");
      expect(Array.isArray(getChangedFiles())).toBe(true);
    });
  });

  describe("findAllTestFiles & buildTestIndex", () => {
    test("findAllTestFiles returns empty on missing dir and finds .test/.spec files", () => {
      expect(findAllTestFiles("/non/existent")).toEqual([]);
      const root = getEphemeralDir("find-tests");
      const sub = join(root, "sub");
      vfs.mkdirSync(sub, { recursive: true });
      vfs.writeFileSync(join(root, "a.test.ts"), "");
      vfs.writeFileSync(join(sub, "b.spec.tsx"), "");
      vfs.writeFileSync(join(root, "c.ts"), "");

      const found = findAllTestFiles(root);
      expect(found.length).toBe(2);
      expect(found).toContain(join(root, "a.test.ts"));
      expect(found).toContain(join(sub, "b.spec.tsx"));
    });

    test("buildTestIndex groups test files by normalized stem", () => {
      const idx = buildTestIndex([
        "tests/orchestrator/agents/grants.test.ts",
        "tests/orchestrator/agents/grants.spec.ts",
      ]);
      expect(idx.get("grants")?.length).toBe(2);
    });
  });

  describe("resolveAffectedTestFiles", () => {
    test("returns all: true if runAll flag or critical config file changed", () => {
      expect(resolveAffectedTestFiles(["any.ts"], true).all).toBe(true);
      expect(resolveAffectedTestFiles(["package.json"], false).all).toBe(true);
    });

    test("includes existing test files and matches source stems or override tests", () => {
      const root = getEphemeralDir("resolve-stem");
      const testFile = join(root, "feat.test.ts");
      vfs.writeFileSync(testFile, "");

      expect(resolveAffectedTestFiles([testFile], false, root).testFiles).toContain(testFile);
      expect(resolveAffectedTestFiles(["src/feat.ts"], false, root).testFiles).toContain(testFile);
      expect(resolveAffectedTestFiles(["docs/readme.md"], false, root).testFiles).toEqual([]);

      const resOverride = resolveAffectedTestFiles(["src/alpha.ts"], false, "tests/testing", [
        "tests/testing/alpha.test.ts",
        "tests/testing/beta.test.ts",
      ]);
      expect(resOverride.testFiles).toEqual(["tests/testing/alpha.test.ts"]);
    });

    test("ignores non-existent test file paths", () => {
      const root = getEphemeralDir("missing-test");
      expect(
        resolveAffectedTestFiles([join(root, "missing.test.ts")], false, root).testFiles,
      ).toEqual([]);
    });
  });

  describe("computeIsMain & parseCoverageOutput", () => {
    test("computeIsMain detects main and script paths", () => {
      expect(computeIsMain(true)).toBe(true);
      expect(computeIsMain(false, undefined)).toBe(false);
      expect(computeIsMain(false, "/repo/scripts/testing/test-changed.ts")).toBe(true);
      expect(computeIsMain(false, "/repo/scripts/testing/test-changed")).toBe(true);
      expect(computeIsMain(false, "/repo/other.ts")).toBe(false);
    });

    test("parseCoverageOutput parses coverage text accurately", () => {
      const output = [
        "scripts/test-mutex.ts | 100.00 | 98.50 | 12-14",
        "scripts/sample.ts | 80.00 | 75.00 | 5, 8",
        "invalid line",
      ].join("\n");
      const records = parseCoverageOutput(output);
      expect(records.length).toBe(2);
      expect(records[0]?.file).toBe("scripts/test-mutex.ts");
      expect(records[0]?.linesPct).toBe(100.0);
      expect(records[0]?.uncovered).toBe("12-14");
    });
  });

  describe("run() orchestration", () => {
    test("handles --help and -h flags", async () => {
      expect(await run(["--help"])).toBe(0);
      expect(await run(["-h"])).toBe(0);
    });

    test("returns 0 when no tests affected", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
        status: 0,
        pid: 1,
        output: [],
        stdout: "",
        stderr: "",
        signal: null,
      });
      try {
        expect(await run(["--changed-none"])).toBe(0);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("executes affected tests and passes coverage check", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd, args) => {
        const argList = Array.isArray(args) ? args.map(String) : [];
        if (cmd === "git") {
          return {
            stdout: argList.includes("diff")
              ? "tests/testing/locks/concurrency-lock-core.test.ts\n"
              : "",
            stderr: "",
            status: 0,
            pid: 1,
            output: [],
            signal: null,
          };
        }
        return {
          stdout: "scripts/test-mutex.ts | 100.00 | 100.00 | \n",
          stderr: "",
          status: 0,
          pid: 1,
          output: [],
          signal: null,
        };
      });
      try {
        expect(await run([])).toBe(0);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("handles coverage failure when --all flag is passed", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd) => {
        if (cmd === "git")
          return { stdout: "", stderr: "", status: 0, pid: 1, output: [], signal: null };
        return {
          stdout: "scripts/fail.ts | 80.00 | 80.00 | 1-10\n",
          stderr: "",
          status: 0,
          pid: 1,
          output: [],
          signal: null,
        };
      });
      try {
        expect(await run(["--all"])).toBe(1);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("handles test runner failure status code and exceptions in main", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd) => {
        if (cmd === "git")
          return { stdout: "", stderr: "", status: 0, pid: 1, output: [], signal: null };
        return { stdout: "", stderr: "Err", status: 2, pid: 1, output: [], signal: null };
      });
      try {
        expect(await run(["--all"])).toBe(2);
      } finally {
        spawnSpy.mockRestore();
      }

      expect(await main(["--help"])).toBe(0);
      const crashSpy = spyOn(childProcess, "spawnSync").mockImplementation(() => {
        throw new Error("Crash");
      });
      try {
        expect(await main(["--all"])).toBe(1);
      } finally {
        crashSpy.mockRestore();
      }
    });

    test("runs standalone script via main", async () => {
      expect(await main(["--help"])).toBe(0);
    });
  });
});
