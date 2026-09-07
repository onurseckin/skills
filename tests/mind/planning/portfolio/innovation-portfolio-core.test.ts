import { describe, expect, it } from "bun:test";
import {
  PORTFOLIO_TRACKS,
  AntiPatternLedger,
  InnovationPortfolioManager,
  type PortfolioWorkstream,
  type ExploratoryBet,
} from "../../../../olt/scripts/src/mind/planning/index.ts";

describe("Innovation Portfolio Governance - InnovationPortfolioManager", () => {
  describe("InnovationPortfolioManager", () => {
    it("initializes with options, manages workstreams, and audits portfolio balance states", () => {
      const customLedger = new AntiPatternLedger();
      const initialWs: PortfolioWorkstream = {
        id: "ws-init-1",
        title: "Init WS",
        track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
      };
      const initialBet: ExploratoryBet = {
        id: "bet-init-1",
        title: "Init Bet",
        falsifiableHypothesis: "Init hypothesis",
        valueProposition: "Value",
        budget: { totalAllocated: 500, totalSpent: 0 },
        currentMilestone: 1,
        status: "ACTIVE",
        milestones: [],
        createdAt: "2026-08-20T00:00:00.000Z",
        updatedAt: "2026-08-20T00:00:00.000Z",
      };

      const manager = new InnovationPortfolioManager({
        initialWorkstreams: [initialWs],
        initialBets: [initialBet],
        antiPatternLedger: customLedger,
      });

      expect(manager.getAntiPatternLedger()).toBe(customLedger);
      expect(manager.getWorkstreams().length).toBe(1);
      expect(manager.getAllBets().length).toBe(1);
      expect(manager.getActiveBets().length).toBe(1);
      expect(manager.removeWorkstream("ws-init-1")).toBe(true);
      expect(manager.removeWorkstream("ws-missing")).toBe(false);

      const emptyReport = manager.auditPortfolioBalance([]);
      expect(emptyReport.totalWorkstreams).toBe(0);
      expect(emptyReport.isBalanced).toBe(true);
      expect(emptyReport.status).toBe("BALANCED");
      expect(manager.proposeRebalancePlan(emptyReport).length).toBe(0);

      const balancedReport = manager.auditPortfolioBalance([
        {
          id: "c1",
          title: "C1",
          track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
          allocationWeight: 7,
        },
        {
          id: "a1",
          title: "A1",
          track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
          allocationWeight: 2,
        },
        {
          id: "e1",
          title: "E1",
          track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
          allocationWeight: 1,
        },
      ]);
      expect(balancedReport.isBalanced).toBe(true);
      expect(balancedReport.status).toBe("BALANCED");

      const timidityReport = manager.auditPortfolioBalance([
        { id: "c1", title: "C1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c2", title: "C2", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "c3", title: "C3", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      ]);
      expect(timidityReport.status).toBe("TIMIDITY_TRAP");
      expect(timidityReport.rebalanceActions.length).toBe(1);

      const overAllocReport = manager.auditPortfolioBalance([
        { id: "c1", title: "C1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "e1", title: "E1", track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS },
      ]);
      expect(overAllocReport.status).toBe("SPECULATIVE_OVERALLOCATION");

      const deficitReportArch = manager.auditPortfolioBalance([
        {
          id: "c1",
          title: "C1",
          track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
          allocationWeight: 3,
        },
        {
          id: "a1",
          title: "A1",
          track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
          allocationWeight: 6,
        },
        {
          id: "e1",
          title: "E1",
          track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
          allocationWeight: 1,
        },
      ]);
      expect(deficitReportArch.status).toBe("CORE_DEFICIT");
      expect(deficitReportArch.rebalanceActions[0]?.fromTrack).toBe(
        PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
      );

      const pausedWsReport = manager.auditPortfolioBalance([
        {
          id: "p1",
          title: "Paused",
          track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
          status: "PAUSED",
        },
      ]);
      expect(pausedWsReport.totalWorkstreams).toBe(0);
    });

    it("registers bets with default options and evaluates 3 milestones to graduation", () => {
      const manager = new InnovationPortfolioManager();
      const bet = manager.registerBet({
        title: "Default Option Bet",
        falsifiableHypothesis: "Hypothesis with default options and criteria",
        valueProposition: "Value with defaults",
      });

      expect(bet.budget.totalAllocated).toBe(1000);
      expect(bet.targetGraduationTrack).toBe(PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION);

      const res1 = manager.evaluateMilestone(bet.id, 1, { passed: true, evidence: "m1 ok" });
      expect(res1.passed).toBe(true);

      const res2 = manager.evaluateMilestone(bet.id, 2, { passed: true, evidence: "m2 ok" });
      expect(res2.passed).toBe(true);

      manager.removeWorkstream(`ws-${bet.id}`);
      const res3 = manager.evaluateMilestone(bet.id, 3, {
        passed: true,
        evidence: "m3 ok",
        targetGraduationTrack: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
      });
      expect(res3.passed).toBe(true);
      expect(res3.newStatus).toBe("GRADUATED");
      expect(manager.getGraduationCertificates().length).toBe(1);
    });

    it("handles milestone failures, termination, and validation errors", () => {
      const manager = new InnovationPortfolioManager();
      const bet = manager.registerBet({
        title: "Failing Bet",
        falsifiableHypothesis: "Hypothesis will fail at stress",
        valueProposition: "Test failure handling",
        budget: {
          totalAllocated: 800,
          totalSpent: 50,
          currency: "USD",
          milestoneBudgets: { 1: 200 },
        },
      });

      expect(() =>
        manager.evaluateMilestone("non-existent", 1, { passed: true, evidence: "" }),
      ).toThrow("not found");
      expect(() => manager.evaluateMilestone(bet.id, 2, { passed: true, evidence: "" })).toThrow(
        "currently on milestone 1",
      );

      manager.removeWorkstream(`ws-${bet.id}`);
      const resFail = manager.evaluateMilestone(bet.id, 1, {
        passed: false,
        evidence: "Proof failed",
      });
      expect(resFail.passed).toBe(false);
      expect(resFail.newStatus).toBe("TERMINATED");
      expect(resFail.antiPatternEntry).toBeDefined();

      expect(() => manager.evaluateMilestone(bet.id, 1, { passed: true, evidence: "" })).toThrow(
        "terminated bet",
      );

      const gradMgr = new InnovationPortfolioManager();
      const gBet = gradMgr.registerBet({
        title: "G",
        falsifiableHypothesis: "H",
        valueProposition: "V",
      });
      gradMgr.evaluateMilestone(gBet.id, 1, { passed: true, evidence: "m1" });
      gradMgr.evaluateMilestone(gBet.id, 2, { passed: true, evidence: "m2" });
      gradMgr.evaluateMilestone(gBet.id, 3, { passed: true, evidence: "m3" });
      expect(() => gradMgr.evaluateMilestone(gBet.id, 3, { passed: true, evidence: "" })).toThrow(
        "already graduated",
      );
    });
  });
});
