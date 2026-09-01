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


describe("4. Failure Handling & Anti-Pattern Ledger Logging", () => {
    it("terminates bet immediately upon milestone failure, logs to AntiPatternLedger, and releases capacity", () => {
      const manager = new InnovationPortfolioManager();
      const bet = manager.registerBet({
        title: "Decentralized P2P Gossip Sync",
        falsifiableHypothesis: "Pure gossip achieves sub-50ms consensus without coordinator",
        valueProposition: "Remove central coordinator",
        tags: ["p2p", "gossip", "networking"],
        topic: "P2P Networking",
      });

      // Pass M1
      manager.evaluateMilestone(bet.id, 1, {
        passed: true,
        evidence: "Basic 2-node prototype communicated cleanly",
      });

      // Fail M2 (Stress Validation)
      const resFail = manager.evaluateMilestone(bet.id, 2, {
        passed: false,
        evidence: "Network split-brain under 10% packet drop",
        failureReason: "Byzantine fault tolerance failed under packet loss",
        failureSymptoms: ["Split-brain partition", "Ledger divergence"],
        lessonsLearned: "Pure gossip without verifiable RAFT/Paxos fails under split networks.",
      });

      expect(resFail.passed).toBe(false);
      expect(resFail.newStatus).toBe("TERMINATED");
      expect(resFail.antiPatternEntry).toBeDefined();

      const antiPattern = resFail.antiPatternEntry!;
      expect(antiPattern.betId).toBe(bet.id);
      expect(antiPattern.failedMilestone).toBe(2);
      expect(antiPattern.failedMilestoneName).toBe("STRESS_VALIDATION");
      expect(antiPattern.failureReason).toContain("Byzantine fault tolerance failed");
      expect(antiPattern.symptoms).toContain("Split-brain partition");
      expect(antiPattern.tags).toContain("gossip");

      const terminatedBet = manager.getBet(bet.id)!;
      expect(terminatedBet.status).toBe("TERMINATED");
      expect(terminatedBet.antiPatternEntryId).toBe(antiPattern.id);

      // Verify associated workstream is marked TERMINATED
      const ws = manager.getWorkstreams().find((w) => w.betId === bet.id)!;
      expect(ws.status).toBe("TERMINATED");

      // Verify rebalance recommendation to shift capacity back to Core Stability
      expect(resFail.rebalanceRecommendation).toBeDefined();
      expect(resFail.rebalanceRecommendation?.fromTrack).toBe(
        PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
      );
      expect(resFail.rebalanceRecommendation?.toTrack).toBe(
        PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
      );
    });

    it("checks and prevents repeating known failed hypotheses using AntiPatternLedger", () => {
      const ledger = new AntiPatternLedger();

      ledger.recordAntiPattern({
        betId: "bet-fail-1",
        betTitle: "Custom In-Memory Regex Compiler",
        falsifiedHypothesis: "Custom backtracking regex compiler outperforms v8 by 2x",
        failedMilestone: 2,
        failedMilestoneName: "STRESS_VALIDATION",
        failureReason: "Catastrophic polynomial backtracking on recursive patterns",
        symptoms: ["ReDoS vulnerability", "Stack overflow"],
        tags: ["regex", "parsing", "compiler"],
        topic: "Regex Optimization",
      });

      // 1. Exact match check
      const checkExact = ledger.checkHypothesisConflict(
        "Custom backtracking regex compiler outperforms v8 by 2x",
      );
      expect(checkExact.hasConflict).toBe(true);
      expect(checkExact.matchingEntries).toHaveLength(1);
      expect(checkExact.matchingEntries[0]?.preventedRepetitionsCount).toBe(1);

      // 2. Keyword overlap check
      const checkOverlap = ledger.checkHypothesisConflict(
        "Custom backtracking regex compiler outperforms standard engines",
      );
      expect(checkOverlap.hasConflict).toBe(true);

      // 3. Topic + shared tags check
      const checkTopicTags = ledger.checkHypothesisConflict(
        "Novel state machine parser",
        ["regex", "compiler"],
        "Regex Optimization",
      );
      expect(checkTopicTags.hasConflict).toBe(true);

      // 4. Unrelated hypothesis passes cleanly
      const checkClean = ledger.checkHypothesisConflict(
        "SIMD UTF-8 byte stream validator",
        ["simd", "utf8"],
        "Text Encoding",
      );
      expect(checkClean.hasConflict).toBe(false);
      expect(checkClean.matchingEntries).toHaveLength(0);
    });

    it("searches and serializes AntiPatternLedger entries", () => {
      const ledger = new AntiPatternLedger();
      ledger.recordAntiPattern({
        betId: "b-wasm",
        betTitle: "Wasm Direct JIT",
        falsifiedHypothesis: "Direct JIT emits reduce cold start",
        failedMilestone: 1,
        failedMilestoneName: "FEASIBILITY_PROTOTYPE",
        failureReason: "Memory faults on ARM64",
        tags: ["wasm", "jit"],
        topic: "Wasm Engine",
      });

      const topicResults = ledger.searchByTopic("Wasm");
      expect(topicResults).toHaveLength(1);

      const tagResults = ledger.searchByTags(["jit"]);
      expect(tagResults).toHaveLength(1);

      const queryResults = ledger.searchByQuery("ARM64");
      expect(queryResults).toHaveLength(1);

      const json = ledger.exportJson();
      const freshLedger = new AntiPatternLedger();
      freshLedger.importJson(json);
      expect(freshLedger.getAllEntries()).toHaveLength(1);
      expect(freshLedger.getEntryByBetId("b-wasm")?.betTitle).toBe("Wasm Direct JIT");
    });
  });

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
