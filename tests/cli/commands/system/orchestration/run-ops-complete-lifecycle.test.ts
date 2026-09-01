import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInitCommand } from "../../../../../olt/scripts/src/cli/commands/run-init.ts";
import { runCompleteCommand } from "../../../../../olt/scripts/src/cli/commands/run-ops.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/index.ts";
import * as archivalModule from "../../../../../olt/scripts/src/mind/archival/index.ts";
import * as summaryModule from "../../../../../olt/scripts/src/summary/formatters/index.ts";
import * as autoSyncModule from "../../../../../olt/scripts/src/workflow/completion/auto-sync-and-commit.ts";
import * as completeRunModule from "../../../../../olt/scripts/src/workflow/completion/complete-run.ts";
import * as quotaLifecycleModule from "../../../../../olt/scripts/src/workflow/lifecycle/quota-lifecycle.ts";
import * as worktreeModule from "../../../../../olt/scripts/src/workflow/worktree/consolidate.ts";
import type { WorkflowState } from "../../../../../olt/scripts/src/workflow/types.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

beforeEach(() => {
  setupVirtualCliFS();
});

afterEach(() => {
  cleanupVirtualCliFS();
});

function createTestRepo(name: string): { repo: string; promptFile: string } {
  const repo = `/virtual/cli/run-comp-${name}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(join(repo, ".git"), { recursive: true });
  const promptFile = join(repo, "prompt.txt");
  writeFileSync(promptFile, "Run complete tests prompt\n");
  return { repo, promptFile };
}

function grantAgent(runRoot: string, actor: string): void {
  writeAgentMetadata(
    createAgentMetadata({
      agent_id: actor,
      role: "implementer",
      write_scope: ["src/"],
      can_execute_shell: true,
    }),
    runRoot,
  );
}

describe("runCompleteCommand and artifact verification", () => {
  test("completes run with auto-sync, quota badge, and worktree consolidation brief", async () => {
    const { repo } = createTestRepo("complete-worktree");
    writeFileSync(
      join(repo, "harness.config.json"),
      JSON.stringify({ worktree_isolation: true, rebase_on_complete: true }),
    );

    const initRes = await runInitCommand({
      run: "run-comp-wt",
      repo,
      prompt: "Complete prompt",
      "no-runtime-pin": true,
    });
    const runRoot = initRes.run_root as string;
    const actor = "coordinator";
    grantAgent(runRoot, actor);

    transact(runRoot, actor, "setup-worktrees", {}, (draft) => {
      draft.worktree_ledger = {
        harness_branch: "worktrees/run-comp-wt",
        base_sha: "base-sha-1",
        root: "/virtual/wt",
        worktrees: [],
        assignments: [],
        commits: [],
      };
    });

    const consolidateSpy = spyOn(worktreeModule, "consolidateWorktrees").mockReturnValue({
      harness_branch: "worktrees/run-comp-wt",
      commit_count: 3,
      rebased: true,
      diffstat: "2 files changed",
      merge_conflict: undefined,
      rebase_conflict_paths: undefined,
    });

    const completeSpy = spyOn(completeRunModule, "completeRun").mockImplementation(
      (_port, _actor, verifyCallback) => {
        const state: WorkflowState = {
          tasks: {
            "T-1": {
              id: "T-1",
              status: "done",
              requirement_ids: [],
              write_scope: ["."],
              dependencies: [],
              attempts: [],
              history: [],
              repair_round: 0,
            },
          },
          requirements: [],
          gates: [],
          commands: {},
          completion_result: { status: "complete", completed_at: "2026-09-01T00:00:01.000Z" },
        };
        const verification = verifyCallback(state, { command_ids: [], packets: [] });
        expect(verification.verified_at).toBeDefined();
        return state;
      },
    );

    const autoSyncSpy = spyOn(autoSyncModule, "executeAutoSyncAndCommit").mockResolvedValue({
      synced: true,
      committed: true,
      pushed: true,
      commitSha: "sha-complete-1",
      logs: [],
    });

    const quotaSpy = spyOn(quotaLifecycleModule, "probeLiveQuotaTelemetry").mockResolvedValue({
      provider: "claude-subscription",
      activeHost: "host-primary",
      quotaBadge: "88% (Healthy)",
      quotaBucket: "nominal",
    });

    const res = await runCompleteCommand({
      run: runRoot,
      actor,
      "auth-token": "critic-pass-token",
    });

    expect(res.run_root).toBe(runRoot);
    expect(res.worktree_consolidation).toBeDefined();
    expect(String(res.markdown)).toContain("Live Quota");
    expect(String(res.markdown)).toContain("88% (Healthy)");

    consolidateSpy.mockRestore();
    completeSpy.mockRestore();
    autoSyncSpy.mockRestore();
    quotaSpy.mockRestore();
  });

  test("handles summary suite exceptions and verification integrity failure", async () => {
    const { repo } = createTestRepo("complete-failures");
    const initRes = await runInitCommand({
      run: "run-comp-fail",
      repo,
      prompt: "Complete fail prompt",
      "no-runtime-pin": true,
    });
    const runRoot = initRes.run_root as string;
    const actor = "coordinator";
    grantAgent(runRoot, actor);

    const completeSpy = spyOn(completeRunModule, "completeRun").mockImplementation(
      (_port, _actor, verifyCallback) => {
        const state: WorkflowState = {
          tasks: {},
          requirements: [],
          gates: [],
          commands: {
            "cmd-bad": {
              id: "cmd-bad",
            } as unknown as WorkflowState["commands"][string],
          },
        };
        expect(() => verifyCallback(state, { command_ids: ["cmd-missing"], packets: [] })).toThrow(
          /missing durable command record/,
        );

        expect(() => verifyCallback(state, { command_ids: ["cmd-bad"], packets: [] })).toThrow(
          /completion artifact verification failed/,
        );

        return {
          tasks: {},
          requirements: [],
          gates: [],
          commands: {},
          completion_result: { status: "complete", completed_at: "2026-09-01T00:00:00.000Z" },
        } as WorkflowState;
      },
    );

    const summarySpy = spyOn(summaryModule, "generateSummarySuite").mockImplementation(() => {
      throw "non-error summary crash";
    });

    const pruneSpy = spyOn(archivalModule, "pruneCapsuleBoilerplate").mockImplementation(() => {
      throw new Error("prune error ignored");
    });

    const autoSyncSpy = spyOn(autoSyncModule, "executeAutoSyncAndCommit").mockResolvedValue({
      synced: false,
      committed: false,
      pushed: false,
      logs: ["[sync] skills unavailable"],
    });

    const res = await runCompleteCommand({
      run: runRoot,
      actor,
      "auth-token": "critic-pass-token",
    });

    expect(res.summary_warning).toBe("non-error summary crash");
    expect(String(res.markdown)).toContain("Release completion failed");

    completeSpy.mockRestore();
    summarySpy.mockRestore();
    pruneSpy.mockRestore();
    autoSyncSpy.mockRestore();
  });
});
