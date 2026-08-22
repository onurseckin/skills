import { describe, expect, test } from "bun:test";
import {
  assertNonDestructiveWriteScope,
  assertZeroDestructiveGit,
  buildInclusiveStageArgs,
  filterPathsToScope,
  isDestructiveGitCommand,
  isPathInWriteScope,
  partitionObservedChanges,
} from "../../../orchestrating-long-tasks/scripts/src/worktree/zero-destructive-policy.ts";

describe("zero-destructive git invariant (p55)", () => {
  describe("isDestructiveGitCommand", () => {
    test("flags git clean as destructive", () => {
      expect(isDestructiveGitCommand(["clean"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["clean", "-f"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["clean", "-fd"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["clean", "-fx"]).destructive).toBe(true);
    });

    test("flags git reset --hard/--merge/--keep as destructive", () => {
      expect(isDestructiveGitCommand(["reset", "--hard"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["reset", "-hard"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["reset", "--merge"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["reset", "--keep"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["reset", "--hard", "HEAD~1"]).destructive).toBe(true);
    });

    test("allows safe git reset (soft / mixed / unstage)", () => {
      expect(isDestructiveGitCommand(["reset", "HEAD", "file.ts"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["reset", "--soft", "HEAD~1"]).destructive).toBe(false);
    });

    test("flags git checkout -- / . / -f as destructive", () => {
      expect(isDestructiveGitCommand(["checkout", "--", "file.ts"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["checkout", "--", "."]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["checkout", "."]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["checkout", "-f"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["checkout", "--force"]).destructive).toBe(true);
    });

    test("allows safe git checkout (switching branch / creating branch)", () => {
      expect(isDestructiveGitCommand(["checkout", "feature-branch"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["checkout", "-b", "new-branch"]).destructive).toBe(false);
    });

    test("flags git restore as destructive", () => {
      expect(isDestructiveGitCommand(["restore", "."]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["restore", "src/index.ts"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["restore", "--worktree", "src"]).destructive).toBe(true);
    });

    test("flags git stash drop/clear/--hard as destructive", () => {
      expect(isDestructiveGitCommand(["stash", "drop"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["stash", "clear"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["stash", "push", "--hard"]).destructive).toBe(true);
    });

    test("allows safe git commands", () => {
      expect(isDestructiveGitCommand(["status"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["diff"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["add", "--", "src/file.ts"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["commit", "-m", "feat: new feature"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["rev-parse", "HEAD"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["symbolic-ref", "--short", "-q", "HEAD"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["worktree", "add", "-b", "branch", "/path", "sha"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["worktree", "remove", "--force", "/path"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["branch", "-D", "temp-branch"]).destructive).toBe(false);
    });
  });

  describe("assertZeroDestructiveGit", () => {
    test("throws INTEGRITY error on destructive commands", () => {
      expect(() => assertZeroDestructiveGit(["checkout", "--", "file.ts"])).toThrow(
        /Destructive git operation forbidden by Zero-Destructive Git Invariant/,
      );
      expect(() => assertZeroDestructiveGit(["reset", "--hard"])).toThrow(
        /Destructive git operation forbidden by Zero-Destructive Git Invariant/,
      );
      expect(() => assertZeroDestructiveGit(["clean", "-fd"])).toThrow(
        /Destructive git operation forbidden by Zero-Destructive Git Invariant/,
      );
      expect(() => assertZeroDestructiveGit(["restore", "."])).toThrow(
        /Destructive git operation forbidden by Zero-Destructive Git Invariant/,
      );
    });

    test("passes quietly on non-destructive commands", () => {
      expect(() => assertZeroDestructiveGit(["status", "--short"])).not.toThrow();
      expect(() => assertZeroDestructiveGit(["diff", "--cached"])).not.toThrow();
      expect(() => assertZeroDestructiveGit(["add", "--", "src/foo.ts"])).not.toThrow();
    });
  });

  describe("write scope confinement and preservation", () => {
    test("isPathInWriteScope handles directory, glob, and recursive wildcards", () => {
      const scope = ["src/worktree", "scripts/src/**/*.ts", "docs/*"];
      expect(isPathInWriteScope("src/worktree/index.ts", scope)).toBe(true);
      expect(isPathInWriteScope("src/worktree/sub/deep.ts", scope)).toBe(true);
      expect(isPathInWriteScope("scripts/src/cli/commands/branch.ts", scope)).toBe(true);
      expect(isPathInWriteScope("docs/readme.md", scope)).toBe(true);
      expect(isPathInWriteScope("docs/nested/deep.md", scope)).toBe(false);
      expect(isPathInWriteScope("unrelated/file.ts", scope)).toBe(false);
    });

    test("filterPathsToScope filters file lists strictly to write scope", () => {
      const scope = ["src/worktree", "src/cli/commands"];
      const paths = [
        "src/worktree/index.ts",
        "src/cli/commands/diagnostics.ts",
        "user-edited/config.json",
        "random.txt",
      ];
      expect(filterPathsToScope(paths, scope)).toEqual([
        "src/worktree/index.ts",
        "src/cli/commands/diagnostics.ts",
      ]);
    });

    test("assertNonDestructiveWriteScope throws ROLE_CONFINEMENT_VIOLATION on out-of-scope edits", () => {
      const scope = ["src/worktree"];
      expect(() =>
        assertNonDestructiveWriteScope(["src/worktree/index.ts", "user-file.ts"], scope, "worker-1"),
      ).toThrow(/Agent 'worker-1' modified files outside its assigned write scope: user-file.ts/);
    });

    test("assertNonDestructiveWriteScope passes when all changes are within scope", () => {
      const scope = ["src/worktree", "src/cli/commands"];
      expect(() =>
        assertNonDestructiveWriteScope(
          ["src/worktree/index.ts", "src/cli/commands/task-claim.ts"],
          scope,
          "worker-1",
        ),
      ).not.toThrow();
    });

    test("buildInclusiveStageArgs builds non-destructive git add arguments", () => {
      expect(buildInclusiveStageArgs(["src/worktree", "docs/**"])).toEqual([
        "add",
        "--",
        "src/worktree",
        "docs",
      ]);
      expect(buildInclusiveStageArgs(["src/**/*.ts"])).toEqual([
        "add",
        "--",
        ":(glob)src/**/*.ts",
      ]);
      expect(() => buildInclusiveStageArgs([])).toThrow(/requires at least one write scope path/);
    });

    test("partitionObservedChanges safely separates scoped agent edits from unfamiliar user edits", () => {
      const scope = ["src/worktree"];
      const observed = [
        "src/worktree/index.ts",
        "src/worktree/policy.ts",
        "user-wip/feature.ts",
        ".env.local",
      ];
      const result = partitionObservedChanges(observed, scope);
      expect(result.scopedPaths).toEqual(["src/worktree/index.ts", "src/worktree/policy.ts"]);
      expect(result.unfamiliarUserPaths).toEqual(["user-wip/feature.ts", ".env.local"]);
    });
  });
});
