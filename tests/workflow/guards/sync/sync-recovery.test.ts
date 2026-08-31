import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  executeAutoSyncAndCommit,
  type AutoSyncOptions,
  type GitRunner,
  type GitRunnerResult,
  type SyncRunner,
  type SyncRunnerResult,
} from "../../../../olt/scripts/src/workflow/completion/auto-sync-and-commit.ts";
import {
  CONVENTIONAL_COMMIT_TYPES,
  formatConventionalCommit,
  formatConventionalCommitMessage,
  validatePhaseCommitMessage,
} from "../../../../olt/scripts/src/engine/worktree/phase-commits.ts";

describe("Flag Handling: skipPush & skipSync", () => {
    test("skips push when skipPush = true", async () => {
      const gitCommands: string[] = [];
      let syncCalled = false;

      const mockGitRunner: GitRunner = (args) => {
        gitCommands.push(args[0]!);
        if (args[0] === "rev-parse") {
          return { status: 0, stdout: "commit-sha-123\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const mockSyncRunner: SyncRunner = () => {
        syncCalled = true;
        return { status: 0, stdout: "", stderr: "" };
      };

      const options: AutoSyncOptions = {
        taskId: "task-skip-push",
        commitType: "chore",
        description: "local maintenance task",
        writeScope: ["src/internal.ts"],
        skipPush: true,
      };

      const result = await executeAutoSyncAndCommit(options, mockGitRunner, mockSyncRunner);

      expect(result.committed).toBeTrue();
      expect(result.commitSha).toBe("commit-sha-123");
      expect(result.pushed).toBeFalse();
      expect(result.synced).toBeTrue();
      expect(syncCalled).toBeTrue();
      expect(gitCommands).not.toContain("push");
      expect(
        result.logs.some((l) => l.includes("[push] Push skipped (skipPush = true)")),
      ).toBeTrue();
    });

    test("skips global sync when skipSync = true", async () => {
      let syncCalled = false;
      const mockGitRunner: GitRunner = (args) => {
        if (args[0] === "rev-parse") {
          return { status: 0, stdout: "sha-skip-sync\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const mockSyncRunner: SyncRunner = () => {
        syncCalled = true;
        return { status: 0, stdout: "", stderr: "" };
      };

      const options: AutoSyncOptions = {
        taskId: "task-skip-sync",
        commitType: "feat",
        description: "feature without global deployment",
        writeScope: ["src/component.ts"],
        skipSync: true,
      };

      const result = await executeAutoSyncAndCommit(options, mockGitRunner, mockSyncRunner);

      expect(result.committed).toBeTrue();
      expect(result.pushed).toBeTrue();
      expect(result.synced).toBeFalse();
      expect(syncCalled).toBeFalse();
      expect(
        result.logs.some((l) => l.includes("[sync] Global skill sync skipped (skipSync = true)")),
      ).toBeTrue();
    });

    test("skips both push and sync when both skipPush and skipSync are true", async () => {
      const gitCommands: string[] = [];
      let syncCalled = false;

      const mockGitRunner: GitRunner = (args) => {
        gitCommands.push(args[0]!);
        return { status: 0, stdout: "", stderr: "" };
      };

      const mockSyncRunner: SyncRunner = () => {
        syncCalled = true;
        return { status: 0, stdout: "", stderr: "" };
      };

      const options: AutoSyncOptions = {
        taskId: "task-skip-both",
        commitType: "test",
        description: "add unit tests without publishing",
        writeScope: ["tests/test.ts"],
        skipPush: true,
        skipSync: true,
      };

      const result = await executeAutoSyncAndCommit(options, mockGitRunner, mockSyncRunner);

      expect(result.committed).toBeTrue();
      expect(result.pushed).toBeFalse();
      expect(result.synced).toBeFalse();
      expect(gitCommands).not.toContain("push");
      expect(syncCalled).toBeFalse();
    });
  });
