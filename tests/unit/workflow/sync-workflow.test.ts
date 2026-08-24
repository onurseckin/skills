import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  executeAutoSyncAndCommit,
  executePhaseCompletionSyncAndCommit,
  type AutoSyncOptions,
  type GitRunner,
  type GitRunnerResult,
  type SyncRunner,
  type SyncRunnerResult,
} from "../../../olt/scripts/src/workflow/completion/auto-sync-and-commit.ts";
import {
  CONVENTIONAL_COMMIT_TYPES,
  formatConventionalCommit,
  formatConventionalCommitMessage,
  validatePhaseCommitMessage,
} from "../../../olt/scripts/src/engine/worktree/phase-commits.ts";

describe("Sync Workflow: Auto-Sync, Conventional Commits & Global Skill Sync (Task 3)", () => {
  describe("Conventional Commit Message Formatting & Exports", () => {
    test("exports CONVENTIONAL_COMMIT_TYPES set with standard types", () => {
      expect(CONVENTIONAL_COMMIT_TYPES.has("feat")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("fix")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("chore")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("docs")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("refactor")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("perf")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("test")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("build")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("ci")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("revert")).toBeTrue();
    });

    test("formats feat commit with scope", () => {
      const msg = formatConventionalCommitMessage({
        type: "feat",
        scope: "workflow",
        description: "implement per-task auto-sync routine",
      });
      expect(msg).toBe("feat(workflow): implement per-task auto-sync routine");
      const validation = validatePhaseCommitMessage(msg);
      expect(validation.valid).toBeTrue();
      expect(validation.parsed?.type).toBe("feat");
      expect(validation.parsed?.scope).toBe("workflow");
      expect(validation.parsed?.description).toBe("implement per-task auto-sync routine");
    });

    test("formats fix commit without scope", () => {
      const msg = formatConventionalCommitMessage({
        type: "fix",
        description: "resolve git staging race condition",
      });
      expect(msg).toBe("fix: resolve git staging race condition");
      const validation = validatePhaseCommitMessage(msg);
      expect(validation.valid).toBeTrue();
      expect(validation.parsed?.type).toBe("fix");
      expect(validation.parsed?.scope).toBeUndefined();
    });

    test("formats chore commit with body", () => {
      const msg = formatConventionalCommitMessage({
        type: "chore",
        scope: "deps",
        description: "update runtime dependencies",
        body: "Bumps typescript and vitest packages to latest patch versions.",
      });
      expect(msg).toBe(
        "chore(deps): update runtime dependencies\n\nBumps typescript and vitest packages to latest patch versions.",
      );
      const validation = validatePhaseCommitMessage(msg);
      expect(validation.valid).toBeTrue();
      expect(validation.parsed?.body).toBe(
        "Bumps typescript and vitest packages to latest patch versions.",
      );
    });

    test("formats docs commit with breaking changes footer and closed issues", () => {
      const msg = formatConventionalCommitMessage({
        type: "docs",
        scope: "api",
        description: "document breaking API contracts",
        isBreaking: true,
        breakingChangeDescription: "Payload structure requires new syncResult field.",
        issuesClosed: ["#42", "TASK-101"],
      });
      expect(msg).toBe(
        "docs(api)!: document breaking API contracts\n\nBREAKING CHANGE: Payload structure requires new syncResult field.\n\nCloses: #42, TASK-101",
      );
      const validation = validatePhaseCommitMessage(msg);
      expect(validation.valid).toBeTrue();
      expect(validation.parsed?.isBreaking).toBeTrue();
      expect(validation.parsed?.breakingChangeDescription).toBe(
        "Payload structure requires new syncResult field.",
      );
      expect(validation.parsed?.issuesClosed).toEqual(["#42", "TASK-101"]);
    });

    test("throws HarnessError on invalid commit type", () => {
      expect(() => {
        formatConventionalCommitMessage({
          type: "invalid_type",
          description: "something invalid",
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on empty description", () => {
      expect(() => {
        formatConventionalCommitMessage({
          type: "feat",
          description: "   ",
        });
      }).toThrow(HarnessError);
    });
  });

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
        writeScope: ["src/workflow/completion/**", "scripts/sync-global.ts"],
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
        "scripts/sync-global.ts",
      ]);
      expect(gitCalls[0]?.options?.cwd).toBe("/mock/repo");

      expect(gitCalls[1]?.args[0]).toBe("commit");
      expect(gitCalls[1]?.args[1]).toBe("-m");
      expect(gitCalls[1]?.args[2]).toBe(result.message);

      expect(gitCalls[2]?.args).toEqual(["rev-parse", "HEAD"]);
      expect(gitCalls[3]?.args).toEqual(["push", "origin", "main"]);

      // Verify sync calls
      expect(syncCalls.length).toBe(1);
      expect(syncCalls[0]?.scriptPath).toBe("/mock/repo/scripts/sync-global.ts");
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
        gitCalls.some(
          (c) => c[0] === "push" && c[1] === "upstream" && c[2] === "feature/auth-patch",
        ),
      ).toBeTrue();
    });

    test("supports asynchronous Promise-returning GitRunner and SyncRunner", async () => {
      const mockAsyncGitRunner: GitRunner = async (args) => {
        await new Promise((r) => setTimeout(r, 5));
        if (args[0] === "rev-parse") {
          return { status: 0, stdout: "sha12345\n", stderr: "" };
        }
        return { status: 0, stdout: "async output", stderr: "" };
      };

      const mockAsyncSyncRunner: SyncRunner = async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { status: 0, stdout: "async sync output", stderr: "" };
      };

      const options: AutoSyncOptions = {
        taskId: "task-async",
        commitType: "perf",
        scope: "store",
        description: "optimize index lookups",
        writeScope: ["src/store.ts"],
      };

      const result = await executeAutoSyncAndCommit(
        options,
        mockAsyncGitRunner,
        mockAsyncSyncRunner,
      );

      expect(result.committed).toBeTrue();
      expect(result.commitSha).toBe("sha12345");
      expect(result.pushed).toBeTrue();
      expect(result.synced).toBeTrue();
    });
  });

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
        writeScope: ["tests/unit/test.ts"],
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
          stderr: "scripts/sync-global.ts: No such file or directory",
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

  describe("Backward Compatibility: executePhaseCompletionSyncAndCommit", () => {
    test("executes phase completion sync and commit with expected return shape", async () => {
      const mockGitRunner: GitRunner = (args) => {
        if (args[0] === "rev-parse") {
          return { status: 0, stdout: "sha-phase-999\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };
      const mockSyncRunner: SyncRunner = () => ({ status: 0, stdout: "synced", stderr: "" });

      const res = await executePhaseCompletionSyncAndCommit(
        {
          phaseName: "test-phase",
          runId: "run-999",
          autoPush: false,
        },
        mockGitRunner,
        mockSyncRunner,
      );

      expect(typeof res.synced).toBe("boolean");
      expect(typeof res.committed).toBe("boolean");
      expect(typeof res.pushed).toBe("boolean");
      expect(res.synced).toBeTrue();
      expect(res.committed).toBeTrue();
      expect(res.commitSha).toBe("sha-phase-999");
      expect(res.pushed).toBeFalse();
    });
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  test("verifies auto-sync and phase-commits modules and tests contain zero any and zero suppressions", () => {
    const filesToAudit = [
      join(process.cwd(), "olt/scripts/src/workflow/completion/auto-sync-and-commit.ts"),
      join(process.cwd(), "olt/scripts/src/engine/worktree/phase-commits.ts"),
      join(process.cwd(), "tests/unit/workflow/sync-workflow.test.ts"),
    ];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    for (const filePath of filesToAudit) {
      expect(existsSync(filePath)).toBeTrue();
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
