import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { executeBackgroundFinalization } from "../../../olt/scripts/src/orchestrator/supervision-loop.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";
import { createMockGitRunner, createMockSyncRunner } from "./fixture.ts";

describe("Background Finalization Engine - Lifecycle Execution", () => {
  it("executes full lifecycle: git add, commit, push, and global sync in background thread", async () => {
    const testDir = scratchRoot(import.meta.path, "lifecycle-full");
    const { runner: gitRunner, commands: gitCommands } = createMockGitRunner({
      commitSha: "sha-1234567890",
      statusOutput: " M src/engine.ts\n",
    });
    const { runner: syncRunner, commands: syncCommands } = createMockSyncRunner();

    const result = await executeBackgroundFinalization({
      repoPath: testDir,
      runId: "run-cycle-1",
      actor: "orchestrator-tier1",
      commitMessage: "feat(orchestrator): autonomous convergence finalization",
      branch: "main",
      remote: "origin",
      gitRunner,
      syncRunner,
      syncCommand: "bun scripts/sync/index.ts",
    });

    expect(result.success).toBe(true);
    expect(result.actor).toBe("orchestrator-tier1");
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.synced).toBe(true);
    expect(result.commitSha).toBe("sha-1234567890");
    expect(result.zeroMainThreadSpillover).toBe(true);
    expect(result.spilloverVerification.compliant).toBe(true);

    expect(gitCommands).toEqual([
      ["add", "-A"],
      ["status", "--porcelain"],
      ["commit", "-m", "feat(orchestrator): autonomous convergence finalization"],
      ["rev-parse", "HEAD"],
      ["push", "origin", "main"],
    ]);

    expect(syncCommands).toEqual(["bun scripts/sync/index.ts"]);
    expect(result.markdown).toContain("Tier 1 Background Orchestrator Finalization");
    expect(result.markdown).toContain("✓ Verified (0 spillover)");
    expect(result.markdown).toContain("✓ Committed");
    expect(result.markdown).toContain("✓ Pushed to upstream");
    expect(result.markdown).toContain("✓ Synced (`~/.agents/skills`)");
  });

  it("skips commit when working tree is already clean but still pushes and syncs", async () => {
    const testDir = scratchRoot(import.meta.path, "lifecycle-clean-tree");
    const { runner: gitRunner, commands: gitCommands } = createMockGitRunner({
      statusOutput: "",
    });
    const { runner: syncRunner, commands: syncCommands } = createMockSyncRunner();

    const result = await executeBackgroundFinalization({
      repoPath: testDir,
      runId: "run-clean-1",
      gitRunner,
      syncRunner,
    });

    expect(result.success).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(true);
    expect(result.synced).toBe(true);

    const commitStep = result.steps.find((s) => s.step === "git_commit");
    expect(commitStep?.status).toBe("skipped");
    expect(commitStep?.reason).toBe("clean_working_tree_no_changes");

    expect(gitCommands).toEqual([
      ["add", "-A"],
      ["status", "--porcelain"],
      ["push", "origin", "main"],
    ]);
    expect(syncCommands).toEqual(["bun scripts/sync/index.ts"]);
  });

  it("respects skipPush and skipSync configuration flags", async () => {
    const testDir = scratchRoot(import.meta.path, "lifecycle-skips");
    const { runner: gitRunner } = createMockGitRunner();
    const { runner: syncRunner, commands: syncCommands } = createMockSyncRunner();

    const result = await executeBackgroundFinalization({
      repoPath: testDir,
      skipPush: true,
      skipSync: true,
      gitRunner,
      syncRunner,
    });

    expect(result.success).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.synced).toBe(false);

    const pushStep = result.steps.find((s) => s.step === "git_push");
    expect(pushStep?.status).toBe("skipped");
    expect(pushStep?.reason).toBe("push_disabled_by_config");

    const syncStep = result.steps.find((s) => s.step === "global_sync");
    expect(syncStep?.status).toBe("skipped");
    expect(syncStep?.reason).toBe("sync_disabled_by_config");

    expect(syncCommands).toEqual([]);
  });

  it("handles git push or sync failures gracefully and records step failure", async () => {
    const testDir = scratchRoot(import.meta.path, "lifecycle-failure");
    const { runner: gitRunner } = createMockGitRunner({
      pushStatus: 1,
      pushError: "fatal: remote disconnected",
    });
    const { runner: syncRunner } = createMockSyncRunner();

    const result = await executeBackgroundFinalization({
      repoPath: testDir,
      gitRunner,
      syncRunner,
    });

    expect(result.success).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.error).toContain("git push failed");

    const pushStep = result.steps.find((s) => s.step === "git_push");
    expect(pushStep?.status).toBe("failed");
    expect(pushStep?.reason).toContain("remote disconnected");
  });

  it("throws HarnessError on failure when throwOnError option is set", async () => {
    const testDir = scratchRoot(import.meta.path, "lifecycle-throw-on-error");
    const { runner: gitRunner } = createMockGitRunner({
      addStatus: 1,
      addError: "fatal: pathspec error",
    });

    expect(
      executeBackgroundFinalization({
        repoPath: testDir,
        throwOnError: true,
        gitRunner,
      }),
    ).rejects.toThrow(HarnessError);
  });
});
