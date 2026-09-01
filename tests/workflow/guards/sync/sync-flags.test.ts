import { describe, expect, test } from "bun:test";
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

describe("executeAutoSyncAndCommit Workflow Execution", () => {
  test("runs full staging, commit, push, and sync cycle successfully with injected runners", async () => {
    const gitCalls: { args: readonly string[]; options?: { cwd?: string } }[] = [];
    const syncCalls: { scriptPath: string; options?: { cwd?: string } }[] = [];

    const mockGitRunner: GitRunner = (args, options) => {
      gitCalls.push({ args: [...args], options });
      const subCommand = args[0];

      if (subCommand === "add") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (subCommand === "commit") {
        return { status: 0, stdout: "[main a1b2c3d] feat: sync", stderr: "" };
      }
      if (subCommand === "rev-parse") {
        return { status: 0, stdout: "a1b2c3d4e5f67890\n", stderr: "" };
      }
      if (subCommand === "push") {
        return { status: 0, stdout: "Everything up-to-date", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const mockSyncRunner: SyncRunner = (scriptPath, options) => {
      syncCalls.push({ scriptPath, options });
      return { status: 0, stdout: "✓ Global skill sync complete", stderr: "" };
    };

    const options: AutoSyncOptions = {
      taskId: "task-003",
      commitType: "feat",
      scope: "sync",
      description: "implement global skill sync workflow",
      body: "Adds auto-sync-and-commit with Conventional Commits and remote push.",
      writeScope: ["src/workflow/completion/**", "scripts/sync/index.ts"],
      remote: "origin",
      branch: "main",
      repoRoot: "/mock/repo",
    };

    const result = await executeAutoSyncAndCommit(options, mockGitRunner, mockSyncRunner);

    expect(result.committed).toBeTrue();
    expect(result.commitSha).toBe("a1b2c3d4e5f67890");
    expect(result.pushed).toBeTrue();
    expect(result.synced).toBeTrue();
    expect(result.message).toContain("feat(sync): implement global skill sync workflow");
    expect(result.message).toContain(
      "Adds auto-sync-and-commit with Conventional Commits and remote push.",
    );

    // Verify git calls
    expect(gitCalls.length).toBe(4);
    expect(gitCalls[0]?.args).toEqual([
      "add",
      "--",
      "src/workflow/completion",
      "scripts/sync/index.ts",
    ]);
    expect(gitCalls[0]?.options?.cwd).toBe("/mock/repo");

    expect(gitCalls[1]?.args[0]).toBe("commit");
    expect(gitCalls[1]?.args[1]).toBe("-m");
    expect(gitCalls[1]?.args[2]).toBe(result.message);

    expect(gitCalls[2]?.args).toEqual(["rev-parse", "HEAD"]);
    expect(gitCalls[3]?.args).toEqual(["push", "origin", "main"]);

    // Verify sync calls
    expect(syncCalls.length).toBe(1);
    expect(syncCalls[0]?.scriptPath).toBe("/mock/repo/scripts/sync/index.ts");
    expect(syncCalls[0]?.options?.cwd).toBe("/mock/repo");

    // Verify logs
    expect(result.logs.some((l) => l.includes("[format]"))).toBeTrue();
    expect(result.logs.some((l) => l.includes("[stage] Staging complete"))).toBeTrue();
    expect(result.logs.some((l) => l.includes("[commit] Git commit succeeded"))).toBeTrue();
    expect(
      result.logs.some((l) => l.includes("[push] Pushed successfully to origin/main")),
    ).toBeTrue();
    expect(result.logs.some((l) => l.includes("[sync] Global skill sync succeeded"))).toBeTrue();
  });

  test("defaults commitType to 'feat' and remote/branch to 'origin'/'main'", async () => {
    const gitCalls: string[][] = [];

    const mockGitRunner: GitRunner = (args) => {
      gitCalls.push([...args]);
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: "deadbeef00112233\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const mockSyncRunner: SyncRunner = () => ({
      status: 0,
      stdout: "ok",
      stderr: "",
    });

    const options: AutoSyncOptions = {
      taskId: "task-default",
      description: "add default fallback parameters",
      writeScope: ["src/file.ts"],
    };

    const result = await executeAutoSyncAndCommit(options, mockGitRunner, mockSyncRunner);

    expect(result.committed).toBeTrue();
    expect(result.message).toBe("feat: add default fallback parameters");
    expect(
      gitCalls.some((c) => c[0] === "push" && c[1] === "origin" && c[2] === "main"),
    ).toBeTrue();
  });

  test("respects custom remote and custom branch", async () => {
    const gitCalls: string[][] = [];

    const mockGitRunner: GitRunner = (args) => {
      gitCalls.push([...args]);
      return { status: 0, stdout: "ok", stderr: "" };
    };

    const mockSyncRunner: SyncRunner = () => ({ status: 0, stdout: "ok", stderr: "" });

    const options: AutoSyncOptions = {
      taskId: "task-custom-push",
      commitType: "fix",
      scope: "api",
      description: "patch authorization header parsing",
      writeScope: ["src/api/auth.ts"],
      remote: "upstream",
      branch: "feature/auth-patch",
    };

    const result = await executeAutoSyncAndCommit(options, mockGitRunner, mockSyncRunner);

    expect(result.pushed).toBeTrue();
    expect(
      gitCalls.some((c) => c[0] === "push" && c[1] === "upstream" && c[2] === "feature/auth-patch"),
    ).toBeTrue();
  });

  test("supports asynchronous Promise-returning GitRunner and SyncRunner", async () => {
    const mockAsyncGitRunner: GitRunner = async (args) => {
      await Promise.resolve();
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: "sha12345\n", stderr: "" };
      }
      return { status: 0, stdout: "async output", stderr: "" };
    };

    const mockAsyncSyncRunner: SyncRunner = async () => {
      await Promise.resolve();
      return { status: 0, stdout: "async sync output", stderr: "" };
    };

    const options: AutoSyncOptions = {
      taskId: "task-async",
      commitType: "perf",
      scope: "store",
      description: "optimize index lookups",
      writeScope: ["src/store.ts"],
    };

    const result = await executeAutoSyncAndCommit(options, mockAsyncGitRunner, mockAsyncSyncRunner);

    expect(result.committed).toBeTrue();
    expect(result.commitSha).toBe("sha12345");
    expect(result.pushed).toBeTrue();
    expect(result.synced).toBeTrue();
  });
});
