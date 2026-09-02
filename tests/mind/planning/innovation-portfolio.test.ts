import { describe, expect, it } from "bun:test";
import {
  PORTFOLIO_TRACKS,
  PORTFOLIO_TARGET_PERCENTAGES,
  TRACK_DESCRIPTIONS,
  TIMIDITY_TRAP_MIN_WORKSTREAMS,
  SPECULATIVE_OVERALLOCATION_THRESHOLD_PERCENT,
  CORE_DEFICIT_THRESHOLD_PERCENT,
  MILESTONE_NAMES,
  MILESTONE_DEFINITIONS,
  AntiPatternLedger,
  InnovationPortfolioManager,
  type PortfolioWorkstream,
  type ExploratoryBet,
} from "../../../olt/scripts/src/mind/planning/innovation-portfolio.ts";

describe("Innovation Portfolio Governance & 3-Milestone Hypothesis Gates Suite", () => {
  it("verifies portfolio track constants, percentages, definitions, and trap thresholds", () => {
    expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toBe(70);
    expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]).toBe(20);
    expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBe(10);
    expect(TRACK_DESCRIPTIONS[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toBeDefined();
    expect(TRACK_DESCRIPTIONS[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]).toBeDefined();
    expect(TRACK_DESCRIPTIONS[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBeDefined();
    expect(TIMIDITY_TRAP_MIN_WORKSTREAMS).toBe(3);
    expect(SPECULATIVE_OVERALLOCATION_THRESHOLD_PERCENT).toBe(15);
    expect(CORE_DEFICIT_THRESHOLD_PERCENT).toBe(55);
    expect(MILESTONE_NAMES.FEASIBILITY_PROTOTYPE).toBe("FEASIBILITY_PROTOTYPE");
    expect(MILESTONE_DEFINITIONS[1].name).toBe("FEASIBILITY_PROTOTYPE");
    expect(MILESTONE_DEFINITIONS[2].name).toBe("STRESS_VALIDATION");
    expect(MILESTONE_DEFINITIONS[3].name).toBe("SYSTEM_INTEGRATION");
  });

  describe("AntiPatternLedger", () => {
    it("records, searches, prevents repetition, and serializes anti-patterns", () => {
      const ledger = new AntiPatternLedger();
      const entry1 = ledger.recordAntiPattern({
        betId: "b-1",
        betTitle: "Distributed DHT Mesh",
        falsifiedHypothesis: "Pure peer-to-peer gossip achieves <50ms consensus in churn networks",
        failedMilestone: 2,
        failedMilestoneName: "STRESS_VALIDATION",
        failureReason: "Split-brain partition under 10% packet drop",
        tags: ["p2p", "dht", "mesh"],
        topic: "P2P Networking",
      });

      const entry2 = ledger.recordAntiPattern({
        id: "custom-anti-2",
        betId: "b-2",
        betTitle: "Custom In-Memory Regex Compiler",
        falsifiedHypothesis: "Custom backtracking regex compiler outperforms v8 by 2x",
        failedMilestone: 1,
        failedMilestoneName: "FEASIBILITY_PROTOTYPE",
        failureReason: "ReDoS stack overflow",
        symptoms: ["Exponential stack explosion"],
        lessonsLearned: "Use Thompson NFA instead of recursive backtracking.",
        tags: ["regex", "compiler"],
      });

      expect(ledger.getEntry(entry1.id)).toBeDefined();
      expect(ledger.getEntry("non-existent")).toBeUndefined();
      expect(ledger.getEntryByBetId("b-1")?.id).toBe(entry1.id);
      expect(ledger.getEntryByBetId("missing-bet")).toBeUndefined();
      expect(ledger.getAllEntries().length).toBe(2);

      expect(ledger.searchByTopic("").length).toBe(0);
      expect(ledger.searchByTopic("Networking").length).toBe(1);
      expect(ledger.searchByTopic("None").length).toBe(0);

      expect(ledger.searchByTags([]).length).toBe(0);
      expect(ledger.searchByTags(["dht"]).length).toBe(1);
      expect(ledger.searchByTags(["unmatched"]).length).toBe(0);

      expect(ledger.searchByQuery("").length).toBe(0);
      expect(ledger.searchByQuery("split-brain").length).toBe(1);
      expect(ledger.searchByQuery("Thompson").length).toBe(1);
      expect(ledger.searchByQuery("P2P").length).toBe(1);
      expect(ledger.searchByQuery("mesh").length).toBe(1);
      expect(ledger.searchByQuery("unknown-query").length).toBe(0);

      const conflictExact = ledger.checkHypothesisConflict(
        "Pure peer-to-peer gossip achieves <50ms consensus in churn networks",
      );
      expect(conflictExact.hasConflict).toBe(true);
      expect(conflictExact.matchingEntries[0]?.preventedRepetitionsCount).toBe(1);

      const conflictSubstring = ledger.checkHypothesisConflict(
        "Custom backtracking regex compiler outperforms v8 by 2x in production",
      );
      expect(conflictSubstring.hasConflict).toBe(true);

      const conflictWords = ledger.checkHypothesisConflict(
        "Custom backtracking regex compiler is tested here",
      );
      expect(conflictWords.hasConflict).toBe(true);

      const conflictTopicTags = ledger.checkHypothesisConflict(
        "Alternative networking scheme",
        ["p2p", "mesh"],
        "P2P Networking",
      );
      expect(conflictTopicTags.hasConflict).toBe(true);

      const singleTagNoConflict = ledger.checkHypothesisConflict(
        "Alternative single tag",
        ["p2p"],
        "P2P Networking",
      );
      expect(singleTagNoConflict.hasConflict).toBe(false);

      const cleanCheck = ledger.checkHypothesisConflict(
        "Unrelated SIMD vector optimization",
        ["simd"],
        "SIMD",
      );
      expect(cleanCheck.hasConflict).toBe(false);

      expect(ledger.incrementPreventedRepetition(entry1.id)).toBe(true);
      expect(ledger.incrementPreventedRepetition("missing-id")).toBe(false);

      const json = ledger.exportJson();
      const freshLedger = new AntiPatternLedger();
      freshLedger.importJson(json);
      expect(freshLedger.getAllEntries().length).toBe(2);
      freshLedger.clear();
      expect(freshLedger.getAllEntries().length).toBe(0);
    });
  });

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
