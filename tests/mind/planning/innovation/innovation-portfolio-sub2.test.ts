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

describe("70/20/10 Innovation Portfolio Governance & Capacity Balancer", () => {
  test("executes complete 3-milestone sequence to graduation with certificate", () => {
    const manager = new InnovationPortfolioManager();
    const bet = manager.registerBet({
      title: "Zero-Copy Graph Traversal",
      falsifiableHypothesis: "Direct memory mapping achieves 10x faster DAG queries",
      valueProposition: "Instantaneous dependency graph evaluation",
      targetGraduationTrack: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
    });

    // Milestone 1: FEASIBILITY_PROTOTYPE
    const res1 = manager.evaluateMilestone(bet.id, 1, {
      passed: true,
      evidence: "POC demonstrated in bench-suite with 8.5x latency improvement",
      spentBudget: 250,
    });

    expect(res1.passed).toBe(true);
    expect(res1.newStatus).toBe("ACTIVE");
    expect(res1.nextMilestone).toBe(2);

    const betAfterM1 = manager.getBet(bet.id)!;
    expect(betAfterM1.currentMilestone).toBe(2);
    expect(betAfterM1.milestones[0]!.status).toBe("PASSED");
    expect(betAfterM1.milestones[1]!.status).toBe("IN_PROGRESS");

    // Milestone 2: STRESS_VALIDATION
    const res2 = manager.evaluateMilestone(bet.id, 2, {
      passed: true,
      evidence: "Sustained 50k concurrent queries under 128MB RAM boundary without leakage",
      spentBudget: 350,
    });

    expect(res2.passed).toBe(true);
    expect(res2.newStatus).toBe("ACTIVE");
    expect(res2.nextMilestone).toBe(3);

    const betAfterM2 = manager.getBet(bet.id)!;
    expect(betAfterM2.currentMilestone).toBe(3);
    expect(betAfterM2.milestones[1]!.status).toBe("PASSED");
    expect(betAfterM2.milestones[2]!.status).toBe("IN_PROGRESS");

    // Milestone 3: SYSTEM_INTEGRATION (Graduation Gate)
    const res3 = manager.evaluateMilestone(bet.id, 3, {
      passed: true,
      evidence: "Integrated into main engine pipeline with zero regressions across 140+ suites",
      spentBudget: 300,
      targetGraduationTrack: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
      productionRolloutPlan: "Stage 1: Canarify in CI. Stage 2: Enable in core dag engine.",
    });

    expect(res3.passed).toBe(true);
    expect(res3.newStatus).toBe("GRADUATED");
    expect(res3.graduationCertificate).toBeDefined();

    const cert = res3.graduationCertificate!;
    expect(cert.betId).toBe(bet.id);
    expect(cert.title).toBe("Zero-Copy Graph Traversal");
    expect(cert.targetRolloutTrack).toBe(PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION);
    expect(cert.milestoneSummary.length).toBe(3);

    const betGraduated = manager.getBet(bet.id)!;
    expect(betGraduated.status).toBe("GRADUATED");
    expect(betGraduated.graduationCertificate).toBeDefined();

    // Verify corresponding workstream is now in Architectural Evolution
    const workstreams = manager.getWorkstreams();
    const ws = workstreams.find((w) => w.betId === bet.id)!;
    expect(ws.track).toBe(PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION);
    expect(ws.title).toContain("[Graduated]");
  });

  test("rejects out-of-order milestone evaluation", () => {
    const manager = new InnovationPortfolioManager();
    const bet = manager.registerBet({
      title: "Premature Jump Bet",
      falsifiableHypothesis: "Should fail if jumping straight to Milestone 3",
      valueProposition: "Testing sequence enforcement",
    });

    expect(() => {
      manager.evaluateMilestone(bet.id, 3, {
        passed: true,
        evidence: "Skipped M1 and M2",
      });
    }).toThrow("is currently on milestone 1");
  });

  test("rejects evaluation of unknown or completed bets", () => {
    const manager = new InnovationPortfolioManager();
    expect(() => {
      manager.evaluateMilestone("non-existent-id", 1, {
        passed: true,
        evidence: "Ghost test",
      });
    }).toThrow("not found");
  });
});

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
});
