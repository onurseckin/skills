import { describe, expect, test, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import {
  checkCodeRelevantDrift,
  defaultGitExecutor,
  getRawPaths,
  isArchive,
  isExecutablePlan,
  isGitHygiene,
  isSourceCode,
  normalizePath,
  optimizeCheckDriftCommand,
  setProcessExitCodeIfHarness,
} from "../../../../olt/scripts/src/cli/commands/optimize/drift.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("optimize:check-drift Engine (W1-T6)", () => {
  describe("Path Normalization & Classification Helpers", () => {
    test("normalizePath cleans leading slashes, dot-slashes, and backslashes", () => {
      expect(normalizePath("./src/foo.ts")).toBe("src/foo.ts");
      expect(normalizePath("/src/foo.ts")).toBe("src/foo.ts");
      expect(normalizePath(".\\docs\\planning\\cache\\PLAN.md")).toBe(
        "docs/planning/cache/PLAN.md",
      );
      expect(normalizePath("   olt/scripts/harness.ts   ")).toBe("olt/scripts/harness.ts");
      expect(normalizePath("")).toBe("");
    });

    test("isArchive identifies archived docs and plans", () => {
      expect(isArchive("docs/archive")).toBe(true);
      expect(isArchive("docs/archive/completed-plans/cache/PLAN.md")).toBe(true);
      expect(isArchive("docs/archive/notes.md")).toBe(true);
      expect(isArchive("docs/planning/cache/PLAN.md")).toBe(false);
      expect(isArchive("src/archive/foo.ts")).toBe(false);
    });

    test("isGitHygiene identifies git metadata files", () => {
      expect(isGitHygiene(".gitignore")).toBe(true);
      expect(isGitHygiene("sub/.gitignore")).toBe(true);
      expect(isGitHygiene(".gitattributes")).toBe(true);
      expect(isGitHygiene(".gitmodules")).toBe(true);
      expect(isGitHygiene(".gitkeep")).toBe(true);
      expect(isGitHygiene(".mailmap")).toBe(true);
      expect(isGitHygiene(".git/config")).toBe(true);
      expect(isGitHygiene("src/git.ts")).toBe(false);
    });

    test("isExecutablePlan matches new plans in docs/planning", () => {
      expect(isExecutablePlan("docs/planning/cache/PLAN.md")).toBe(true);
      expect(isExecutablePlan("docs/planning/optimizer-orchestrator/PLAN.md")).toBe(true);
      expect(isExecutablePlan("docs/planning/PLAN.md")).toBe(true);
      // Non-PLAN.md notes are NOT executable plans
      expect(isExecutablePlan("docs/planning/notes.md")).toBe(false);
      expect(isExecutablePlan("docs/planning/cache/notes.md")).toBe(false);
      expect(isExecutablePlan("docs/planning/cache/scratch.md")).toBe(false);
      // Archived plans are NOT new executable plans
      expect(isExecutablePlan("docs/archive/completed-plans/cache/PLAN.md")).toBe(false);
    });

    test("isSourceCode identifies source files and filters doc/git hygiene", () => {
      expect(isSourceCode("src/foo.ts")).toBe(true);
      expect(isSourceCode("src/nested/bar.js")).toBe(true);
      expect(isSourceCode("olt/scripts/harness.ts")).toBe(true);
      expect(isSourceCode("package.json")).toBe(true);
      expect(isSourceCode("bunfig.toml")).toBe(true);
      expect(isSourceCode("tsconfig.json")).toBe(true);
      expect(isSourceCode("tests/unit/test.ts")).toBe(true);
      // Excluded from source code
      expect(isSourceCode("README.md")).toBe(false);
      expect(isSourceCode("LICENSE")).toBe(false);
      expect(isSourceCode(".gitignore")).toBe(false);
      expect(isSourceCode("docs/archive/foo.ts")).toBe(false);
      expect(isSourceCode("docs/planning/cache/PLAN.md")).toBe(false);
    });
  });

  describe("checkCodeRelevantDrift (Pure In-Memory)", () => {
    test("README.md modification only -> Drift: 0 (Quiescent Ignored), exit status clean", () => {
      const result = checkCodeRelevantDrift({ paths: ["README.md"] });
      expect(result.drift).toBe(0);
      expect(result.status).toBe("quiescent_ignored");
      expect(result.message).toBe("Drift: 0 (Quiescent Ignored)");
      expect(result.ignoredPaths).toEqual(["README.md"]);
      expect(result.codeRelevantPaths).toEqual([]);
      expect(result.hasNewPlan).toBe(false);
      expect(result.hasCodeMutation).toBe(false);
    });

    test("New plan docs/planning/cache/PLAN.md -> Drift: 1 (New Plan Detected), flags drift", () => {
      const result = checkCodeRelevantDrift({
        paths: ["docs/planning/cache/PLAN.md"],
      });
      expect(result.drift).toBe(1);
      expect(result.status).toBe("drift_detected");
      expect(result.message).toBe("Drift: 1 (New Plan Detected)");
      expect(result.codeRelevantPaths).toEqual(["docs/planning/cache/PLAN.md"]);
      expect(result.ignoredPaths).toEqual([]);
      expect(result.hasNewPlan).toBe(true);
      expect(result.hasCodeMutation).toBe(false);
    });

    test("Source file src/foo.ts changed -> Drift: 1 (Code Mutated), flags drift", () => {
      const result = checkCodeRelevantDrift({ paths: ["src/foo.ts"] });
      expect(result.drift).toBe(1);
      expect(result.status).toBe("drift_detected");
      expect(result.message).toBe("Drift: 1 (Code Mutated)");
      expect(result.codeRelevantPaths).toEqual(["src/foo.ts"]);
      expect(result.ignoredPaths).toEqual([]);
      expect(result.hasNewPlan).toBe(false);
      expect(result.hasCodeMutation).toBe(true);
    });

    test("Ignores all quiescent hygiene and non-plan planning notes", () => {
      const result = checkCodeRelevantDrift({
        paths: [
          "README.md",
          "LICENSE",
          ".gitignore",
          ".gitattributes",
          "docs/archive/completed-plans/old/PLAN.md",
          "docs/planning/notes.md",
          "docs/planning/cache/scratch.md",
          "docs/guide.md",
        ],
      });
      expect(result.drift).toBe(0);
      expect(result.status).toBe("quiescent_ignored");
      expect(result.message).toBe("Drift: 0 (Quiescent Ignored)");
      expect(result.codeRelevantPaths).toHaveLength(0);
      expect(result.ignoredPaths).toHaveLength(8);
    });

    test("Detects multiple code files and builds Code Mutated message", () => {
      const result = checkCodeRelevantDrift({
        paths: ["package.json", "bunfig.toml", "olt/scripts/harness.ts", "README.md"],
      });
      expect(result.drift).toBe(3);
      expect(result.status).toBe("drift_detected");
      expect(result.message).toBe("Drift: 3 (Code Mutated)");
      expect(result.hasCodeMutation).toBe(true);
      expect(result.codeRelevantPaths).toEqual([
        "bunfig.toml",
        "olt/scripts/harness.ts",
        "package.json",
      ]);
      expect(result.ignoredPaths).toEqual(["README.md"]);
    });

    test("Combines new plan and source file mutations cleanly", () => {
      const result = checkCodeRelevantDrift({
        paths: ["docs/planning/cache/PLAN.md", "src/foo.ts"],
      });
      expect(result.drift).toBe(2);
      expect(result.status).toBe("drift_detected");
      expect(result.message).toBe("Drift: 2 (Code Mutated)");
      expect(result.hasNewPlan).toBe(true);
      expect(result.hasCodeMutation).toBe(true);
    });

    test("Handles empty paths array cleanly", () => {
      const result = checkCodeRelevantDrift({ paths: [] });
      expect(result.drift).toBe(0);
      expect(result.status).toBe("quiescent_ignored");
      expect(result.message).toBe("Drift: 0 (Quiescent Ignored)");
      expect(result.allPaths).toHaveLength(0);
    });

    test("Uses mock gitExecutor when paths is omitted", () => {
      const mockGit = (args: readonly string[]): string => {
        if (args[0] === "diff") {
          return "src/engine.ts\nREADME.md\n";
        }
        if (args[0] === "ls-files") {
          return "docs/planning/cache/PLAN.md\n";
        }
        return "";
      };

      const result = checkCodeRelevantDrift({ gitExecutor: mockGit });
      expect(result.drift).toBe(2);
      expect(result.status).toBe("drift_detected");
      expect(result.hasNewPlan).toBe(true);
      expect(result.hasCodeMutation).toBe(true);
      expect(result.codeRelevantPaths).toEqual(["docs/planning/cache/PLAN.md", "src/engine.ts"]);
      expect(result.ignoredPaths).toEqual(["README.md"]);
    });

    test("getRawPaths gracefully handles exceptions in ls-files executor", () => {
      const mockGit = (args: readonly string[]): string => {
        if (args[0] === "diff") return "src/foo.ts\n";
        throw new Error("Simulated git failure");
      };
      const paths = getRawPaths({ gitExecutor: mockGit });
      expect(paths).toEqual(["src/foo.ts"]);
    });
  });

  describe("defaultGitExecutor & In-Memory Spies", () => {
    test("defaultGitExecutor returns stdout when spawnSync succeeds", () => {
      const spy = spyOn(childProcess, "spawnSync").mockReturnValue({
        pid: 1,
        output: [],
        stdout: "src/file1.ts\n",
        stderr: "",
        status: 0,
        signal: null,
      });

      const out = defaultGitExecutor(["diff", "--name-only", "HEAD~1"]);
      expect(out).toBe("src/file1.ts\n");
      spy.mockRestore();
    });

    test("defaultGitExecutor throws INVALID_STATE when spawnSync returns error", () => {
      const spy = spyOn(childProcess, "spawnSync").mockReturnValue({
        pid: 1,
        output: [],
        stdout: "",
        stderr: "",
        status: null,
        signal: null,
        error: new Error("spawn ENOENT"),
      });

      expect(() => defaultGitExecutor(["status"])).toThrow(HarnessError);
      spy.mockRestore();
    });

    test("defaultGitExecutor throws INVALID_ARGUMENT when exit status is non-zero", () => {
      const spy = spyOn(childProcess, "spawnSync").mockReturnValue({
        pid: 1,
        output: [],
        stdout: "",
        stderr: "fatal: not a git repo",
        status: 128,
        signal: null,
      });

      expect(() => defaultGitExecutor(["status"])).toThrow(HarnessError);
      spy.mockRestore();
    });
  });

  describe("Harness Process Exit Code Interlock", () => {
    test("setProcessExitCodeIfHarness updates process.exitCode only when invoked via harness", () => {
      const original = process.exitCode;
      try {
        setProcessExitCodeIfHarness(1, "/usr/local/bin/other-script.ts");
        expect(process.exitCode).toBe(original);

        setProcessExitCodeIfHarness(1, "/path/to/olt/scripts/harness.ts");
        expect(process.exitCode).toBe(1);

        setProcessExitCodeIfHarness(0, "/path/to/olt/scripts/harness.ts");
        expect(process.exitCode).toBe(0);
      } finally {
        process.exitCode = 0;
      }
    });
  });

  describe("optimizeCheckDriftCommand CLI Handler", () => {
    test("README.md only returns ok: true, drift: 0, quiescent_ignored, exit_code: 0", async () => {
      const res = await optimizeCheckDriftCommand({ paths: "README.md" });
      expect(res["ok"]).toBe(true);
      expect(res["drift"]).toBe(0);
      expect(res["status"]).toBe("quiescent_ignored");
      expect(res["message"]).toBe("Drift: 0 (Quiescent Ignored)");
      expect(res["exit_code"]).toBe(0);
      expect(String(res["markdown"])).toContain("Drift: 0 (Quiescent Ignored)");
    });

    test("New plan docs/planning/cache/PLAN.md returns drift: 1, drift_detected, exit_code: 1", async () => {
      const res = await optimizeCheckDriftCommand({
        paths: "docs/planning/cache/PLAN.md",
      });
      expect(res["ok"]).toBe(true);
      expect(res["drift"]).toBe(1);
      expect(res["status"]).toBe("drift_detected");
      expect(res["message"]).toBe("Drift: 1 (New Plan Detected)");
      expect(res["exit_code"]).toBe(1);
      expect(res["has_new_plan"]).toBe(true);
    });

    test("Source file src/foo.ts returns drift: 1, drift_detected, exit_code: 1", async () => {
      const res = await optimizeCheckDriftCommand({ paths: "src/foo.ts" });
      expect(res["ok"]).toBe(true);
      expect(res["drift"]).toBe(1);
      expect(res["status"]).toBe("drift_detected");
      expect(res["message"]).toBe("Drift: 1 (Code Mutated)");
      expect(res["exit_code"]).toBe(1);
      expect(res["has_code_mutation"]).toBe(true);
    });

    test("Supports comma-separated paths flag string", async () => {
      const res = await optimizeCheckDriftCommand({
        paths: "README.md, src/bar.ts, LICENSE",
      });
      expect(res["drift"]).toBe(1);
      expect(res["status"]).toBe("drift_detected");
      expect(res["message"]).toBe("Drift: 1 (Code Mutated)");
      expect(res["exit_code"]).toBe(1);
    });

    test("Supports array of paths in flags", async () => {
      const res = await optimizeCheckDriftCommand({
        paths: ["README.md", "docs/planning/cache/PLAN.md"],
      });
      expect(res["drift"]).toBe(1);
      expect(res["message"]).toBe("Drift: 1 (New Plan Detected)");
    });

    test("Supports --json flag", async () => {
      const res = await optimizeCheckDriftCommand({
        paths: "README.md",
        json: true,
      });
      expect(res["json"]).toBe(true);
      expect(res["ok"]).toBe(true);
    });

    test("Strict mode: clean paths do not throw", async () => {
      const res = await optimizeCheckDriftCommand({
        paths: "README.md",
        strict: true,
      });
      expect(res["ok"]).toBe(true);
      expect(res["drift"]).toBe(0);
    });

    test("Strict mode: code drift throws HarnessError with exitCode 1", async () => {
      let caught: unknown;
      try {
        await optimizeCheckDriftCommand({
          paths: "src/foo.ts",
          strict: true,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HarnessError);
      const harnessErr = caught as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toBe("Drift: 1 (Code Mutated)");
      expect(harnessErr.exitCode).toBe(1);
    });

    test("Strict mode: new plan drift throws HarnessError with exitCode 1", async () => {
      let caught: unknown;
      try {
        await optimizeCheckDriftCommand({
          paths: "docs/planning/cache/PLAN.md",
          strict: true,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HarnessError);
      const harnessErr = caught as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toBe("Drift: 1 (New Plan Detected)");
      expect(harnessErr.exitCode).toBe(1);
    });

    test("Throws HarnessError on unknown flag", async () => {
      expect(
        optimizeCheckDriftCommand({
          paths: "README.md",
          bogus: true,
        }),
      ).rejects.toThrow(/unknown option/);
    });
  });
});
