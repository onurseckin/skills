import { describe, expect, it } from "bun:test";
import {
  arbitrateMultipleApproaches,
  arbitrateParetoApproaches,
  arbitrateParetoCandidates,
  arbitrateParetoPair,
  checkPriority1Violation,
  computeParetoEfficiencyScore,
  describePriorityLevel,
  enforcePreDeclaredParetoArbitration,
  extractPerformanceGain,
  filterParetoFrontier,
  getPriorityPrecedenceRank,
  PARETO_DEBATE_CYCLE_THRESHOLD,
  PARETO_LEVEL_NAMES,
  PARETO_PRIORITY_LEVELS,
  PARETO_PRIORITY_NAMES,
  resolveEffectiveParetoPriority,
  resolveEffectivePriorityLevel,
  SCALABILITY_THRESHOLD_PERCENT,
  type ParetoApproachCandidate,
} from "../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";

describe("Pareto Decision Hierarchy & Arbitration Suite", () => {
  describe("Priority Level Resolution & Descriptors", () => {
    it("exports priority constants and describes all priority levels", () => {
      expect(PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS).toBe(1);
      expect(PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY).toBe(2);
      expect(PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT).toBe(3);
      expect(PARETO_PRIORITY_NAMES[1]).toBe("UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS");
      expect(PARETO_LEVEL_NAMES[4]).toContain("Priority 4");
      expect(SCALABILITY_THRESHOLD_PERCENT).toBe(15);
      expect(PARETO_DEBATE_CYCLE_THRESHOLD).toBe(2);

      expect(describePriorityLevel(1)).toContain("UX Delight");
      expect(describePriorityLevel(2)).toContain("Cognitive Simplicity");
      expect(describePriorityLevel(3)).toContain("Scalability");
      expect(describePriorityLevel(4)).toContain("Speculative Abstraction");

      expect(getPriorityPrecedenceRank(1)).toBe(1);
      expect(getPriorityPrecedenceRank(3)).toBe(2);
      expect(getPriorityPrecedenceRank(2)).toBe(3);
      expect(getPriorityPrecedenceRank(4)).toBe(4);
    });

    it("resolves effective priority levels and handles aliases and downgrades", () => {
      expect(resolveEffectivePriorityLevel({ name: "A", isSpeculativeAbstraction: true })).toBe(4);
      expect(
        resolveEffectivePriorityLevel({ name: "B", claimedPriorityLevel: 3, perfGainPercent: 10 }),
      ).toBe(4);
      expect(
        resolveEffectivePriorityLevel({ name: "C", claimedPriorityLevel: 3, perfGainPercent: 25 }),
      ).toBe(3);
      expect(resolveEffectiveParetoPriority({ name: "D", satisfiesPriority: 2 })).toBe(2);
      expect(resolveEffectivePriorityLevel({ name: "E" })).toBe(2);
    });

    it("extracts performance gain across diverse candidate metrics", () => {
      expect(extractPerformanceGain({ name: "A", perfGainPercent: 40 })).toBe(40);
      expect(extractPerformanceGain({ name: "B", throughputGainPercent: 25 })).toBe(25);
      expect(extractPerformanceGain({ name: "C", latencyReductionPercent: 18 })).toBe(18);
      expect(extractPerformanceGain({ name: "D" })).toBe(0);
    });
  });

  describe("Priority 1 Evaluation & Asymmetric Disqualification", () => {
    it("evaluates Priority 1 violations including correctness thresholds", () => {
      expect(checkPriority1Violation({ name: "A", hasErrors: true })).toContain("errors");
      expect(
        checkPriority1Violation({ name: "B", functionalErrors: ["Contract mismatch"] }),
      ).toContain("functional error");
      expect(checkPriority1Violation({ name: "C", uxDegradation: true })).toContain("degradation");
      expect(checkPriority1Violation({ name: "D", functionalCorrectnessScore: 0.8 })).toContain(
        "below required baseline",
      );
      expect(
        checkPriority1Violation(
          { name: "E", functionalCorrectnessScore: 0.8 },
          { strictCorrectnessThreshold: 0.7 },
        ),
      ).toBeUndefined();
      expect(checkPriority1Violation({ name: "F" })).toBeUndefined();
    });

    it("handles asymmetric and mutual Priority 1 disqualifications with IDs", () => {
      const candGood: ParetoApproachCandidate = { id: "c-good", name: "Good Candidate" };
      const candBad: ParetoApproachCandidate = {
        id: "c-bad",
        name: "Bad Candidate",
        hasErrors: true,
      };

      const resA = arbitrateParetoApproaches(candGood, candBad);
      expect(resA.winner).toBe("Good Candidate");
      expect(resA.disqualifiedCandidates[0]?.candidateId).toBe("c-bad");

      const resB = arbitrateParetoApproaches(candBad, candGood);
      expect(resB.winner).toBe("Good Candidate");
      expect(resB.loser).toBe("Bad Candidate");

      const resBoth = arbitrateParetoApproaches(candBad, { name: "Bad 2", uxDegradation: true });
      expect(resBoth.winner).toBe("NONE");
      expect(resBoth.disqualifiedCandidates).toHaveLength(2);
    });
  });

  describe("Precedence & Marginal Gain Rules", () => {
    it("enforces Priority 2 victory over marginal Priority 3 in both candidate positions", () => {
      const candSimp: ParetoApproachCandidate = {
        name: "Simp",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 2,
      };
      const candMarg: ParetoApproachCandidate = {
        name: "Marg",
        claimedPriorityLevel: 3,
        perfGainPercent: 10,
        cognitiveComplexityScore: 8,
      };

      const res1 = arbitrateParetoApproaches(candSimp, candMarg);
      expect(res1.winner).toBe("Simp");
      expect(res1.reason).toContain("unconditionally defeats");

      const res2 = arbitrateParetoApproaches(candMarg, candSimp);
      expect(res2.winner).toBe("Simp");
      expect(res2.reason).toContain("unconditionally defeats");
    });

    it("evaluates hierarchy rank precedence across priority levels with metric diffs", () => {
      const candUX: ParetoApproachCandidate = { name: "UX", claimedPriorityLevel: 1 };
      const candScal: ParetoApproachCandidate = {
        name: "Scal",
        claimedPriorityLevel: 3,
        perfGainPercent: 30,
        throughputGainPercent: 30,
        latencyReductionPercent: 20,
      };
      const candSpec: ParetoApproachCandidate = {
        name: "Spec",
        claimedPriorityLevel: 4,
        throughputGainPercent: 5,
        latencyReductionPercent: 5,
      };

      const res1 = arbitrateParetoApproaches(candUX, candScal);
      expect(res1.winner).toBe("UX");
      expect(res1.deltaMetrics?.throughputGainDiffPercent).toBeDefined();

      const res2 = arbitrateParetoApproaches(candSpec, candScal);
      expect(res2.winner).toBe("Scal");
    });
  });

  describe("Intra-Level Tie Breaking (All 4 Levels)", () => {
    it("breaks Priority 1 ties by complexity, performance, and default order", () => {
      const p1LowComp: ParetoApproachCandidate = {
        name: "P1A",
        claimedPriorityLevel: 1,
        cognitiveComplexityScore: 2,
      };
      const p1HighComp: ParetoApproachCandidate = {
        name: "P1B",
        claimedPriorityLevel: 1,
        cognitiveComplexityScore: 6,
      };
      expect(arbitrateParetoApproaches(p1LowComp, p1HighComp).winner).toBe("P1A");

      const p1HighPerf: ParetoApproachCandidate = {
        name: "P1C",
        claimedPriorityLevel: 1,
        cognitiveComplexityScore: 2,
        perfGainPercent: 20,
      };
      expect(arbitrateParetoApproaches(p1LowComp, p1HighPerf).winner).toBe("P1C");
      expect(arbitrateParetoApproaches(p1LowComp, { ...p1LowComp, name: "P1D" }).winner).toBe(
        "P1A",
      );
    });

    it("breaks Priority 2 ties by complexity, performance, and default order", () => {
      const p2LowComp: ParetoApproachCandidate = {
        name: "P2L",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 2,
      };
      const p2HighComp: ParetoApproachCandidate = {
        name: "P2H",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 6,
      };
      expect(arbitrateParetoApproaches(p2LowComp, p2HighComp).winner).toBe("P2L");

      const p2A: ParetoApproachCandidate = {
        name: "P2A",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 3,
        perfGainPercent: 10,
      };
      const p2B: ParetoApproachCandidate = {
        name: "P2B",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 3,
        perfGainPercent: 0,
      };
      expect(arbitrateParetoApproaches(p2A, p2B).winner).toBe("P2A");
      expect(arbitrateParetoApproaches(p2B, p2A).winner).toBe("P2A");
      expect(arbitrateParetoApproaches(p2A, { ...p2A, name: "P2C" }).winner).toBe("P2A");
    });

    it("breaks Priority 3 ties by performance, complexity, and default order", () => {
      const p3HighPerf: ParetoApproachCandidate = {
        name: "P3H",
        claimedPriorityLevel: 3,
        perfGainPercent: 50,
      };
      const p3LowPerf: ParetoApproachCandidate = {
        name: "P3L",
        claimedPriorityLevel: 3,
        perfGainPercent: 30,
      };
      expect(arbitrateParetoApproaches(p3HighPerf, p3LowPerf).winner).toBe("P3H");

      const p3A: ParetoApproachCandidate = {
        name: "P3A",
        claimedPriorityLevel: 3,
        perfGainPercent: 30,
        cognitiveComplexityScore: 4,
      };
      const p3B: ParetoApproachCandidate = {
        name: "P3B",
        claimedPriorityLevel: 3,
        perfGainPercent: 30,
        cognitiveComplexityScore: 8,
      };
      expect(arbitrateParetoApproaches(p3A, p3B).winner).toBe("P3A");
      expect(arbitrateParetoApproaches(p3A, { ...p3A, name: "P3C" }).winner).toBe("P3A");
    });

    it("breaks Priority 4 ties by complexity and default order", () => {
      const p4A: ParetoApproachCandidate = {
        name: "P4A",
        claimedPriorityLevel: 4,
        cognitiveComplexityScore: 4,
      };
      const p4B: ParetoApproachCandidate = {
        name: "P4B",
        claimedPriorityLevel: 4,
        cognitiveComplexityScore: 9,
      };
      expect(arbitrateParetoApproaches(p4A, p4B).winner).toBe("P4A");
      expect(arbitrateParetoApproaches(p4A, { ...p4A, name: "P4C" }).winner).toBe("P4A");
    });
  });

  describe("Efficiency Scoring, Frontier & Multi-Approach Engine", () => {
    it("computes Pareto efficiency scores and filters frontiers", () => {
      expect(computeParetoEfficiencyScore({ name: "Err", hasErrors: true })).toBe(0);
      const score = computeParetoEfficiencyScore({
        name: "Valid",
        claimedPriorityLevel: 3,
        perfGainPercent: 30,
        empiricalValueScore: 95,
        implementationEffortScore: 10,
      });
      expect(score).toBeGreaterThan(120);

      expect(filterParetoFrontier([])).toEqual([]);
      expect(filterParetoFrontier([{ name: "Single" }])).toHaveLength(1);
      expect(
        filterParetoFrontier([
          { name: "Bad1", hasErrors: true },
          { name: "Bad2", uxDegradation: true },
        ]),
      ).toHaveLength(1);

      const pairRes = arbitrateParetoPair({ name: "A", claimedPriorityLevel: 2 }, { name: "B" });
      expect(pairRes.winner).toBe("A");
    });

    it("arbitrates multiple approaches and enforces deadlock thresholds", () => {
      expect(arbitrateMultipleApproaches([])).toMatchObject({ winner: "NONE" });
      expect(arbitrateMultipleApproaches([{ name: "Err", hasErrors: true }])).toMatchObject({
        winner: "NONE",
      });

      const candSingle: ParetoApproachCandidate = { name: "Solo", claimedPriorityLevel: 2 };
      const resSolo = arbitrateParetoCandidates([candSingle]);
      expect(resSolo.winner).toBe("Solo");
      expect(resSolo.rankedCandidates).toHaveLength(1);

      const c1: ParetoApproachCandidate = {
        name: "C1",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 3,
      };
      const c2: ParetoApproachCandidate = {
        name: "C2",
        claimedPriorityLevel: 3,
        perfGainPercent: 40,
        cognitiveComplexityScore: 5,
      };
      const resMulti = arbitrateMultipleApproaches([c1, c2], c1, {
        topic: "Arch Debate",
        debateCycles: 3,
        strictThreshold: true,
      });
      expect(resMulti.winner).toBe("C2");
      expect(resMulti.forcedByThreshold).toBe(true);

      const resDeadlock = enforcePreDeclaredParetoArbitration("Deadlock Topic", 2, [c1, c2]);
      expect(resDeadlock.winner).toBe("C2");
      expect(resDeadlock.topic).toBe("Deadlock Topic");
    });
  });
});
