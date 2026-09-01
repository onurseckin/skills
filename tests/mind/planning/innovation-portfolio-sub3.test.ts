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
} from "../../../olt/scripts/src/mind/planning/index.ts";

describe("70/20/10 Innovation Portfolio Governance & Capacity Balancer", () => {


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

describe("Pre-Declared Pareto Arbitration Integration", () => {

test("enforces UX Delight & Correctness as Priority 1 and penalizes candidates with errors", () => {
    const candidateA: ParetoCandidate = {
      name: "Fast But Buggy Parser",
      satisfiesPriority: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
      perfGainPercent: 50,
      hasErrors: true,
    };

    const candidateB: ParetoCandidate = {
      name: "Rock-Solid Correct Parser",
      satisfiesPriority: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS,
      perfGainPercent: 0,
      hasErrors: false,
    };

    const result = arbitrateParetoPair(candidateA, candidateB);
    expect(result.winner).toBe("Rock-Solid Correct Parser");
    expect(result.winningLevel).toBe(PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS);
    expect(result.rationale).toContain("runtime or structural errors");
  });

test("enforces Simplicity & Maintainability over marginal performance gains (< 15%)", () => {
    const simpleCandidate: ParetoCandidate = {
      name: "Simple Direct Implementation",
      satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
      cognitiveComplexityScore: 10,
    };

    const complexMarginal: ParetoCandidate = {
      name: "Complex Over-engineered Caching",
      satisfiesPriority: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
      perfGainPercent: 8, // < 15% threshold
      cognitiveComplexityScore: 85,
    };

    const result = arbitrateParetoPair(simpleCandidate, complexMarginal);
    expect(result.winner).toBe("Simple Direct Implementation");
    expect(result.winningLevel).toBe(PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY);
    expect(result.rationale).toContain("Priority 2");
  });

test("allows Scalability (Priority 3) to win when performance gain >= 15%", () => {
    const simpleCandidate: ParetoCandidate = {
      name: "Standard Loop",
      satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
    };

    const validScalability: ParetoCandidate = {
      name: "SIMD Batch Kernel",
      satisfiesPriority: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
      perfGainPercent: 45, // >= 15% threshold
      cognitiveComplexityScore: 25,
    };

    const result = arbitrateParetoPair(simpleCandidate, validScalability);
    expect(result.winner).toBe("SIMD Batch Kernel"); // Priority 3 with >= 15% gain takes precedence over Priority 2
  });

test("arbitrates multi-candidate set and enforces Pareto frontier when debate cycles > 2", () => {
    const candidates: ParetoCandidate[] = [
      {
        name: "Speculative Framework Metaprogramming",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
        cognitiveComplexityScore: 90,
      },
      {
        name: "Clean Modular Decoupling",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        empiricalValueScore: 95,
        cognitiveComplexityScore: 15,
      },
      {
        name: "High Scalability Indexing",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
        perfGainPercent: 30,
        empiricalValueScore: 85,
        cognitiveComplexityScore: 30,
      },
    ];

    const result = enforcePreDeclaredParetoArbitration("Architecture Deadlock", 3, candidates);
    expect(result.forcedByThreshold).toBe(true);
    expect(result.winner).toBe("High Scalability Indexing");
    expect(result.rankedCandidates?.length).toBe(3);
    expect(result.paretoFrontier?.length).toBeGreaterThan(0);
    expect(result.rationale).toBeDefined();
  });

test("filters candidates onto the Pareto frontier accurately", () => {
    const candidates: ParetoCandidate[] = [
      {
        name: "Low Value High Complexity",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
        empiricalValueScore: 20,
        cognitiveComplexityScore: 80,
      },
      {
        name: "High Value Low Complexity",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS,
        empiricalValueScore: 95,
        cognitiveComplexityScore: 10,
      },
    ];

    const frontier = filterParetoFrontier(candidates);
    expect(frontier.length).toBe(1);
    expect(frontier[0]!.name).toBe("High Value Low Complexity");
  });
});
