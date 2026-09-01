import { describe, expect, it } from "bun:test";
import {
  AntiPatternLedger,
  CORE_DEFICIT_THRESHOLD_PERCENT,
  InnovationPortfolioManager,
  MILESTONE_DEFINITIONS,
  MILESTONE_NAMES,
  PORTFOLIO_TARGET_PERCENTAGES,
  PORTFOLIO_TRACKS,
  SPECULATIVE_OVERALLOCATION_THRESHOLD_PERCENT,
  TIMIDITY_TRAP_MIN_WORKSTREAMS,
  TRACK_DESCRIPTIONS,
  type AntiPatternEntry,
  type BetBudget,
  type CreateAntiPatternInput,
  type CreateBetInput,
  type ExploratoryBet,
  type GraduationCertificate,
  type MilestoneEvaluationResult,
  type MilestoneNumber,
  type MilestoneValidationInput,
  type PortfolioBalanceReport,
  type PortfolioBalanceStatus,
  type PortfolioTrack,
  type PortfolioWorkstream,
  type RebalanceAction,
} from "../../../olt/scripts/src/mind/planning/innovation-portfolio.ts";

describe("70/20/10 Innovation Portfolio Governance & 3-Milestone Gates Suite", () => {
describe("5. Graduation Protocol into Core / Architectural Tracks", () => {
    it("graduates bet upon completing Milestone 3, issues GraduationCertificate, and transitions workstream", () => {
      const manager = new InnovationPortfolioManager();
      const bet = manager.registerBet({
        title: "Tier 1 Bedrock Invariant Store",
        falsifiableHypothesis: "Immutable append-only ledger prevents causal drift by 100%",
        valueProposition: "Absolute causal integrity",
        targetGraduationTrack: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
      });

      // Pass M1
      manager.evaluateMilestone(bet.id, 1, {
        passed: true,
        evidence: "POC validated in unit test harness",
        spentBudget: 300,
      });

      // Pass M2
      manager.evaluateMilestone(bet.id, 2, {
        passed: true,
        evidence: "Stress tested under 1M concurrent transactions",
        spentBudget: 400,
      });

      // Pass M3 (System Integration) -> Graduation!
      const res3: MilestoneEvaluationResult = manager.evaluateMilestone(bet.id, 3, {
        passed: true,
        evidence: "Clean end-to-end integration across entire compiler and scheduler pipeline",
        spentBudget: 300,
        targetGraduationTrack: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
        productionRolloutPlan: "Stage 1: Canary in test runner. Stage 2: Promote to core bedrock.",
      });

      expect(res3.passed).toBe(true);
      expect(res3.newStatus).toBe("GRADUATED");
      expect(res3.graduationCertificate).toBeDefined();

      const cert: GraduationCertificate = res3.graduationCertificate!;
      expect(cert.betId).toBe(bet.id);
      expect(cert.title).toBe("Tier 1 Bedrock Invariant Store");
      expect(cert.targetRolloutTrack).toBe(PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH);
      expect(cert.milestoneSummary).toHaveLength(3);
      expect(cert.signature).toBeDefined();

      const graduatedBet = manager.getBet(bet.id)!;
      expect(graduatedBet.status).toBe("GRADUATED");
      expect(graduatedBet.graduationCertificate).toBeDefined();

      // Verify workstream is now in CORE_STABILITY_AND_POLISH with [Graduated] prefix
      const workstream = manager.getWorkstreams().find((w) => w.betId === bet.id)!;
      expect(workstream.track).toBe(PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH);
      expect(workstream.title).toContain("[Graduated]");
      expect(workstream.status).toBe("ACTIVE");

      // Cannot re-evaluate already graduated bet
      expect(() => {
        manager.evaluateMilestone(bet.id, 3, { passed: true, evidence: "Duplicate" });
      }).toThrow("already graduated");
    });
  });
});
