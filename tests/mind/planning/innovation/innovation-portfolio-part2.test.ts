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

describe("3-Milestone Hypothesis Gates & Graduation Protocol", () => {
  test("registers an exploratory bet with all 3 hypothesis gates initialized", () => {
    const manager = new InnovationPortfolioManager();
    const bet = manager.registerBet({
      title: "Streaming Event Sourcing Kernel",
      falsifiableHypothesis: "Sub-millisecond event streaming reduces memory consumption by 40%",
      valueProposition: "Transform real-time event distribution and state sync",
      budget: 1500,
      tags: ["streaming", "architecture", "performance"],
    });

    expect(bet.id).toBeDefined();
    expect(bet.title).toBe("Streaming Event Sourcing Kernel");
    expect(bet.currentMilestone).toBe(1);
    expect(bet.status).toBe("ACTIVE");
    expect(bet.milestones.length).toBe(3);

    expect(bet.milestones[0]!.milestone).toBe(1);
    expect(bet.milestones[0]!.name).toBe(MILESTONE_NAMES.FEASIBILITY_PROTOTYPE);
    expect(bet.milestones[0]!.status).toBe("IN_PROGRESS");

    expect(bet.milestones[1]!.milestone).toBe(2);
    expect(bet.milestones[1]!.name).toBe(MILESTONE_NAMES.STRESS_VALIDATION);
    expect(bet.milestones[1]!.status).toBe("PENDING");

    expect(bet.milestones[2]!.milestone).toBe(3);
    expect(bet.milestones[2]!.name).toBe(MILESTONE_NAMES.SYSTEM_INTEGRATION);
    expect(bet.milestones[2]!.status).toBe("PENDING");
  });

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

