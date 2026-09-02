import { describe, expect, it } from "bun:test";
import {
  checkPriority1Violation,
  computeParetoEfficiencyScore,
  describePriorityLevel,
  extractPerformanceGain,
  getPriorityPrecedenceRank,
  resolveEffectiveParetoPriority,
  resolveEffectivePriorityLevel,
  arbitrateParetoApproaches,
  type ParetoApproachCandidate,
} from "../../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";

describe("Pareto Arbitration Decision Hierarchy Edge Coverage", () => {
  it("describes priority levels and resolves precedence ranks across all 4 levels", () => {
    expect(describePriorityLevel(1)).toContain("Priority 1");
    expect(describePriorityLevel(2)).toContain("Priority 2");
    expect(describePriorityLevel(3)).toContain("Priority 3");
    expect(describePriorityLevel(4)).toContain("Priority 4");

    expect(getPriorityPrecedenceRank(1)).toBe(1);
    expect(getPriorityPrecedenceRank(3)).toBe(2);
    expect(getPriorityPrecedenceRank(2)).toBe(3);
    expect(getPriorityPrecedenceRank(4)).toBe(4);
  });

  it("extracts performance metrics across perfGain, throughputGain, latencyReduction, and default zero", () => {
    const candidatePerf: ParetoApproachCandidate = { name: "A", perfGainPercent: 25 };
    const candidateThroughput: ParetoApproachCandidate = { name: "B", throughputGainPercent: 30 };
    const candidateLatency: ParetoApproachCandidate = { name: "C", latencyReductionPercent: 18 };
    const candidateNone: ParetoApproachCandidate = { name: "D" };

    expect(extractPerformanceGain(candidatePerf)).toBe(25);
    expect(extractPerformanceGain(candidateThroughput)).toBe(30);
    expect(extractPerformanceGain(candidateLatency)).toBe(18);
    expect(extractPerformanceGain(candidateNone)).toBe(0);
  });

  it("checks Priority 1 functional and UX violations under default and strict thresholds", () => {
    const errorCandidate: ParetoApproachCandidate = { name: "Errors", hasErrors: true };
    expect(checkPriority1Violation(errorCandidate)).toContain("has runtime or structural errors");

    const funcErrorsCandidate: ParetoApproachCandidate = {
      name: "FuncErrors",
      functionalErrors: ["Invariant A breached", "State machine desynced"],
    };
    expect(checkPriority1Violation(funcErrorsCandidate)).toContain("2 functional error(s)");

    const uxCandidate: ParetoApproachCandidate = { name: "UXDrop", uxDegradation: true };
    expect(checkPriority1Violation(uxCandidate)).toContain(
      "introduces user experience degradation",
    );

    const scoreCandidate: ParetoApproachCandidate = {
      name: "ScoreLow",
      functionalCorrectnessScore: 0.92,
    };
    expect(checkPriority1Violation(scoreCandidate)).toContain("below required baseline (1)");
    expect(
      checkPriority1Violation(scoreCandidate, { strictCorrectnessThreshold: 0.9 }),
    ).toBeUndefined();

    const cleanCandidate: ParetoApproachCandidate = {
      name: "Clean",
      functionalCorrectnessScore: 1.0,
    };
    expect(checkPriority1Violation(cleanCandidate)).toBeUndefined();
  });

  it("resolves effective priority levels and demotes marginal Priority 3 candidates", () => {
    const speculative: ParetoApproachCandidate = {
      name: "Spec",
      isSpeculativeAbstraction: true,
      claimedPriorityLevel: 2,
    };
    expect(resolveEffectivePriorityLevel(speculative)).toBe(4);

    const marginalP3: ParetoApproachCandidate = {
      name: "Marginal",
      claimedPriorityLevel: 3,
      perfGainPercent: 12,
    };
    expect(resolveEffectivePriorityLevel(marginalP3)).toBe(4);

    const scalableP3: ParetoApproachCandidate = {
      name: "Scalable",
      claimedPriorityLevel: 3,
      perfGainPercent: 16,
    };
    expect(resolveEffectivePriorityLevel(scalableP3)).toBe(3);

    const customThresholdP3: ParetoApproachCandidate = {
      name: "CustomThreshold",
      satisfiesPriority: 3,
      perfGainPercent: 8,
    };
    expect(
      resolveEffectiveParetoPriority(customThresholdP3, { scalabilityThresholdPercent: 5 }),
    ).toBe(3);

    const defaultFallback: ParetoApproachCandidate = { name: "Fallback" };
    expect(resolveEffectivePriorityLevel(defaultFallback)).toBe(2);
  });

  it("computes Pareto efficiency scores with error penalties and implementation effort fallback", () => {
    const broken: ParetoApproachCandidate = { name: "Broken", hasErrors: true };
    expect(computeParetoEfficiencyScore(broken)).toBe(0);

    const uxBroken: ParetoApproachCandidate = { name: "UXBroken", uxDegradation: true };
    expect(computeParetoEfficiencyScore(uxBroken)).toBe(0);

    const candidateWithEffort: ParetoApproachCandidate = {
      name: "EffortBased",
      claimedPriorityLevel: 2,
      empiricalValueScore: 90,
      implementationEffortScore: 15,
      perfGainPercent: 20,
    };
    const score = computeParetoEfficiencyScore(candidateWithEffort);
    expect(score).toBeGreaterThan(100);
  });

  it("arbitrates Priority 1 disqualifications and mutual disqualifications with candidate IDs", () => {
    const candidateA: ParetoApproachCandidate = {
      id: "cand-a-id",
      name: "Candidate A",
      hasErrors: true,
    };
    const candidateB: ParetoApproachCandidate = {
      id: "cand-b-id",
      name: "Candidate B",
      claimedPriorityLevel: 2,
    };

    const resA = arbitrateParetoApproaches(candidateA, candidateB);
    expect(resA.winner).toBe("Candidate B");
    expect(resA.disqualifiedCandidates).toHaveLength(1);
    expect(resA.disqualifiedCandidates[0]?.candidateId).toBe("cand-a-id");

    const resB = arbitrateParetoApproaches(candidateB, candidateA);
    expect(resB.winner).toBe("Candidate B");
    expect(resB.disqualifiedCandidates).toHaveLength(1);
    expect(resB.disqualifiedCandidates[0]?.candidateId).toBe("cand-a-id");

    const candidateBError: ParetoApproachCandidate = {
      id: "cand-b-err",
      name: "Candidate B Error",
      uxDegradation: true,
    };
    const resBoth = arbitrateParetoApproaches(candidateA, candidateBError);
    expect(resBoth.winner).toBe("NONE");
    expect(resBoth.disqualifiedCandidates).toHaveLength(2);
  });

  it("enforces Priority 2 victory over marginal Priority 3 candidates in both positions", () => {
    const p2Simplicity: ParetoApproachCandidate = {
      name: "Simple Maintainable Core",
      claimedPriorityLevel: 2,
      cognitiveComplexityScore: 3,
      perfGainPercent: 0,
    };
    const p3Marginal: ParetoApproachCandidate = {
      name: "Marginal Micro-optimization",
      claimedPriorityLevel: 3,
      cognitiveComplexityScore: 25,
      perfGainPercent: 10,
    };

    const res1 = arbitrateParetoApproaches(p2Simplicity, p3Marginal);
    expect(res1.winner).toBe("Simple Maintainable Core");
    expect(res1.chosenPriorityLevel).toBe(2);
    expect(res1.rationale).toContain("unconditionally defeats");

    const res2 = arbitrateParetoApproaches(p3Marginal, p2Simplicity);
    expect(res2.winner).toBe("Simple Maintainable Core");
    expect(res2.chosenPriorityLevel).toBe(2);
    expect(res2.rationale).toContain("unconditionally defeats");
  });

  it("evaluates hierarchy precedence rank differences (Priority 3 scalable vs Priority 2)", () => {
    const p3Scalable: ParetoApproachCandidate = {
      name: "Breakthrough Scalable Subsystem",
      claimedPriorityLevel: 3,
      perfGainPercent: 45,
      cognitiveComplexityScore: 10,
    };
    const p2Standard: ParetoApproachCandidate = {
      name: "Standard Architecture",
      claimedPriorityLevel: 2,
      perfGainPercent: 0,
      cognitiveComplexityScore: 5,
    };

    const resA = arbitrateParetoApproaches(p3Scalable, p2Standard);
    expect(resA.winner).toBe("Breakthrough Scalable Subsystem");
    expect(resA.chosenPriorityLevel).toBe(3);

    const resB = arbitrateParetoApproaches(p2Standard, p3Scalable);
    expect(resB.winner).toBe("Breakthrough Scalable Subsystem");
    expect(resB.chosenPriorityLevel).toBe(3);
  });
});
