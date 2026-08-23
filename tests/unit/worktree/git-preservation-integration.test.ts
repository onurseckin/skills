import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNonDestructiveWriteScope,
  assertZeroDestructiveGit,
  buildInclusiveStageArgs,
  filterPathsToScope,
  isDestructiveGitCommand,
  isPathInWriteScope,
  partitionObservedChanges,
} from "../../../olt/scripts/src/worktree/zero-destructive-policy.ts";
import {
  createGitRunner,
  git,
  worktreeGitEnvironment,
  type GitRunner,
  type GitSpawn,
} from "../../../olt/scripts/src/workflow/worktree/git.ts";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";

describe("P55 End-to-End Zero-Destructive Git Invariant & User Edits Preservation", () => {
  function createTrackingSpawn(recordedCalls: Array<{ cmd: string; args: string[] }>): GitSpawn {
    return (command, args, _options) => {
      recordedCalls.push({ cmd: command, args: [...args] });
      return {
        status: 0,
        stdout: "mocked success output\n",
        stderr: "",
      };
    };
  }

  describe("Destructive Git Invariant Interception Matrix", () => {
    const destructiveCommands: Array<{ name: string; args: string[] }> = [
      { name: "git checkout -- file.ts", args: ["checkout", "--", "file.ts"] },
      { name: "git checkout -- .", args: ["checkout", "--", "."] },
      { name: "git checkout .", args: ["checkout", "."] },
      { name: "git checkout -f", args: ["checkout", "-f"] },
      { name: "git checkout --force", args: ["checkout", "--force"] },
      { name: "git checkout -f main", args: ["checkout", "-f", "main"] },
      { name: "git reset --hard", args: ["reset", "--hard"] },
      { name: "git reset -hard", args: ["reset", "-hard"] },
      { name: "git reset --merge", args: ["reset", "--merge"] },
      { name: "git reset --keep", args: ["reset", "--keep"] },
      { name: "git reset --hard HEAD~1", args: ["reset", "--hard", "HEAD~1"] },
      { name: "git reset --hard origin/main", args: ["reset", "--hard", "origin/main"] },
      { name: "git clean", args: ["clean"] },
      { name: "git clean -f", args: ["clean", "-f"] },
      { name: "git clean -fd", args: ["clean", "-fd"] },
      { name: "git clean -fx", args: ["clean", "-fx"] },
      { name: "git clean -df", args: ["clean", "-df"] },
      { name: "git clean -fxd", args: ["clean", "-fxd"] },
      { name: "git restore .", args: ["restore", "."] },
      { name: "git restore file.ts", args: ["restore", "file.ts"] },
      { name: "git restore --worktree src", args: ["restore", "--worktree", "src"] },
      {
        name: "git restore --staged --worktree .",
        args: ["restore", "--staged", "--worktree", "."],
      },
      { name: "git stash drop", args: ["stash", "drop"] },
      { name: "git stash clear", args: ["stash", "clear"] },
      { name: "git stash push --hard", args: ["stash", "push", "--hard"] },
    ];

    for (const testCase of destructiveCommands) {
      test(`strictly blocks ${testCase.name} via isDestructiveGitCommand, assertZeroDestructiveGit, and createGitRunner`, () => {
        // 1. isDestructiveGitCommand
        const check = isDestructiveGitCommand(testCase.args);
        expect(check.destructive).toBe(true);
        expect(check.reason).toBeDefined();

        // 2. assertZeroDestructiveGit
        expect(() => assertZeroDestructiveGit(testCase.args)).toThrow(HarnessError);
        try {
          assertZeroDestructiveGit(testCase.args);
        } catch (err) {
          expect(err instanceof HarnessError).toBe(true);
          const harnessErr = err as HarnessError;
          expect(harnessErr.code).toBe("INTEGRITY");
          expect(harnessErr.message).toContain("Zero-Destructive Git Invariant");
        }

        // 3. createGitRunner interception (spawn is never called)
        const recorded: Array<{ cmd: string; args: string[] }> = [];
        const runner = createGitRunner(createTrackingSpawn(recorded));
        expect(() => runner("/repo", testCase.args)).toThrow(HarnessError);
        expect(recorded).toHaveLength(0); // Proves spawnSync was never called
      });
    }
  });

  describe("Safe Git Operations Pass-Through Matrix", () => {
    const safeCommands: Array<{ name: string; args: string[] }> = [
      { name: "git status", args: ["status"] },
      { name: "git status --porcelain", args: ["status", "--porcelain"] },
      { name: "git status --short", args: ["status", "--short"] },
      { name: "git diff", args: ["diff"] },
      { name: "git diff --cached", args: ["diff", "--cached"] },
      { name: "git diff --name-only", args: ["diff", "--name-only"] },
      { name: "git add -- src/index.ts", args: ["add", "--", "src/index.ts"] },
      { name: "git add -- :(glob)tests/**/*.ts", args: ["add", "--", ":(glob)tests/**/*.ts"] },
      { name: "git commit -m message", args: ["commit", "-m", "feat: safe commit"] },
      { name: "git checkout feature-branch", args: ["checkout", "feature-branch"] },
      { name: "git checkout -b new-branch", args: ["checkout", "-b", "new-branch"] },
      { name: "git reset HEAD file.ts", args: ["reset", "HEAD", "file.ts"] },
      { name: "git reset --soft HEAD~1", args: ["reset", "--soft", "HEAD~1"] },
      {
        name: "git worktree add -b b /path sha",
        args: ["worktree", "add", "-b", "b", "/path", "sha"],
      },
      {
        name: "git worktree remove --force /path",
        args: ["worktree", "remove", "--force", "/path"],
      },
      { name: "git worktree list --porcelain", args: ["worktree", "list", "--porcelain"] },
      { name: "git branch -D temp-branch", args: ["branch", "-D", "temp-branch"] },
      { name: "git rev-parse HEAD", args: ["rev-parse", "HEAD"] },
      { name: "git rev-parse --show-toplevel", args: ["rev-parse", "--show-toplevel"] },
      { name: "git symbolic-ref --short -q HEAD", args: ["symbolic-ref", "--short", "-q", "HEAD"] },
    ];

    for (const testCase of safeCommands) {
      test(`safely permits ${testCase.name} through runner without modification`, () => {
        const check = isDestructiveGitCommand(testCase.args);
        expect(check.destructive).toBe(false);

        expect(() => assertZeroDestructiveGit(testCase.args)).not.toThrow();

        const recorded: Array<{ cmd: string; args: string[] }> = [];
        const runner = createGitRunner(createTrackingSpawn(recorded));
        const result = runner("/repo", testCase.args);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe("mocked success output\n");
        expect(recorded).toHaveLength(1);
        expect(recorded[0].cmd).toBe("git");
        expect(recorded[0].args).toEqual(testCase.args);
      });
    }
  });

  describe("Write Scope Confinement and Unfamiliar User Edits Preservation", () => {
    test("isPathInWriteScope correctly evaluates exact files, directory trees, and wildcards", () => {
      const writeScope = [
        "src/authority",
        "tests/unit/worktree/**/*.ts",
        "docs/*.md",
        "config.json",
      ];

      // Positive matches
      expect(isPathInWriteScope("src/authority/thread-identifier.ts", writeScope)).toBe(true);
      expect(isPathInWriteScope("src/authority/sub/deep/module.ts", writeScope)).toBe(true);
      expect(isPathInWriteScope("tests/unit/worktree/git-preservation.test.ts", writeScope)).toBe(
        true,
      );
      expect(isPathInWriteScope("tests/unit/worktree/nested/deep.test.ts", writeScope)).toBe(true);
      expect(isPathInWriteScope("docs/guide.md", writeScope)).toBe(true);
      expect(isPathInWriteScope("config.json", writeScope)).toBe(true);

      // Negative matches (unfamiliar / user WIP files)
      expect(isPathInWriteScope("src/unrelated/feature.ts", writeScope)).toBe(false);
      expect(isPathInWriteScope("tests/unit/other/test.ts", writeScope)).toBe(false);
      expect(isPathInWriteScope("docs/nested/deep.md", writeScope)).toBe(false); // single star docs/*.md does not match nested
      expect(isPathInWriteScope("other-config.json", writeScope)).toBe(false);
      expect(isPathInWriteScope(".env.local", writeScope)).toBe(false);
    });

    test("filterPathsToScope filters arbitrary file lists strictly to assigned write scope", () => {
      const scope = ["src/workflow/worktree", "tests/unit/worktree"];
      const observedFiles = [
        "src/workflow/worktree/git.ts",
        "src/workflow/worktree/git-ops.ts",
        "src/other-feature/wip.ts",
        "tests/unit/worktree/git-preservation.test.ts",
        "user-notes.txt",
      ];

      const scopedOnly = filterPathsToScope(observedFiles, scope);
      expect(scopedOnly).toEqual([
        "src/workflow/worktree/git.ts",
        "src/workflow/worktree/git-ops.ts",
        "tests/unit/worktree/git-preservation.test.ts",
      ]);
    });

    test("assertNonDestructiveWriteScope prevents agent from touching out-of-scope files", () => {
      const scope = ["src/authority"];
      const agentId = "implementer_task-p54";

      // Valid scoped changes
      expect(() =>
        assertNonDestructiveWriteScope(
          ["src/authority/thread-identifier.ts", "src/authority/manifest-parser.ts"],
          scope,
          agentId,
        ),
      ).not.toThrow();

      // Out-of-scope violation
      expect(() =>
        assertNonDestructiveWriteScope(
          ["src/authority/thread-identifier.ts", "user-wip/feature.ts"],
          scope,
          agentId,
        ),
      ).toThrow(HarnessError);

      try {
        assertNonDestructiveWriteScope(
          ["src/authority/thread-identifier.ts", "user-wip/feature.ts", "package.json"],
          scope,
          agentId,
        );
      } catch (err) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(harnessErr.message).toContain("user-wip/feature.ts");
        expect(harnessErr.message).toContain("package.json");
        expect(harnessErr.message).toContain(agentId);
      }
    });

    test("partitionObservedChanges separates agent-scoped edits from user WIP edits", () => {
      const scope = ["src/workflow/worktree", "tests/unit/worktree"];
      const changes = [
        "src/workflow/worktree/git.ts",
        "tests/unit/worktree/git-preservation.test.ts",
        "src/user-feature/button.tsx",
        "docs/user-draft.md",
        ".env.secret",
      ];

      const partitioned = partitionObservedChanges(changes, scope);
      expect(partitioned.scopedPaths).toEqual([
        "src/workflow/worktree/git.ts",
        "tests/unit/worktree/git-preservation.test.ts",
      ]);
      expect(partitioned.unfamiliarUserPaths).toEqual([
        "src/user-feature/button.tsx",
        "docs/user-draft.md",
        ".env.secret",
      ]);
    });

    test("buildInclusiveStageArgs constructs explicit non-destructive git add arguments", () => {
      const simpleScope = ["src/workflow/worktree", "tests/unit/worktree"];
      expect(buildInclusiveStageArgs(simpleScope)).toEqual([
        "add",
        "--",
        "src/workflow/worktree",
        "tests/unit/worktree",
      ]);

      const globScope = ["src/**/*.ts", "docs/*.md"];
      expect(buildInclusiveStageArgs(globScope)).toEqual([
        "add",
        "--",
        ":(glob)src/**/*.ts",
        ":(glob)docs/*.md",
      ]);

      expect(() => buildInclusiveStageArgs([])).toThrow(HarnessError);
    });
  });

  describe("Git Helper Utilities & Environment Sanitization", () => {
    test("worktreeGitEnvironment sets non-interactive flags and preserves safe variables", () => {
      const mockEnv: NodeJS.ProcessEnv = {
        PATH: "/usr/local/bin:/usr/bin",
        HOME: "/Users/dev",
        SSH_AUTH_SOCK: "/tmp/ssh.sock",
        UNSAFE_SECRET_VAR: "secret123",
      };

      const sanitized = worktreeGitEnvironment(mockEnv);
      expect(sanitized.GIT_TERMINAL_PROMPT).toBe("0");
      expect(sanitized.GIT_PAGER).toBe("cat");
      expect(sanitized.PAGER).toBe("cat");
      expect(sanitized.PATH).toBe("/usr/local/bin:/usr/bin");
      expect(sanitized.HOME).toBe("/Users/dev");
      expect(sanitized.SSH_AUTH_SOCK).toBe("/tmp/ssh.sock");
      expect(sanitized.UNSAFE_SECRET_VAR).toBeUndefined();
    });

    test("git wrapper function throws HarnessError with stderr on non-zero exit", () => {
      const failingSpawn: GitSpawn = () => ({
        status: 128,
        stdout: "",
        stderr: "fatal: not a git repository\n",
      });
      const failingRunner = createGitRunner(failingSpawn);

      expect(() => git("/invalid", ["status"], failingRunner)).toThrow(HarnessError);
      try {
        git("/invalid", ["status"], failingRunner);
      } catch (err) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INTEGRITY");
        expect(harnessErr.message).toContain("fatal: not a git repository");
      }
    });
  });

  describe("Invariants & TypeScript Strictness Audit", () => {
    test("zero TypeScript any and zero suppressions across zero-destructive-policy files", () => {
      const sourceFiles = [
        join(__dirname, "../../../olt/scripts/src/worktree/zero-destructive-policy.ts"),
        join(__dirname, "../../../olt/scripts/src/workflow/worktree/git.ts"),
        __filename,
      ];

      const anyAnnotation = new RegExp(":\\s*any\\b");
      const anyCast = new RegExp("as\\s+any\\b");
      const anyGeneric = new RegExp("<\\s*any\\s*>");
      const tsIgnore = "@" + "ts-ignore";
      const tsExpectError = "@" + "ts-expect-error";
      const tsNoCheck = "@" + "ts-nocheck";
      const lintSuppressionA = "es" + "lint-disable";
      const lintSuppressionB = "ox" + "lint-disable";

      for (const filePath of sourceFiles) {
        const content = readFileSync(filePath, "utf8");

        expect(content).not.toMatch(anyAnnotation);
        expect(content).not.toMatch(anyCast);
        expect(content).not.toMatch(anyGeneric);
        expect(content.includes(tsIgnore)).toBe(false);
        expect(content.includes(tsExpectError)).toBe(false);
        expect(content.includes(tsNoCheck)).toBe(false);
        expect(content.includes(lintSuppressionA)).toBe(false);
        expect(content.includes(lintSuppressionB)).toBe(false);
      }
    });
  });
});
