import { describe, expect, it } from "bun:test";
import {
  evaluateInitiativeTriggers,
  advanceProposalWithInitiative,
  formatProposalBrief,
  formatPlanRevisionBrief,
} from "../../../olt/scripts/src/mind/proposals/proposal/brief.ts";
import { recordProposalInState } from "../../../olt/scripts/src/mind/proposals/proposal/creation.ts";
import type {
  InitiativeEvaluationInput,
  MindProposal,
  PlanRevisionProposal,
} from "../../../olt/scripts/src/mind/proposals/proposal/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Mind Proposal Brief Module", () => {
  const makeProposal = (overrides: Partial<MindProposal> = {}): MindProposal => ({
    id: "prop-101",
    kind: "proposal",
    statement: "Refactor auth middleware to use JWT verify",
    rationale: "Improves auth latency and simplifies session tokens",
    charter_goal_ids: ["G-AUTH-1"],
    write_scope: ["src/auth/middleware.ts"],
    status: "proposed",
    requirement_id: "req-auth-101",
    created_at: "2026-09-01T12:00:00.000Z",
    ...overrides,
  });

  describe("evaluateInitiativeTriggers", () => {
    it("qualifies proposal for autonomous admission when all safety criteria are met", () => {
      const proposal = makeProposal();
      const input: InitiativeEvaluationInput = {
        proposal,
        confidenceScore: 0.92,
        repoRoots: ["src/auth"],
      };
      const result = evaluateInitiativeTriggers(input);
      expect(result.canAdvanceAutonomously).toBe(true);
      expect(result.action).toBe("AUTONOMOUS_ADMIT");
      expect(result.reason).toContain("Autonomous initiative trigger qualified");
      expect(result.reason).toContain("92.0% >= 85.0%");
      expect(result.triggerId).toMatch(/^init-trig-[0-9a-f]{8}$/);
      expect(result.safetyChecks).toEqual({
        withinRepoRoots: true,
        avoidsProhibitions: true,
        charterAligned: true,
        confidenceThresholdMet: true,
        notDeclined: true,
      });
    });

    it("uses custom confidenceThreshold when specified", () => {
      const proposal = makeProposal();
      const result = evaluateInitiativeTriggers({
        proposal,
        confidenceScore: 0.75,
        confidenceThreshold: 0.7,
      });
      expect(result.canAdvanceAutonomously).toBe(true);
      expect(result.action).toBe("AUTONOMOUS_ADMIT");
      expect(result.reason).toContain("75.0% >= 70.0%");
    });

    it("rejects proposal when statement matches built-in destructive keywords", () => {
      const destructiveStatements = [
        "Run git push origin main forcefully",
        "Execute rm -rf /tmp/build cache",
        "Action to delete database tables",
        "Action to drop table users",
        "Step to publish package to registry",
        "Attempt to modify charter governance",
      ];
      for (const statement of destructiveStatements) {
        const proposal = makeProposal({ statement });
        const result = evaluateInitiativeTriggers({ proposal, confidenceScore: 0.95 });
        expect(result.canAdvanceAutonomously).toBe(false);
        expect(result.action).toBe("REQUIRES_HUMAN_AUTHORITY");
        expect(result.reason).toBe(
          "Proposal involves potentially sensitive or prohibited actions; mandatory human authority required",
        );
        expect(result.safetyChecks.avoidsProhibitions).toBe(false);
      }
    });

    it("rejects proposal when statement matches custom charterProhibitions", () => {
      const proposal = makeProposal({ statement: "Execute sudo reboot cluster" });
      const input: InitiativeEvaluationInput = {
        proposal,
        confidenceScore: 0.99,
        charterProhibitions: ["sudo reboot", "disable telemetry"],
      };
      const result = evaluateInitiativeTriggers(input);
      expect(result.canAdvanceAutonomously).toBe(false);
      expect(result.safetyChecks.avoidsProhibitions).toBe(false);
      expect(result.action).toBe("REQUIRES_HUMAN_AUTHORITY");
    });

    it("rejects proposal when conflicting declined proposal exists in state", () => {
      const state: Record<string, unknown> = {
        candidates: [
          {
            id: "cand-declined-1",
            statement: "Refactor auth middleware to use JWT verify",
            status: "declined",
            decline_reason: "Security concerns",
          },
        ],
      };
      const result = evaluateInitiativeTriggers(
        { proposal: makeProposal(), confidenceScore: 0.95 },
        state,
      );
      expect(result.canAdvanceAutonomously).toBe(false);
      expect(result.safetyChecks.notDeclined).toBe(false);
      expect(result.reason).toBe(
        "Proposal matches a previously declined proposal; cannot advance autonomously",
      );
    });

    it("rejects proposal when confidence score is below threshold", () => {
      const result = evaluateInitiativeTriggers({
        proposal: makeProposal(),
        confidenceScore: 0.8,
        confidenceThreshold: 0.85,
      });
      expect(result.canAdvanceAutonomously).toBe(false);
      expect(result.safetyChecks.confidenceThresholdMet).toBe(false);
      expect(result.reason).toBe("Initiative confidence 80.0% is below autonomous threshold 85.0%");
    });

    it("falls back to generic human authority reason when unaligned with charter or outside repo roots", () => {
      const res1 = evaluateInitiativeTriggers({
        proposal: makeProposal({ charter_goal_ids: [] }),
        confidenceScore: 0.95,
      });
      expect(res1.canAdvanceAutonomously).toBe(false);
      expect(res1.safetyChecks.charterAligned).toBe(false);
      expect(res1.reason).toBe("Requires human authority decision");

      const res2 = evaluateInitiativeTriggers({
        proposal: makeProposal({ write_scope: ["/etc/hosts"] }),
        confidenceScore: 0.95,
        repoRoots: ["src/app"],
      });
      expect(res2.canAdvanceAutonomously).toBe(false);
      expect(res2.safetyChecks.withinRepoRoots).toBe(false);
      expect(res2.reason).toBe("Requires human authority decision");
    });
  });

  describe("advanceProposalWithInitiative", () => {
    it("throws HarnessError with INVALID_STATE when evaluation cannot advance autonomously", () => {
      const state: Record<string, unknown> = {};
      const evalFail = evaluateInitiativeTriggers({
        proposal: makeProposal(),
        confidenceScore: 0.5,
      });
      expect(() =>
        advanceProposalWithInitiative(state, "prop-101", "actor-test", evalFail),
      ).toThrow(HarnessError);
      expect(() =>
        advanceProposalWithInitiative(state, "prop-101", "actor-test", evalFail),
      ).toThrow(/cannot advance proposal with initiative/);
    });

    it("transitions proposal to admitted status with autonomous initiative witness when evaluation passes", () => {
      const state: Record<string, unknown> = {
        budget: { proposal_interval_ms: 0, max_open_proposals: 10 },
      };
      const initial = recordProposalInState(state, {
        id: "prop-adv-1",
        statement: "Implement rate limiter",
        rationale: "Prevent API abuse",
        charter_goal_ids: ["G-API"],
        write_scope: ["src/rate-limit.ts"],
        actor: "proposer",
      });
      expect(initial.status).toBe("needs_authority");

      const evalPass = evaluateInitiativeTriggers({ proposal: initial, confidenceScore: 0.95 });
      const advanced = advanceProposalWithInitiative(
        state,
        "prop-adv-1",
        "auto-admitter",
        evalPass,
      );

      expect(advanced.status).toBe("admitted");
      expect(advanced.decided_by).toBe("auto-admitter");
      expect(advanced.witness).toContain("autonomous-initiative:init-trig-");
      expect(advanced.witness_command_id).toBe(advanced.witness);
      expect(advanced.rationale).toBe("Prevent API abuse");
    });
  });

  describe("formatProposalBrief", () => {
    it("formats minimal, decided, declined, and autonomous initiative proposals", () => {
      const bMin = formatProposalBrief(makeProposal());
      expect(bMin).toContain("### Proposal: `prop-101`");
      expect(bMin).toContain("- **Status**: PROPOSED");

      const bDec = formatProposalBrief(
        makeProposal({
          charter_goal_ids: ["G1", "G2"],
          decided_by: "arch",
          decided_at: "2026-09-01T14:30:00.000Z",
          witness: "wit-42",
        }),
      );
      expect(bDec).toContain("- **Charter Goals**: G1, G2");
      expect(bDec).toContain("- **Witness**: wit-42");

      const bDec2 = formatProposalBrief(
        makeProposal({ status: "declined", decline_reason: "Out of scope" }),
      );
      expect(bDec2).toContain("- **Status**: DECLINED");
      expect(bDec2).toContain("- **Decline Reason**: Out of scope");

      const bAuto = formatProposalBrief(
        makeProposal({
          autonomous_initiative: true,
          initiative_trigger_id: "trig-1",
          initiative_score: 0.94,
        }),
      );
      expect(bAuto).toContain("- **Autonomous Initiative**: Trigger `trig-1` (Score: 0.94)");

      const bAutoNoScore = formatProposalBrief(
        makeProposal({ autonomous_initiative: true, initiative_trigger_id: "trig-2" }),
      );
      expect(bAutoNoScore).toContain("- **Autonomous Initiative**: Trigger `trig-2` (Score: N/A)");
    });
  });

  describe("formatPlanRevisionBrief", () => {
    it("formats revision with and without generated subtasks", () => {
      const rev1: PlanRevisionProposal = {
        id: "rev-001",
        revisionType: "COORDINATOR_REORGANIZATION",
        signal: {
          signalType: "COGNITIVE_OVERLOAD",
          source: "telemetry",
          evidence: "Queue > 100",
          severity: "HIGH",
        },
        confidenceScore: 0.88,
        autonomousAdvancementEligible: true,
        proposedChanges: { summary: "Rebalance" },
        createdAt: "2026-09-01T12:00:00.000Z",
      };
      const b1 = formatPlanRevisionBrief(rev1);
      expect(b1).toContain("### Plan Revision: `rev-001`");
      expect(b1).toContain("- **Autonomous Eligible**: YES");

      const rev2: PlanRevisionProposal = {
        id: "rev-002",
        revisionType: "TASK_SPLIT",
        signal: {
          signalType: "TEST_REGRESSION",
          source: "ci",
          evidence: "Regression",
          severity: "CRITICAL",
        },
        confidenceScore: 0.65,
        autonomousAdvancementEligible: false,
        proposedChanges: {
          summary: "Split",
          newTasks: [
            { id: "t1", label: "Task 1", priority: "CRITICAL" },
            { id: "t2", label: "Task 2" },
          ],
        },
        createdAt: "2026-09-01T12:00:00.000Z",
      };
      const b2 = formatPlanRevisionBrief(rev2);
      expect(b2).toContain("- **Autonomous Eligible**: NO");
      expect(b2).toContain("- **t1**: Task 1 (CRITICAL)");
      expect(b2).toContain("- **t2**: Task 2 (MEDIUM)");
    });
  });
});
