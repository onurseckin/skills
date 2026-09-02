import { describe, expect, it } from "bun:test";
import {
  generatePlanRevisionFromSignals,
  applyPlanRevisionInState,
} from "../../../olt/scripts/src/mind/proposals/proposal/reconcile.ts";
import { recordProposalInState } from "../../../olt/scripts/src/mind/proposals/proposal/creation.ts";
import type {
  PlanRevisionSignal,
  PlanRevisionProposal,
} from "../../../olt/scripts/src/mind/proposals/proposal/types.ts";

describe("Mind Proposal Reconcile Module", () => {
  const makeSignal = (overrides: Partial<PlanRevisionSignal> = {}): PlanRevisionSignal => ({
    signalType: "TEST_REGRESSION",
    source: "unit-tests",
    evidence: "Flaky test in router",
    charterGoalId: "G1",
    severity: "HIGH",
    affectedWriteScopes: ["src/router.ts"],
    ...overrides,
  });

  describe("generatePlanRevisionFromSignals", () => {
    it("returns empty array when signals list is empty", () => {
      const revisions = generatePlanRevisionFromSignals([]);
      expect(revisions).toHaveLength(0);
    });

    it("generates TASK_SPLIT revision with 2 subtasks for TEST_REGRESSION signal", () => {
      const signal = makeSignal({ signalType: "TEST_REGRESSION" });
      const [rev] = generatePlanRevisionFromSignals([signal], { now: "2026-09-01T12:00:00.000Z" });
      expect(rev).toBeDefined();
      expect(rev?.revisionType).toBe("TASK_SPLIT");
      expect(rev?.autonomousAdvancementEligible).toBe(true);
      expect(rev?.proposedChanges.newTasks).toHaveLength(2);
      expect(rev?.proposedChanges.newTasks?.[0]?.priority).toBe("CRITICAL");
      expect(rev?.proposedChanges.newTasks?.[1]?.priority).toBe("HIGH");
      expect(rev?.createdAt).toBe("2026-09-01T12:00:00.000Z");
    });

    it("generates COORDINATOR_REORGANIZATION revision for COGNITIVE_OVERLOAD and ORCHESTRATOR_BOTTLENECK", () => {
      const s1 = makeSignal({ signalType: "COGNITIVE_OVERLOAD" });
      const s2 = makeSignal({ signalType: "ORCHESTRATOR_BOTTLENECK" });
      const revisions = generatePlanRevisionFromSignals([s1, s2]);
      expect(revisions).toHaveLength(2);
      expect(revisions[0]?.revisionType).toBe("COORDINATOR_REORGANIZATION");
      expect(revisions[0]?.proposedChanges.recommendedCoordinators).toBe(2);
      expect(revisions[1]?.revisionType).toBe("COORDINATOR_REORGANIZATION");
      expect(revisions[1]?.proposedChanges.recommendedCoordinators).toBe(2);
    });

    it("generates PRIORITY_ESCALATION and SCOPE_REFINEMENT revisions", () => {
      const s1 = makeSignal({ signalType: "DEFECT_SURGE", severity: "CRITICAL" });
      const s2 = makeSignal({ signalType: "SCOPE_COLLISION" });
      const revisions = generatePlanRevisionFromSignals([s1, s2]);
      expect(revisions[0]?.revisionType).toBe("PRIORITY_ESCALATION");
      expect(revisions[0]?.proposedChanges.newPriority).toBe("CRITICAL");
      expect(revisions[1]?.revisionType).toBe("SCOPE_REFINEMENT");
    });

    it("generates NEW_EVOLUTION_BRANCH for QUIESCENCE_EVOLUTION, DORMANT_CRITERIA, and fallback signals", () => {
      const s1 = makeSignal({ signalType: "QUIESCENCE_EVOLUTION", severity: "CRITICAL" });
      const s2 = makeSignal({ signalType: "DORMANT_CRITERIA", severity: "LOW" });
      const s3 = makeSignal({ signalType: "PERFORMANCE_DEGRADATION" as any });
      const s4 = makeSignal({ signalType: "UNKNOWN_SIGNAL" as any });

      const revisions = generatePlanRevisionFromSignals([s1, s2, s3, s4]);
      expect(revisions).toHaveLength(4);
      for (const rev of revisions) {
        expect(rev.revisionType).toBe("NEW_EVOLUTION_BRANCH");
        expect(rev.proposedChanges.newTasks).toHaveLength(1);
      }
      expect(revisions[0]?.proposedChanges.newTasks?.[0]?.priority).toBe("CRITICAL");
      expect(revisions[1]?.proposedChanges.newTasks?.[0]?.priority).toBe("HIGH");
    });

    it("falls back to baseWriteScope or default when signal has empty affectedWriteScopes", () => {
      const s1 = makeSignal({ affectedWriteScopes: [] });
      const [rev1] = generatePlanRevisionFromSignals([s1], { baseWriteScope: ["custom/scope"] });
      expect(rev1?.proposedChanges.revisedWriteScopes).toEqual(["custom/scope"]);

      const [rev2] = generatePlanRevisionFromSignals([s1]);
      expect(rev2?.proposedChanges.revisedWriteScopes).toEqual(["olt/scripts/src/mind"]);
    });

    it("respects high confidenceThreshold rendering revision ineligible for autonomous advancement", () => {
      const s1 = makeSignal({ signalType: "COGNITIVE_OVERLOAD" });
      const [rev] = generatePlanRevisionFromSignals([s1], { confidenceThreshold: 0.99 });
      expect(rev?.autonomousAdvancementEligible).toBe(false);
    });

    it("respects maxRevisionsPerSignal ceiling", () => {
      const s1 = makeSignal({ signalType: "TEST_REGRESSION" });
      const revisions = generatePlanRevisionFromSignals([s1], { maxRevisionsPerSignal: 1 });
      expect(revisions.length).toBeLessThanOrEqual(1);
    });
  });

  describe("applyPlanRevisionInState", () => {
    it("synthesizes new candidate proposals in state when revision contains newTasks", () => {
      const state: Record<string, unknown> = {
        budget: { proposal_interval_ms: 0, max_open_proposals: 100 },
        candidates: [],
        requirements: [],
      };
      const signal = makeSignal({ signalType: "TEST_REGRESSION" });
      const [revision] = generatePlanRevisionFromSignals([signal]);

      const result = applyPlanRevisionInState(state, revision!, "agent-executor");
      expect(result.applied).toBe(true);
      expect(result.createdProposals).toHaveLength(2);
      expect(result.createdProposals[0]?.autonomous_initiative).toBe(true);
      expect(result.summary).toContain("generated 2 task proposal(s)");
      expect(state.candidates as unknown[]).toHaveLength(2);
    });

    it("applies revision without newTasks and returns empty createdProposals", () => {
      const state: Record<string, unknown> = {};
      const signal = makeSignal({ signalType: "SCOPE_COLLISION" });
      const [revision] = generatePlanRevisionFromSignals([signal]);

      const result = applyPlanRevisionInState(state, revision!, "agent-executor");
      expect(result.applied).toBe(true);
      expect(result.createdProposals).toHaveLength(0);
      expect(result.summary).toContain("generated 0 task proposal(s)");
    });

    it("updates target proposal status to revised when targetProposalId matches an existing proposal", () => {
      const state: Record<string, unknown> = {
        budget: { proposal_interval_ms: 0, max_open_proposals: 100 },
      };
      const existingProposal = recordProposalInState(state, {
        id: "cand-target-1",
        statement: "Original proposal statement",
        rationale: "Original rationale",
        charter_goal_ids: ["G1"],
        write_scope: ["src/a.ts"],
        actor: "author",
        autonomousInitiative: true,
      });

      expect(existingProposal.status).toBe("admitted");

      const signal = makeSignal({ signalType: "SCOPE_COLLISION" });
      const [baseRevision] = generatePlanRevisionFromSignals([signal]);
      const revisionWithTarget: PlanRevisionProposal = {
        ...baseRevision!,
        targetProposalId: "cand-target-1",
      };

      const result = applyPlanRevisionInState(state, revisionWithTarget, "reviewer");
      expect(result.applied).toBe(true);
      expect(result.updatedProposal).toBeDefined();
      expect(result.updatedProposal?.id).toBe("cand-target-1");
      expect(result.updatedProposal?.status).toBe("revised");
      expect(result.updatedProposal?.revision_count).toBe(1);
    });

    it("handles non-existent targetProposalId gracefully leaving updatedProposal undefined", () => {
      const state: Record<string, unknown> = {};
      const signal = makeSignal({ signalType: "SCOPE_COLLISION" });
      const [baseRevision] = generatePlanRevisionFromSignals([signal]);
      const revisionWithTarget: PlanRevisionProposal = {
        ...baseRevision!,
        targetProposalId: "cand-non-existent",
      };

      const result = applyPlanRevisionInState(state, revisionWithTarget, "reviewer");
      expect(result.applied).toBe(true);
      expect(result.updatedProposal).toBeUndefined();
    });
  });
});
