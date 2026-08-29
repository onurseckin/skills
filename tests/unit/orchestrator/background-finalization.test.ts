import { describe, expect, it, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertZeroMainThreadSpillover,
  enforceZeroMainThreadSpillover,
  executeBackgroundFinalization,
  formatBackgroundFinalizationBrief,
  planSupervisionLoopRecycle,
  SupervisionLoopRunner,
  transitionSupervisionLoopToDiscovery,
  type BackgroundFinalizationOptions,
  type GitRunner,
  type GitRunnerResult,
  type SyncRunner,
} from "../../../olt/scripts/src/orchestrator/supervision-loop.ts";
import type {
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
} from "../../../olt/scripts/src/orchestrator/types.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function createMockGitRunner(
  responses: {
    readonly statusOutput?: string;
    readonly commitSha?: string;
    readonly addStatus?: number;
    readonly commitStatus?: number;
    readonly pushStatus?: number;
    readonly addError?: string;
    readonly commitError?: string;
    readonly pushError?: string;
  } = {},
): {
  readonly runner: GitRunner;
  readonly commands: string[][];
} {
  const commands: string[][] = [];
  const runner: GitRunner = (args: readonly string[], _cwd: string): GitRunnerResult => {
    commands.push([...args]);
    const cmd = args[0];
    if (cmd === "add") {
      return {
        status: responses.addStatus ?? 0,
        stdout: "",
        stderr: responses.addError ?? "",
      };
    }
    if (cmd === "status") {
      return {
        status: 0,
        stdout: responses.statusOutput ?? " M src/index.ts\n",
        stderr: "",
      };
    }
    if (cmd === "commit") {
      return {
        status: responses.commitStatus ?? 0,
        stdout: "[main 1234567] feat: commit",
        stderr: responses.commitError ?? "",
      };
    }
    if (cmd === "rev-parse") {
      return {
        status: 0,
        stdout: responses.commitSha ?? "9876543210abcdef",
        stderr: "",
      };
    }
    if (cmd === "push") {
      return {
        status: responses.pushStatus ?? 0,
        stdout: "To github.com:org/repo.git",
        stderr: responses.pushError ?? "",
      };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { runner, commands };
}

function createMockSyncRunner(
  responses: {
    readonly status?: number;
    readonly error?: string;
  } = {},
): {
  readonly runner: SyncRunner;
  readonly commands: string[];
} {
  const commands: string[] = [];
  const runner: SyncRunner = (command: string, _cwd: string): GitRunnerResult => {
    commands.push(command);
    return {
      status: responses.status ?? 0,
      stdout: "✓ Global skill sync complete",
      stderr: responses.error ?? "",
    };
  };
  return { runner, commands };
}

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
      syncCommand: "bun scripts/sync-global.ts",
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

    expect(syncCommands).toEqual(["bun scripts/sync-global.ts"]);
    expect(result.markdown).toContain("Tier 1 Background Orchestrator Finalization");
    expect(result.markdown).toContain("✓ Verified (0 spillover)");
    expect(result.markdown).toContain("✓ Committed");
    expect(result.markdown).toContain("✓ Pushed to upstream");
    expect(result.markdown).toContain("✓ Synced (`~/.agents/skills`)");
  });

  it("skips commit when working tree is already clean but still pushes and syncs", async () => {
    const testDir = scratchRoot(import.meta.path, "lifecycle-clean-tree");
    const { runner: gitRunner, commands: gitCommands } = createMockGitRunner({
      statusOutput: "", // Clean tree
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
    expect(syncCommands).toEqual(["bun scripts/sync-global.ts"]);
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

describe("Zero Main-Thread Spillover Invariants", () => {
  it("strictly enforces zero spillover: rejects execution on interactive main thread", async () => {
    const testDir = scratchRoot(import.meta.path, "spillover-main-thread");

    expect(
      executeBackgroundFinalization({
        repoPath: testDir,
        isMainThread: true, // Violation!
      }),
    ).rejects.toThrow(HarnessError);
  });

  it("strictly enforces role tier: rejects execution by non-orchestrator tier (Tier 2)", async () => {
    const testDir = scratchRoot(import.meta.path, "spillover-tier-2");

    expect(
      executeBackgroundFinalization({
        repoPath: testDir,
        executionTier: 2, // Violation! Tier 2 coordinator may not finalize
      }),
    ).rejects.toThrow(HarnessError);
  });

  it("enforceZeroMainThreadSpillover reports detailed compliance and violation states", () => {
    const compliant = enforceZeroMainThreadSpillover({
      executionTier: 1,
      isMainThread: false,
      finalizationComplete: true,
      gitOperationsEnclosed: true,
    });
    expect(compliant.compliant).toBe(true);
    expect(compliant.mainThreadSpillover).toBe(false);
    expect(compliant.executedInBackground).toBe(true);

    const mainSpillover = enforceZeroMainThreadSpillover({
      executionTier: 1,
      isMainThread: true,
      finalizationComplete: true,
    });
    expect(mainSpillover.compliant).toBe(false);
    expect(mainSpillover.mainThreadSpillover).toBe(true);
    expect(mainSpillover.message).toContain("main interactive thread");

    const tierViolation = enforceZeroMainThreadSpillover({
      executionTier: 3,
      isMainThread: false,
      finalizationComplete: true,
    });
    expect(tierViolation.compliant).toBe(false);
    expect(tierViolation.message).toContain("non-orchestrator tier 3");
  });

  it("assertZeroMainThreadSpillover throws HarnessError INTEGRITY on violation", () => {
    const violation = enforceZeroMainThreadSpillover({
      executionTier: 2,
      isMainThread: false,
    });

    expect(() => assertZeroMainThreadSpillover(violation)).toThrow(HarnessError);
  });
});

describe("Autonomous Loop Recycling Transition", () => {
  it("refuses a missing explicit run instead of fabricating a discovery wake", () => {
    expect(() =>
      transitionSupervisionLoopToDiscovery({
        runRoot: "/definitely-missing-continuation-run",
        actor: "orchestrator-tier1",
      }),
    ).toThrow(HarnessError);
  });

  it("marks finalization unsuccessful when an explicit recycling state source cannot load", async () => {
    const testDir = scratchRoot(import.meta.path, "finalization-unavailable-state");
    const { runner: gitRunner } = createMockGitRunner();
    const { runner: syncRunner } = createMockSyncRunner();
    const result = await executeBackgroundFinalization({
      repoPath: testDir,
      runRoot: "/definitely-missing-finalization-run",
      gitRunner,
      syncRunner,
    });
    expect(result.success).toBeFalse();
    expect(result.error).toContain("recycling assessment unavailable");
    expect(result.recyclingAssessment).toBeUndefined();

    await expect(
      executeBackgroundFinalization({
        repoPath: testDir,
        runRoot: "/definitely-missing-finalization-run",
        gitRunner,
        syncRunner,
        throwOnError: true,
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY" });
  });

  it("does not invent critic sign-off or a recycling assessment without a state source", async () => {
    const testDir = scratchRoot(import.meta.path, "finalization-state-free");
    const { runner: gitRunner } = createMockGitRunner();
    const { runner: syncRunner } = createMockSyncRunner();
    const result = await executeBackgroundFinalization({
      repoPath: testDir,
      gitRunner,
      syncRunner,
    });
    expect(result.success).toBeTrue();
    expect(result.recyclingAssessment).toBeUndefined();
    expect(result.markdown).not.toContain("Autonomous Recycling");
  });

  it("transitions completeness critic sign-off to admitted candidate round opening", async () => {
    const testDir = scratchRoot(import.meta.path, "recycling-admitted");
    const charterBytes = new TextEncoder().encode("# Charter\n## goals\n- G1");
    const run = initRun(testDir, "recycle-run-1", charterBytes, "file", true);

    transact(run, "critic-1", "review-complete", {}, (draft) => {
      draft.completion_review = {
        status: "clean",
        summary: "Critic sign-off complete.",
      };
      const draftMind = (draft.mind ?? {}) as Record<string, unknown>;
      draftMind.candidates = [
        {
          id: "cand-wave-2",
          kind: "defect",
          statement: "Autonomous wave 2 defect repair",
          status: "admitted",
        },
      ];
      draft.mind = draftMind;
    });

    const assessment = transitionSupervisionLoopToDiscovery({
      runRoot: run,
      actor: "orchestrator-tier1",
    });

    expect(assessment.canRecycle).toBe(true);
    expect(assessment.phase).toBe("critic_signed_off");
    expect(assessment.transition).toBe("candidate_to_planning");
    expect(assessment.candidateId).toBe("cand-wave-2");
    expect(assessment.nextRecommendedCommand).toContain("mind:round-open");
    expect(assessment.infiniteCadence).toBe(true);
  });

  it("transitions completeness critic sign-off to candidate discovery when no candidates are admitted", async () => {
    const testDir = scratchRoot(import.meta.path, "recycling-discovery");
    const charterBytes = new TextEncoder().encode("# Charter\n## goals\n- G1");
    const run = initRun(testDir, "recycle-run-2", charterBytes, "file", true);

    transact(run, "critic-1", "review-complete", {}, (draft) => {
      draft.completion_review = {
        status: "clean",
        summary: "Critic sign-off clean.",
      };
    });

    const assessment = transitionSupervisionLoopToDiscovery({
      runRoot: run,
      actor: "orchestrator-tier1",
    });

    expect(assessment.canRecycle).toBe(true);
    expect(assessment.phase).toBe("critic_signed_off");
    expect(assessment.transition).toBe("critic_to_discovery");
    expect(assessment.nextRecommendedCommand).toContain("mind:candidate");
    expect(assessment.infiniteCadence).toBe(true);
  });

  it("plans autonomous recycling cycle and formats clean brief", () => {
    const state: Record<string, unknown> = {
      completion_review: { status: "clean" },
      mind: {
        candidates: [
          {
            id: "cand-plan-1",
            kind: "defect",
            statement: "Repair issue in component",
            status: "admitted",
          },
        ],
      },
    };

    const plan = planSupervisionLoopRecycle(state, {
      runRoot: "/tmp/test-run",
      actor: "orchestrator-tier1",
    });

    expect(plan.transition).toBe("candidate_to_planning");
    expect(plan.candidateId).toBe("cand-plan-1");
    expect(plan.markdown).toContain("Autonomous Mind Recycler");
    expect(plan.markdown).toContain("infinite autonomous loop active");
  });
});

describe("SupervisionLoopRunner - Integrated Background Finalization & Recycling", () => {
  it("automatically triggers background finalization and autonomous recycling on convergence", async () => {
    const testDir = scratchRoot(import.meta.path, "supervision-loop-converge");
    const { runner: gitRunner, commands: gitCommands } = createMockGitRunner({
      commitSha: "sha-final-converge",
    });
    const { runner: syncRunner, commands: syncCommands } = createMockSyncRunner();

    const mockExecutor: RoundExecutor = {
      async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
        return {
          runId: input.runId,
          round: input.round,
          status: "completed",
          criticDecision: "approve",
          tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
          findings: [],
          gateResults: [{ gate_id: "gate-01", command_id: "cmd-1", status: "passed" }],
          summary: "All gates passed and Critic approved.",
        };
      },
    };

    let finalizationCaptured = false;

    const runner = new SupervisionLoopRunner({
      baseRunId: "run-supervise-converge",
      repoPath: testDir,
      initialPrompt: "Implement feature in background loop",
      executor: mockExecutor,
      gitRunner,
      syncRunner,
      onFinalizationComplete: (fin) => {
        finalizationCaptured = true;
        expect(fin.committed).toBe(true);
        expect(fin.pushed).toBe(true);
        expect(fin.synced).toBe(true);
      },
    });

    const summary = await runner.run();

    expect(summary.finalStatus).toBe("converged_success");
    expect(summary.zeroMainThreadSpillover).toBe(true);
    expect(summary.finalization).toBeDefined();
    expect(summary.finalization?.committed).toBe(true);
    expect(summary.finalization?.pushed).toBe(true);
    expect(summary.finalization?.synced).toBe(true);
    expect(summary.finalization?.commitSha).toBe("sha-final-converge");
    expect(summary.finalization?.success).toBeFalse();
    expect(summary.finalization?.error).toContain("recycling assessment unavailable");
    expect(summary.recyclingAssessment).toBeUndefined();
    expect(finalizationCaptured).toBe(true);

    expect(gitCommands.length).toBeGreaterThan(0);
    expect(syncCommands).toEqual(["bun scripts/sync-global.ts"]);
  });

  it("does NOT trigger background finalization if round does not converge (e.g. findings open)", async () => {
    const testDir = scratchRoot(import.meta.path, "supervision-loop-no-converge");
    const { runner: gitRunner, commands: gitCommands } = createMockGitRunner();
    const { runner: syncRunner, commands: syncCommands } = createMockSyncRunner();

    const mockExecutor: RoundExecutor = {
      async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
        return {
          runId: input.runId,
          round: input.round,
          status: "rejected",
          criticDecision: "request_changes",
          tasks: [{ id: "task-01", status: "changes_requested", writeScope: ["src/"] }],
          findings: [
            {
              id: "f-01",
              requirement_id: "req-1",
              severity: "critical",
              observation: "Bug found",
              evidence: [],
              remediation: "Fix bug",
              revalidation: "bun test",
              status: "open",
            },
          ],
          gateResults: [],
          summary: "Changes requested by Critic.",
        };
      },
    };

    const runner = new SupervisionLoopRunner({
      baseRunId: "run-supervise-no-converge",
      repoPath: testDir,
      initialPrompt: "Failing run",
      maxRounds: 1,
      executor: mockExecutor,
      gitRunner,
      syncRunner,
    });

    const summary = await runner.run();

    expect(summary.finalStatus).toBe("max_rounds_reached");
    expect(summary.finalization).toBeUndefined();
    expect(gitCommands).toEqual([]);
    expect(syncCommands).toEqual([]);
  });
});
