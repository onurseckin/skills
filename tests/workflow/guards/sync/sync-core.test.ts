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

describe("Error Handling & Failure Recovery", () => {
    test("handles git commit failure gracefully and skips push while continuing sync", async () => {
      const gitCommands: string[] = [];
      let syncAttempted = false;

      const mockGitRunner: GitRunner = (args) => {
        gitCommands.push(args[0]!);
        if (args[0] === "commit") {
          return { status: 1, stdout: "nothing to commit, working tree clean", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const mockSyncRunner: SyncRunner = () => {
        syncAttempted = true;
        return { status: 0, stdout: "sync ok", stderr: "" };
      };

      const options: AutoSyncOptions = {
        taskId: "task-clean-tree",
        commitType: "feat",
        description: "attempted commit with no changes",
        writeScope: ["src/empty.ts"],
      };

      const result = await executeAutoSyncAndCommit(options, mockGitRunner, mockSyncRunner);

      expect(result.committed).toBeFalse();
      expect(result.commitSha).toBeUndefined();
      expect(result.pushed).toBeFalse();
      expect(result.synced).toBeTrue();
      expect(syncAttempted).toBeTrue();
      expect(gitCommands).not.toContain("push");
      expect(result.logs.some((l) => l.includes("[commit] Git commit failed"))).toBeTrue();
      expect(
        result.logs.some((l) =>
          l.includes("[push] Push skipped because commit was not successful"),
        ),
      ).toBeTrue();
    });

    test("handles git push failure gracefully without crashing", async () => {
      let syncRan = false;

      const mockGitRunner: GitRunner = (args) => {
        if (args[0] === "rev-parse") {
          return { status: 0, stdout: "sha-push-fail\n", stderr: "" };
        }
        if (args[0] === "push") {
          return {
            status: 1,
            stdout: "",
            stderr: "fatal: unable to access 'https://github.com/repo': Could not resolve host",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const mockSyncRunner: SyncRunner = () => {
        syncRan = true;
        return { status: 0, stdout: "synced", stderr: "" };
      };

      const options: AutoSyncOptions = {
        taskId: "task-push-network-err",
        commitType: "feat",
        description: "push fails due to network outage",
        writeScope: ["src/network.ts"],
      };

      const result = await executeAutoSyncAndCommit(options, mockGitRunner, mockSyncRunner);

      expect(result.committed).toBeTrue();
      expect(result.commitSha).toBe("sha-push-fail");
      expect(result.pushed).toBeFalse();
      expect(result.synced).toBeTrue();
      expect(syncRan).toBeTrue();
      expect(
        result.logs.some(
          (l) => l.includes("[push] Git push failed") && l.includes("Could not resolve host"),
        ),
      ).toBeTrue();
    });

    test("handles global sync script failure gracefully", async () => {
      const mockGitRunner: GitRunner = (args) => {
        if (args[0] === "rev-parse") {
          return { status: 0, stdout: "sha-sync-fail\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const mockSyncRunner: SyncRunner = () => {
        return {
          status: 127,
          stdout: "",
          stderr: "scripts/sync/index.ts: No such file or directory",
        };
      };

      const options: AutoSyncOptions = {
        taskId: "task-sync-missing",
        commitType: "feat",
        description: "sync script failure scenario",
        writeScope: ["src/sync.ts"],
      };

      const result = await executeAutoSyncAndCommit(options, mockGitRunner, mockSyncRunner);

      expect(result.committed).toBeTrue();
      expect(result.pushed).toBeTrue();
      expect(result.synced).toBeFalse();
      expect(
        result.logs.some(
          (l) => l.includes("[sync] Global skill sync failed") && l.includes("No such file"),
        ),
      ).toBeTrue();
    });

    test("handles runner exceptions gracefully without unhandled promise rejection", async () => {
      const mockThrowingGitRunner: GitRunner = () => {
        throw new Error("Simulated git process crash: ENOENT");
      };

      const mockThrowingSyncRunner: SyncRunner = () => {
        throw new Error("Simulated bun execution crash: EACCES");
      };

      const options: AutoSyncOptions = {
        taskId: "task-crash",
        commitType: "feat",
        description: "processes crash unexpectedly",
        writeScope: ["src/crash.ts"],
      };

      const result = await executeAutoSyncAndCommit(
        options,
        mockThrowingGitRunner,
        mockThrowingSyncRunner,
      );

      expect(result.committed).toBeFalse();
      expect(result.pushed).toBeFalse();
      expect(result.synced).toBeFalse();
      expect(result.logs.some((l) => l.includes("Simulated git process crash"))).toBeTrue();
      expect(result.logs.some((l) => l.includes("Simulated bun execution crash"))).toBeTrue();
    });

    test("handles git staging failure and empty write scope", async () => {
      // Staging non-zero status with stderr
      const mockFailingStageRunner: GitRunner = (args) => {
        if (args[0] === "add") {
          return { status: 128, stdout: "", stderr: "fatal: pathspec not found" };
        }
        return { status: 0, stdout: "ok", stderr: "" };
      };

      const options: AutoSyncOptions = {
        taskId: "task-stage-fail",
        commitType: "fix",
        description: "failing staging test",
        writeScope: ["nonexistent.ts"],
        skipPush: true,
        skipSync: true,
      };

      const result = await executeAutoSyncAndCommit(options, mockFailingStageRunner, () => ({
        status: 0,
        stdout: "",
        stderr: "",
      }));
      expect(result.logs.some((l) => l.includes("[stage] Git stage failed"))).toBeTrue();

      // Staging with empty writeScope
      const emptyScopeOptions: AutoSyncOptions = {
        taskId: "task-empty-scope",
        commitType: "fix",
        description: "empty write scope",
        writeScope: [],
        skipPush: true,
        skipSync: true,
      };
      const resultEmpty = await executeAutoSyncAndCommit(
        emptyScopeOptions,
        () => ({ status: 0, stdout: "", stderr: "" }),
        () => ({ status: 0, stdout: "", stderr: "" }),
      );
      expect(
        resultEmpty.logs.some((l) => l.includes("[stage] Empty write scope; skipping git add")),
      ).toBeTrue();
    });

    test("handles git push exception and failure with stdout only", async () => {
      const mockPushExceptionRunner: GitRunner = (args) => {
        if (args[0] === "push") {
          throw new Error("Push network timeout");
        }
        return { status: 0, stdout: "ok", stderr: "" };
      };

      const options: AutoSyncOptions = {
        taskId: "task-push-exception",
        commitType: "feat",
        description: "push throws exception",
        writeScope: ["src/file.ts"],
        skipSync: true,
      };

      const result = await executeAutoSyncAndCommit(options, mockPushExceptionRunner, () => ({
        status: 0,
        stdout: "",
        stderr: "",
      }));
      expect(result.pushed).toBeFalse();
      expect(
        result.logs.some((l) => l.includes("[push] Git push exception: Push network timeout")),
      ).toBeTrue();

      // Push non-zero with stdout instead of stderr
      const mockPushStdoutRunner: GitRunner = (args) => {
        if (args[0] === "push") {
          return { status: 1, stdout: "remote rejected", stderr: "" };
        }
        return { status: 0, stdout: "ok", stderr: "" };
      };
      const resultStdout = await executeAutoSyncAndCommit(options, mockPushStdoutRunner, () => ({
        status: 0,
        stdout: "",
        stderr: "",
      }));
      expect(resultStdout.pushed).toBeFalse();
      expect(
        resultStdout.logs.some((l) =>
          l.includes("[push] Git push failed (status 1): remote rejected"),
        ),
      ).toBeTrue();
    });

    test("executes defaultGitRunner and defaultSyncRunner when runners are omitted", async () => {
      const options: AutoSyncOptions = {
        taskId: "task-default-runners",
        commitType: "chore",
        description: "run with default runners",
        writeScope: [],
        skipPush: true,
        skipSync: true,
        repoRoot: "/tmp",
      };

      const result = await executeAutoSyncAndCommit(options);
      expect(typeof result.committed).toBe("boolean");
      expect(typeof result.synced).toBe("boolean");
      expect(typeof result.pushed).toBe("boolean");
    });

    test("handles invalid commit type without crashing", async () => {
      const options: AutoSyncOptions = {
        taskId: "task-bad-type",
        commitType: "nonexistent_type",
        description: "invalid commit type provided",
        writeScope: ["src/file.ts"],
      };

      const result = await executeAutoSyncAndCommit(options);

      expect(result.committed).toBeFalse();
      expect(result.pushed).toBeFalse();
      expect(result.synced).toBeFalse();
      expect(result.logs.some((l) => l.includes("[format] Commit format failed"))).toBeTrue();
    });
  });
