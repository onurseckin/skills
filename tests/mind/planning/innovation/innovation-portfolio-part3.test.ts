import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_TRACKS,
  PORTFOLIO_TARGET_PERCENTAGES,
  TIMIDITY_TRAP_MIN_WORKSTREAMS,
  SPECULATIVE_OVERALLOCATION_THRESHOLD_PERCENT,
  CORE_DEFICIT_THRESHOLD_PERCENT,
  MILESTONE_NAMES,
  MILESTONE_DEFINITIONS,
  InnovationPortfolioManager,
  AntiPatternLedger,
  type PortfolioWorkstream,
  type ExploratoryBet,
  // Pareto arbitration exports
  PARETO_PRIORITY_LEVELS,
  arbitrateParetoPair,
  arbitrateParetoCandidates,
  computeParetoEfficiencyScore,
  filterParetoFrontier,
  enforcePreDeclaredParetoArbitration,
  type ParetoCandidate,
} from "../../../../olt/scripts/src/mind/planning/index.ts";

describe("Failure Handling & Anti-Pattern Ledger", () => {
  test("immediately terminates bet upon milestone failure and logs to AntiPatternLedger", () => {
    const manager = new InnovationPortfolioManager();
    const bet = manager.registerBet({
      title: "Decentralized DHT Mesh Sync",
      falsifiableHypothesis: "P2P gossip sync will achieve <50ms consensus in high-churn networks",
      valueProposition: "Remove central coordinator node",
      tags: ["p2p", "dht", "mesh", "networking"],
      topic: "Decentralized Networking",
    });

    // Milestone 1 passed
    manager.evaluateMilestone(bet.id, 1, {
      passed: true,
      evidence: "Basic 2-node prototype communicated successfully",
    });

    // Milestone 2 fails stress validation (e.g. partition split-brain)
    const resFail = manager.evaluateMilestone(bet.id, 2, {
      passed: false,
      evidence: "Network split brain detected under 10% packet drop",
      failureReason: "Byzantine fault tolerance broken under moderate churn",
      failureSymptoms: ["Split-brain partition", "Divergent ledger states", "High latency spikes"],
      lessonsLearned: "Pure gossip without verifiable RAFT/Paxos fails under split networks.",
    });

    expect(resFail.passed).toBe(false);
    expect(resFail.newStatus).toBe("TERMINATED");
    expect(resFail.antiPatternEntry).toBeDefined();

    const antiEntry = resFail.antiPatternEntry!;
    expect(antiEntry.betId).toBe(bet.id);
    expect(antiEntry.failedMilestone).toBe(2);
    expect(antiEntry.failedMilestoneName).toBe("STRESS_VALIDATION");
    expect(antiEntry.failureReason).toContain("Byzantine fault tolerance broken");
    expect(antiEntry.symptoms).toContain("Split-brain partition");
    expect(antiEntry.tags).toContain("dht");

    const betAfterFail = manager.getBet(bet.id)!;
    expect(betAfterFail.status).toBe("TERMINATED");
    expect(betAfterFail.antiPatternEntryId).toBe(antiEntry.id);

    // Verify workstream is terminated to release capacity
    const ws = manager.getWorkstreams().find((w) => w.betId === bet.id)!;
    expect(ws.status).toBe("TERMINATED");

    // Verify rebalance recommendation
    expect(resFail.rebalanceRecommendation).toBeDefined();
    expect(resFail.rebalanceRecommendation!.fromTrack).toBe(
      PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
    );
    expect(resFail.rebalanceRecommendation!.toTrack).toBe(
      PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
    );
  });

  test("prevents repeating failed exploratory bets through hypothesis conflict checks", () => {
    const ledger = new AntiPatternLedger();
    ledger.recordAntiPattern({
      betId: "bet-old-1",
      betTitle: "Custom In-Memory Regex Engine",
      falsifiedHypothesis: "Custom backtracking regex compiler outperforms v8 by 2x",
      failedMilestone: 2,
      failedMilestoneName: "STRESS_VALIDATION",
      failureReason: "Catastrophic polynomial backtracking on recursive patterns",
      symptoms: ["ReDoS vulnerability", "Exponential stack overflow"],
      tags: ["regex", "parsing", "compiler"],
      topic: "Regex Optimization",
    });

    // Exact or substring match check
    const check1 = ledger.checkHypothesisConflict(
      "Custom backtracking regex compiler outperforms v8 by 2x",
    );
    expect(check1.hasConflict).toBe(true);
    expect(check1.matchingEntries.length).toBe(1);
    expect(check1.matchingEntries[0]!.betTitle).toBe("Custom In-Memory Regex Engine");
    expect(check1.matchingEntries[0]!.preventedRepetitionsCount).toBe(1);

    // Substring match check
    const check2 = ledger.checkHypothesisConflict(
      "Custom backtracking regex compiler outperforms standard engines",
    );
    expect(check2.hasConflict).toBe(true);

    // Topic and shared tags check
    const check3 = ledger.checkHypothesisConflict(
      "Novel parsing state machine",
      ["regex", "compiler"],
      "Regex Optimization",
    );
    expect(check3.hasConflict).toBe(true);

    // Completely unrelated hypothesis passes cleanly
    const checkClean = ledger.checkHypothesisConflict(
      "SIMD vector string searching for utf-8 validation",
      ["simd", "string"],
      "String Processing",
    );
    expect(checkClean.hasConflict).toBe(false);
    expect(checkClean.matchingEntries.length).toBe(0);
  });

  test("searches AntiPatternLedger by topic, tags, and general query", () => {
    const ledger = new AntiPatternLedger();
    ledger.recordAntiPattern({
      betId: "b1",
      betTitle: "Wasm Sandbox JIT",
      falsifiedHypothesis: "Direct JIT emits without validation reduce startup time",
      failedMilestone: 1,
      failedMilestoneName: "FEASIBILITY_PROTOTYPE",
      failureReason: "Memory safety violations on macOS ARM64",
      tags: ["wasm", "jit", "runtime"],
      topic: "Wasm Runtime",
    });

    ledger.recordAntiPattern({
      betId: "b2",
      betTitle: "Distributed Lock-Free Queue",
      falsifiedHypothesis: "Lock-free atomic queues scale linearly across 64 cores",
      failedMilestone: 2,
      failedMilestoneName: "STRESS_VALIDATION",
      failureReason: "Cache-line ping-pong saturation under high contention",
      tags: ["concurrency", "lock-free", "scaling"],
      topic: "Concurrency Architecture",
    });

    const topicResults = ledger.searchByTopic("Wasm");
    expect(topicResults.length).toBe(1);
    expect(topicResults[0]!.betTitle).toBe("Wasm Sandbox JIT");

    const tagResults = ledger.searchByTags(["lock-free"]);
    expect(tagResults.length).toBe(1);
    expect(tagResults[0]!.betTitle).toBe("Distributed Lock-Free Queue");

    const queryResults = ledger.searchByQuery("cache-line");
    expect(queryResults.length).toBe(1);
    expect(queryResults[0]!.betTitle).toBe("Distributed Lock-Free Queue");
  });

  test("serializes and deserializes AntiPatternLedger state", () => {
    const ledger = new AntiPatternLedger();
    ledger.recordAntiPattern({
      betId: "b1",
      betTitle: "Shared State Worker Mesh",
      falsifiedHypothesis: "Raw shared array buffer across workers without synchronization",
      failedMilestone: 1,
      failedMilestoneName: "FEASIBILITY_PROTOTYPE",
      failureReason: "Unsynchronized data races",
      tags: ["concurrency", "workers"],
      topic: "Multithreading",
    });

    const json = ledger.exportJson();
    const newLedger = new AntiPatternLedger();
    newLedger.importJson(json);

    expect(newLedger.getAllEntries().length).toBe(1);
    expect(newLedger.getEntryByBetId("b1")?.betTitle).toBe("Shared State Worker Mesh");
  });
});

