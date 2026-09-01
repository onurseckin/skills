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
  describe("1. Portfolio Tracks, Targets & Baseline Constants", () => {
    it("defines the 3 standard tracks and 70/20/10 target percentages", () => {
      expect(PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH).toBe("CORE_STABILITY_AND_POLISH");
      expect(PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION).toBe("ARCHITECTURAL_EVOLUTION");
      expect(PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS).toBe("EXPLORATORY_HORIZON_BETS");

      expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toBe(70);
      expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]).toBe(20);
      expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBe(10);

      expect(TIMIDITY_TRAP_MIN_WORKSTREAMS).toBe(3);
      expect(SPECULATIVE_OVERALLOCATION_THRESHOLD_PERCENT).toBe(15);
      expect(CORE_DEFICIT_THRESHOLD_PERCENT).toBe(55);
    });

    it("provides clear descriptive mandates for each track", () => {
      expect(TRACK_DESCRIPTIONS[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toContain(
        "Defect remediation",
      );
      expect(TRACK_DESCRIPTIONS[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]).toContain(
        "Subsystem refactoring",
      );
      expect(TRACK_DESCRIPTIONS[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toContain(
        "Transformative capabilities",
      );
    });

    it("defines standard 3-milestone names and descriptions", () => {
      expect(MILESTONE_NAMES.FEASIBILITY_PROTOTYPE).toBe("FEASIBILITY_PROTOTYPE");
      expect(MILESTONE_NAMES.STRESS_VALIDATION).toBe("STRESS_VALIDATION");
      expect(MILESTONE_NAMES.SYSTEM_INTEGRATION).toBe("SYSTEM_INTEGRATION");

      expect(MILESTONE_DEFINITIONS[1].name).toBe("FEASIBILITY_PROTOTYPE");
      expect(MILESTONE_DEFINITIONS[2].name).toBe("STRESS_VALIDATION");
      expect(MILESTONE_DEFINITIONS[3].name).toBe("SYSTEM_INTEGRATION");
    });
  });

  describe("2. Portfolio Balance Auditing & Trap Detections", () => {
    it("handles empty workstream list gracefully as BALANCED", () => {
      const manager = new InnovationPortfolioManager();
      const report = manager.auditPortfolioBalance([]);

      expect(report.totalWorkstreams).toBe(0);
      expect(report.totalAllocation).toBe(0);
      expect(report.status).toBe("BALANCED");
      expect(report.isBalanced).toBe(true);
      expect(report.rebalanceActions).toHaveLength(0);
    });

    it("validates a healthy, well-balanced 70/20/10 portfolio distribution", () => {
      const manager = new InnovationPortfolioManager();
      const workstreams: PortfolioWorkstream[] = [
        // 7 Core Stability workstreams (70%)
        { id: "c1", title: "Bug fix A", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c2", title: "Bug fix B", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c3", title: "Edge cases C", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c4", title: "UX polish D", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c5", title: "Doc accuracy E", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c6", title: "Regression test F", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c7", title: "Defect cleanup G", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        // 2 Architectural Evolution workstreams (20%)
        {
          id: "a1",
          title: "Refactor Subsystem 1",
          track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
        },
        {
          id: "a2",
          title: "Scale queue pipeline",
          track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
        },
        // 1 Exploratory Bet workstream (10%)
        {
          id: "e1",
          title: "Vector Index Kernel",
          track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
        },
      ];

      const report = manager.auditPortfolioBalance(workstreams);

      expect(report.totalWorkstreams).toBe(10);
      expect(report.distributionPercentages[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toBe(70);
      expect(report.distributionPercentages[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]).toBe(20);
      expect(report.distributionPercentages[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBe(10);
      expect(report.status).toBe("BALANCED");
      expect(report.isBalanced).toBe(true);
      expect(report.rebalanceActions).toHaveLength(0);
    });

    it("detects Timidity Trap when exploratory bets are 0% across >= 3 active workstreams", () => {
      const manager = new InnovationPortfolioManager();
      const workstreams: PortfolioWorkstream[] = [
        { id: "c1", title: "Defect fix 1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c2", title: "Defect fix 2", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c3", title: "Defect fix 3", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "a1", title: "Refactor router", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
      ];

      const report = manager.auditPortfolioBalance(workstreams);

      expect(report.totalWorkstreams).toBe(4);
      expect(report.distributionPercentages[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBe(0);
      expect(report.status).toBe("TIMIDITY_TRAP");
      expect(report.isBalanced).toBe(false);
      expect(report.rebalanceActions.length).toBeGreaterThan(0);

      const action = report.rebalanceActions[0]!;
      expect(action.fromTrack).toBe(PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH);
      expect(action.toTrack).toBe(PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS);
      expect(action.urgency).toBe("HIGH");
      expect(action.rationale).toContain("Timidity Trap detected");
    });

    it("detects Speculative Over-allocation when exploratory bets exceed 15%", () => {
      const manager = new InnovationPortfolioManager();
      const workstreams: PortfolioWorkstream[] = [
        { id: "c1", title: "Core 1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c2", title: "Core 2", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "a1", title: "Arch 1", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
        // 3 Exploratory bets out of 6 workstreams (50% exploratory)
        { id: "e1", title: "Radical Bet 1", track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS },
        { id: "e2", title: "Radical Bet 2", track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS },
        { id: "e3", title: "Radical Bet 3", track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS },
      ];

      const report = manager.auditPortfolioBalance(workstreams);

      expect(report.totalWorkstreams).toBe(6);
      expect(report.distributionPercentages[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBe(50);
      expect(report.status).toBe("SPECULATIVE_OVERALLOCATION");
      expect(report.isBalanced).toBe(false);

      const action = report.rebalanceActions[0]!;
      expect(action.fromTrack).toBe(PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS);
      expect(action.toTrack).toBe(PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH);
      expect(action.urgency).toBe("CRITICAL");
      expect(action.recommendedShiftPercent).toBe(40); // 50% - 10% target = 40%
    });

    it("detects Core Deficit when Core Stability allocation falls below 55%", () => {
      const manager = new InnovationPortfolioManager();
      const workstreams: PortfolioWorkstream[] = [
        // 3 Core Stability (30%)
        { id: "c1", title: "Core 1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c2", title: "Core 2", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c3", title: "Core 3", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        // 6 Architectural Evolution (60%)
        { id: "a1", title: "Arch 1", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
        { id: "a2", title: "Arch 2", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
        { id: "a3", title: "Arch 3", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
        { id: "a4", title: "Arch 4", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
        { id: "a5", title: "Arch 5", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
        { id: "a6", title: "Arch 6", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
        // 1 Exploratory Bet (10%)
        { id: "e1", title: "Bet 1", track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS },
      ];

      const report = manager.auditPortfolioBalance(workstreams);

      expect(report.distributionPercentages[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toBe(30);
      expect(report.status).toBe("CORE_DEFICIT");
      expect(report.isBalanced).toBe(false);

      const action = report.rebalanceActions[0]!;
      expect(action.toTrack).toBe(PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH);
      expect(action.recommendedShiftPercent).toBe(40); // 70% - 30% = 40%
    });

    it("respects dynamic allocationWeight values", () => {
      const manager = new InnovationPortfolioManager();
      const workstreams: PortfolioWorkstream[] = [
        {
          id: "c1",
          title: "Heavy Core Polish",
          track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
          allocationWeight: 7,
        },
        {
          id: "a1",
          title: "Medium Arch Refactor",
          track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
          allocationWeight: 2,
        },
        {
          id: "e1",
          title: "Lightweight Bet",
          track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
          allocationWeight: 1,
        },
      ];

      const report = manager.auditPortfolioBalance(workstreams);

      expect(report.totalAllocation).toBe(10);
      expect(report.distributionPercentages[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toBe(70);
      expect(report.distributionPercentages[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]).toBe(20);
      expect(report.distributionPercentages[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBe(10);
      expect(report.status).toBe("BALANCED");
    });
  });
});
