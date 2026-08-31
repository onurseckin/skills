import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertZeroMainThreadSpillover,
  enforceZeroMainThreadSpillover,
  executeBackgroundFinalization,
  planSupervisionLoopRecycle,
  SupervisionLoopRunner,
  transitionSupervisionLoopToDiscovery,
} from "../../../olt/scripts/src/orchestrator/supervision-loop.ts";
import type {
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
} from "../../../olt/scripts/src/orchestrator/types.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { createMockGitRunner, createMockSyncRunner } from "./fixture.ts";

describe("Zero Main-Thread Spillover Invariants", () => {
  it("strictly enforces zero spillover: rejects execution on interactive main thread", async () => {
    const testDir = scratchRoot(import.meta.path, "spillover-main-thread");

    expect(
      executeBackgroundFinalization({
        repoPath: testDir,
        isMainThread: true,
      }),
    ).rejects.toThrow(HarnessError);
  });

  it("strictly enforces role tier: rejects execution by non-orchestrator tier (Tier 2)", async () => {
    const testDir = scratchRoot(import.meta.path, "spillover-tier-2");

    expect(
      executeBackgroundFinalization({
        repoPath: testDir,
        executionTier: 2,
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
    expect(syncCommands).toEqual(["bun scripts/sync/index.ts"]);
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
