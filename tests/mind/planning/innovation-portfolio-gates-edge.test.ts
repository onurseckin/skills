import { describe, expect, it } from "bun:test";
import {
  InnovationPortfolioManager,
  PORTFOLIO_TRACKS,
  type CreateBetInput,
} from "../../../olt/scripts/src/mind/planning/innovation-portfolio.ts";

describe("Innovation Portfolio 3-Milestone Gates Edge Coverage", () => {
  it("registers bets with numeric budget and custom milestone acceptance criteria", () => {
    const manager = new InnovationPortfolioManager();
    const input: CreateBetInput = {
      id: "bet-custom-gate-1",
      title: "Speculative Query Engine",
      falsifiableHypothesis: "Parallel speculative compilation reduces latency by 40%",
      valueProposition: "Sub-millisecond query planning",
      budget: 5000,
      targetGraduationTrack: "CORE_STABILITY_AND_POLISH",
      milestone1Criteria: ["Custom M1 Criteria: POC compiles"],
      milestone2Criteria: ["Custom M2 Criteria: Stress test under 10k RPS"],
      milestone3Criteria: ["Custom M3 Criteria: Zero regression in test suite"],
      tags: ["query", "compiler"],
      topic: "Query Optimization",
      owner: "compiler-core",
    };

    const bet = manager.registerBet(input);
    expect(bet.id).toBe("bet-custom-gate-1");
    expect(bet.budget.totalAllocated).toBe(5000);
    expect(bet.budget.milestoneBudgets?.[1]).toBe(1500);
    expect(bet.budget.milestoneBudgets?.[2]).toBe(2000);
    expect(bet.budget.milestoneBudgets?.[3]).toBe(1500);
    expect(bet.milestones[0]?.acceptanceCriteria).toEqual(["Custom M1 Criteria: POC compiles"]);
    expect(bet.milestones[1]?.acceptanceCriteria).toEqual([
      "Custom M2 Criteria: Stress test under 10k RPS",
    ]);
    expect(bet.milestones[2]?.acceptanceCriteria).toEqual([
      "Custom M3 Criteria: Zero regression in test suite",
    ]);
    expect(bet.targetGraduationTrack).toBe("CORE_STABILITY_AND_POLISH");
    expect(manager.getBet("bet-custom-gate-1")?.id).toBe("bet-custom-gate-1");
    expect(manager.getBet("nonexistent")).toBeUndefined();
    expect(manager.getAllBets()).toHaveLength(1);
    expect(manager.getActiveBets()).toHaveLength(1);
  });

  it("registers bets with structured budget object and custom currency", () => {
    const manager = new InnovationPortfolioManager();
    const bet = manager.registerBet({
      title: "Zero-Copy Deserializer",
      falsifiableHypothesis: "SIMD zero-copy deserializer outperforms simdjson",
      valueProposition: "High throughput deserialization",
      budget: {
        totalAllocated: 2000,
        totalSpent: 100,
        currency: "CREDITS",
        milestoneBudgets: { 1: 500, 2: 1000, 3: 500 },
      },
    });

    expect(bet.budget.currency).toBe("CREDITS");
    expect(bet.budget.totalAllocated).toBe(2000);
    expect(bet.budget.totalSpent).toBe(100);
    expect(bet.budget.milestoneBudgets?.[1]).toBe(500);
  });

  it("enforces validation errors when evaluating nonexistent, invalid milestone, or finished bets", () => {
    const manager = new InnovationPortfolioManager();
    const bet = manager.registerBet({
      title: "Transactional Memory Engine",
      falsifiableHypothesis: "Software transactional memory achieves lockfree throughput",
      valueProposition: "Contention-free transactions",
    });

    expect(() => {
      manager.evaluateMilestone("missing-bet-id", 1, { passed: true, evidence: "POC passed" });
    }).toThrow('Exploratory bet with ID "missing-bet-id" not found.');

    expect(() => {
      manager.evaluateMilestone(bet.id, 2, { passed: true, evidence: "Skipped M1" });
    }).toThrow(`Cannot evaluate milestone 2; bet "${bet.id}" is currently on milestone 1.`);
  });

  it("advances active bet through Milestone 1, Milestone 2, and graduates at Milestone 3", () => {
    const manager = new InnovationPortfolioManager();
    const bet = manager.registerBet({
      title: "Deterministic Replay Engine",
      falsifiableHypothesis: "Deterministic event logs allow exact time-travel debugging",
      valueProposition: "Zero-overhead state replay",
      targetGraduationTrack: "CORE_STABILITY_AND_POLISH",
    });

    // Milestone 1: Pass
    const m1Result = manager.evaluateMilestone(bet.id, 1, {
      passed: true,
      evidence: "POC demonstrated deterministic record and replay of 1,000 events.",
      spentBudget: 150,
    });
    expect(m1Result.passed).toBe(true);
    expect(m1Result.newStatus).toBe("ACTIVE");
    expect(m1Result.nextMilestone).toBe(2);
    expect(manager.getBet(bet.id)?.currentMilestone).toBe(2);
    expect(manager.getBet(bet.id)?.budget.totalSpent).toBe(150);

    // Milestone 2: Pass
    const m2Result = manager.evaluateMilestone(bet.id, 2, {
      passed: true,
      evidence: "Stress test passed with 100k concurrent events under 5% packet jitter.",
      spentBudget: 250,
    });
    expect(m2Result.passed).toBe(true);
    expect(m2Result.newStatus).toBe("ACTIVE");
    expect(m2Result.nextMilestone).toBe(3);
    expect(manager.getBet(bet.id)?.currentMilestone).toBe(3);
    expect(manager.getBet(bet.id)?.budget.totalSpent).toBe(400);

    // Milestone 3: Graduation
    const m3Result = manager.evaluateMilestone(bet.id, 3, {
      passed: true,
      evidence: "End-to-end integration verified across all core subsystems without regressions.",
      productionRolloutPlan: "Stage 1 rollout to 10% canary traffic followed by full deployment.",
      targetGraduationTrack: "CORE_STABILITY_AND_POLISH",
      spentBudget: 200,
    });

    expect(m3Result.passed).toBe(true);
    expect(m3Result.newStatus).toBe("GRADUATED");
    expect(m3Result.graduationCertificate).toBeDefined();
    expect(m3Result.graduationCertificate?.targetRolloutTrack).toBe("CORE_STABILITY_AND_POLISH");
    expect(m3Result.graduationCertificate?.productionRolloutPlan).toContain("Stage 1 rollout");

    const graduatedBet = manager.getBet(bet.id);
    expect(graduatedBet?.status).toBe("GRADUATED");
    expect(manager.getActiveBets()).toHaveLength(0);
    expect(manager.getGraduationCertificates()).toHaveLength(1);

    // Verify corresponding workstream updated to graduated track
    const ws = manager.getWorkstreams().find((w) => w.id === `ws-${bet.id}`);
    expect(ws?.track).toBe(PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH);
    expect(ws?.title).toContain("[Graduated]");

    // Cannot evaluate graduated bet
    expect(() => {
      manager.evaluateMilestone(bet.id, 3, { passed: true, evidence: "After graduation" });
    }).toThrow(`Cannot evaluate already graduated bet "${bet.id}".`);
  });

  it("handles milestone failure, immediate termination, and anti-pattern recording", () => {
    const manager = new InnovationPortfolioManager();
    const bet = manager.registerBet({
      title: "Direct Kernel Bypass IO",
      falsifiableHypothesis: "io_uring bypass reduces disk IO latency by 90%",
      valueProposition: "Ultra-fast disk caching",
      tags: ["kernel", "io"],
      topic: "Kernel Bypass",
    });

    const failResult = manager.evaluateMilestone(bet.id, 1, {
      passed: false,
      evidence: "Kernel panics under concurrent read/write streams.",
      failureReason: "Kernel panic in ring buffer queue submission",
      failureSymptoms: ["Kernel panic", "Memory corruption in ring buffer"],
      lessonsLearned: "Avoid direct kernel bypass in unprivileged containers.",
      spentBudget: 300,
    });

    expect(failResult.passed).toBe(false);
    expect(failResult.newStatus).toBe("TERMINATED");
    expect(failResult.antiPatternEntry).toBeDefined();
    expect(failResult.antiPatternEntry?.failureReason).toBe(
      "Kernel panic in ring buffer queue submission",
    );
    expect(failResult.antiPatternEntry?.symptoms).toContain("Kernel panic");
    expect(failResult.rebalanceRecommendation?.urgency).toBe("HIGH");
    expect(failResult.rebalanceRecommendation?.toTrack).toBe(
      PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
    );

    const terminatedBet = manager.getBet(bet.id);
    expect(terminatedBet?.status).toBe("TERMINATED");
    expect(terminatedBet?.antiPatternEntryId).toBe(failResult.antiPatternEntry?.id);

    // Verify workstream status is TERMINATED
    const ws = manager.getWorkstreams().find((w) => w.id === `ws-${bet.id}`);
    expect(ws?.status).toBe("TERMINATED");

    // Cannot evaluate terminated bet
    expect(() => {
      manager.evaluateMilestone(bet.id, 1, { passed: true, evidence: "After termination" });
    }).toThrow(`Cannot evaluate terminated bet "${bet.id}".`);
  });
});
