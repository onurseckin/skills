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
} from "../../../olt/scripts/src/engine/worktree/zero-destructive-policy.ts";
import {
  createGitRunner,
  git,
  worktreeGitEnvironment,
  type GitRunner,
  type GitSpawn,
} from "../../../olt/scripts/src/workflow/worktree/git.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

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
});
