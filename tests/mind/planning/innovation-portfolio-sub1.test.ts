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


test("defines 70/20/10 target capacity distributions across the 3 tracks", () => {
    expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toBe(70);
    expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]).toBe(20);
    expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBe(10);
  });

test("handles empty workstream list gracefully as BALANCED with zero allocations", () => {
    const manager = new InnovationPortfolioManager();
    const report = manager.auditPortfolioBalance([]);

    expect(report.totalWorkstreams).toBe(0);
    expect(report.totalAllocation).toBe(0);
    expect(report.status).toBe("BALANCED");
    expect(report.isBalanced).toBe(true);
    expect(report.rebalanceActions.length).toBe(0);
  });

test("validates a well-balanced 70/20/10 workstream distribution", () => {
    const manager = new InnovationPortfolioManager();
    const workstreams: PortfolioWorkstream[] = [
      // 7 Core Stability (70%)
      { id: "c1", title: "Bug fix A", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c2", title: "Bug fix B", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c3", title: "Edge cases C", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c4", title: "UX polish D", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c5", title: "Doc accuracy E", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c6", title: "Regression test F", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c7", title: "Defect cleanup G", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      // 2 Architectural Evolution (20%)
      { id: "a1", title: "Refactor Subsystem 1", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
      { id: "a2", title: "Scale decoupled queue", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
      // 1 Exploratory Bet (10%)
      {
        id: "e1",
        title: "Vector Index Paradigm",
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
    expect(report.rebalanceActions.length).toBe(0);
  });

test("detects Timidity Trap when exploratory bets are 0% across >= 3 active workstreams", () => {
    const manager = new InnovationPortfolioManager();
    const workstreams: PortfolioWorkstream[] = [
      { id: "c1", title: "Defect fix 1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c2", title: "Defect fix 2", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c3", title: "Defect fix 3", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "a1", title: "Refactoring 1", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
    ];

    const report = manager.auditPortfolioBalance(workstreams);

    expect(report.totalWorkstreams).toBe(4);
    expect(report.distributionPercentages[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBe(0);
    expect(report.status).toBe("TIMIDITY_TRAP");
    expect(report.isBalanced).toBe(false);
    expect(report.rebalanceActions.length).toBeGreaterThan(0);

    const action = report.rebalanceActions[0]!;
    expect(action.toTrack).toBe(PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS);
    expect(action.fromTrack).toBe(PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH);
    expect(action.urgency).toBe("HIGH");
    expect(action.rationale).toContain("Timidity Trap detected");
  });

test("detects Speculative Over-allocation when exploratory bets exceed 15%", () => {
    const manager = new InnovationPortfolioManager();
    const workstreams: PortfolioWorkstream[] = [
      { id: "c1", title: "Core 1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c2", title: "Core 2", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "a1", title: "Arch 1", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
      // 3 Exploratory bets out of 6 (50% exploratory)
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

test("detects Core Deficit when Core Stability allocation falls below 55%", () => {
    const manager = new InnovationPortfolioManager();
    const workstreams: PortfolioWorkstream[] = [
      // 3 Core (30%)
      { id: "c1", title: "Core 1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c2", title: "Core 2", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      { id: "c3", title: "Core 3", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
      // 6 Arch (60%)
      { id: "a1", title: "Arch 1", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
      { id: "a2", title: "Arch 2", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
      { id: "a3", title: "Arch 3", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
      { id: "a4", title: "Arch 4", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
      { id: "a5", title: "Arch 5", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
      { id: "a6", title: "Arch 6", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
      // 1 Exploratory (10%)
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

test("weights workstreams dynamically using allocationWeight", () => {
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
});
