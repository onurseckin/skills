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
  describe("3. 3-Milestone Hypothesis Gates & Stage-Gated Lifecycle", () => {
    it("registers an exploratory bet with 3 sequential hypothesis gates and stage-gated budget", () => {
      const manager = new InnovationPortfolioManager();
      const bet = manager.registerBet({
        title: "Sub-Millisecond Event Streaming Kernel",
        falsifiableHypothesis: "Direct memory mapped ring buffers reduce latency by 60%",
        valueProposition: "Instantaneous state propagation across workers",
        budget: 2000,
        tags: ["streaming", "ring-buffer", "latency"],
      });

      expect(bet.id).toBeDefined();
      expect(bet.title).toBe("Sub-Millisecond Event Streaming Kernel");
      expect(bet.currentMilestone).toBe(1);
      expect(bet.status).toBe("ACTIVE");
      expect(bet.milestones).toHaveLength(3);

      expect(bet.milestones[0]?.milestone).toBe(1);
      expect(bet.milestones[0]?.name).toBe(MILESTONE_NAMES.FEASIBILITY_PROTOTYPE);
      expect(bet.milestones[0]?.status).toBe("IN_PROGRESS");
      expect(bet.milestones[0]?.allocatedBudget).toBe(600); // 30% of 2000

      expect(bet.milestones[1]?.milestone).toBe(2);
      expect(bet.milestones[1]?.name).toBe(MILESTONE_NAMES.STRESS_VALIDATION);
      expect(bet.milestones[1]?.status).toBe("PENDING");
      expect(bet.milestones[1]?.allocatedBudget).toBe(800); // 40% of 2000

      expect(bet.milestones[2]?.milestone).toBe(3);
      expect(bet.milestones[2]?.name).toBe(MILESTONE_NAMES.SYSTEM_INTEGRATION);
      expect(bet.milestones[2]?.status).toBe("PENDING");
      expect(bet.milestones[2]?.allocatedBudget).toBe(600); // 30% of 2000

      // Also verifies workstream was automatically registered
      const ws = manager.getWorkstreams().find((w) => w.betId === bet.id);
      expect(ws).toBeDefined();
      expect(ws?.track).toBe(PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS);
    });

    it("advances through Milestone 1 -> Milestone 2 -> Milestone 3 upon empirical validation", () => {
      const manager = new InnovationPortfolioManager();
      const bet = manager.registerBet({
        title: "Zero-Copy Graph Traversal",
        falsifiableHypothesis: "Direct adjacency indexing yields 8x query throughput",
        valueProposition: "Accelerated DAG evaluation",
        targetGraduationTrack: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
      });

      // Pass Milestone 1: FEASIBILITY_PROTOTYPE
      const res1 = manager.evaluateMilestone(bet.id, 1, {
        passed: true,
        evidence: "Minimal POC validated in benchmark with 6.2x gain",
        spentBudget: 250,
      });

      expect(res1.passed).toBe(true);
      expect(res1.newStatus).toBe("ACTIVE");
      expect(res1.nextMilestone).toBe(2);

      const betM1 = manager.getBet(bet.id)!;
      expect(betM1.currentMilestone).toBe(2);
      expect(betM1.milestones[0]?.status).toBe("PASSED");
      expect(betM1.milestones[1]?.status).toBe("IN_PROGRESS");

      // Pass Milestone 2: STRESS_VALIDATION
      const res2 = manager.evaluateMilestone(bet.id, 2, {
        passed: true,
        evidence: "Sustained 100k queries/sec under stress without memory leakage",
        spentBudget: 350,
      });

      expect(res2.passed).toBe(true);
      expect(res2.newStatus).toBe("ACTIVE");
      expect(res2.nextMilestone).toBe(3);

      const betM2 = manager.getBet(bet.id)!;
      expect(betM2.currentMilestone).toBe(3);
      expect(betM2.milestones[1]?.status).toBe("PASSED");
      expect(betM2.milestones[2]?.status).toBe("IN_PROGRESS");
    });

    it("rejects out-of-order milestone evaluation attempts", () => {
      const manager = new InnovationPortfolioManager();
      const bet = manager.registerBet({
        title: "Premature Jump Bet",
        falsifiableHypothesis: "Testing strict sequence",
        valueProposition: "Sequence testing",
      });

      expect(() => {
        manager.evaluateMilestone(bet.id, 3, {
          passed: true,
          evidence: "Skipped M1 and M2",
        });
      }).toThrow("is currently on milestone 1");
    });
  });

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
});
