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
  PARETO_PRIORITY_LEVELS,
  resolveEffectiveParetoPriority,
  resolveEffectivePriorityLevel,
  type ParetoApproachCandidate,
} from "../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";

describe("Pareto Arbitration Deep & Exhaustive Suite", () => {
  describe("Priority Level Extraction & Descriptors", () => {
    it("correctly describes all four priority levels", () => {
      expect(describePriorityLevel(1)).toBe("Priority 1: UX Delight & Functional Correctness");
      expect(describePriorityLevel(2)).toBe(
        "Priority 2: Cognitive Simplicity & Architectural Maintainability",
      );
      expect(describePriorityLevel(3)).toBe(
        "Priority 3: Measurable Performance Scalability (>= 15%)",
      );
      expect(describePriorityLevel(4)).toBe(
        "Priority 4: Speculative Abstraction & Generality (Rejected)",
      );
    });

    it("extracts performance gain from all supported metric properties", () => {
      expect(extractPerformanceGain({ name: "A", perfGainPercent: 12.5 })).toBe(12.5);
      expect(extractPerformanceGain({ name: "B", throughputGainPercent: 22.0 })).toBe(22.0);
      expect(extractPerformanceGain({ name: "C", latencyReductionPercent: 17.5 })).toBe(17.5);
      expect(extractPerformanceGain({ name: "D" })).toBe(0);
    });

    it("evaluates effective priority levels with custom scalability threshold options", () => {
      const candMarginal: ParetoApproachCandidate = {
        name: "Marginal",
        claimedPriorityLevel: 3,
        perfGainPercent: 12,
      };
      expect(resolveEffectivePriorityLevel(candMarginal)).toBe(4);
      expect(resolveEffectivePriorityLevel(candMarginal, { scalabilityThresholdPercent: 10 })).toBe(
        3,
      );
      expect(resolveEffectiveParetoPriority({ name: "Spec", isSpeculativeAbstraction: true })).toBe(
        4,
      );
      expect(resolveEffectiveParetoPriority({ name: "Alias", satisfiesPriority: 1 })).toBe(1);
      expect(resolveEffectiveParetoPriority({ name: "Default" })).toBe(2);
    });

    it("returns correct priority precedence rank for 1..4", () => {
      expect(getPriorityPrecedenceRank(1)).toBe(1);
      expect(getPriorityPrecedenceRank(3)).toBe(2);
      expect(getPriorityPrecedenceRank(2)).toBe(3);
      expect(getPriorityPrecedenceRank(4)).toBe(4);
    });
  });

  describe("Priority 1 Violations & Scoring", () => {
    it("evaluates functional error arrays and custom correctness thresholds", () => {
      expect(
        checkPriority1Violation({
          name: "Err",
          functionalErrors: ["TypeError: null", "OutOfMemory"],
        }),
      ).toContain("2 functional error(s): TypeError: null; OutOfMemory");

      expect(checkPriority1Violation({ name: "Clean", functionalErrors: [] })).toBeUndefined();

      const lowScoreCand = { name: "ScoreTest", functionalCorrectnessScore: 0.95 };
      expect(checkPriority1Violation(lowScoreCand)).toContain("below required baseline (1)");
      expect(
        checkPriority1Violation(lowScoreCand, { strictCorrectnessThreshold: 0.9 }),
      ).toBeUndefined();
    });

    it("computes Pareto efficiency scores across boundary values and error conditions", () => {
      expect(computeParetoEfficiencyScore({ name: "Err", hasErrors: true })).toBe(0);
      expect(computeParetoEfficiencyScore({ name: "Degrade", uxDegradation: true })).toBe(0);

      // Candidate with Priority 1: Base 100, empiricalValue default 80, complexity default 20 -> 100 + (80/20)*10 = 140
      const scoreP1 = computeParetoEfficiencyScore({ name: "P1", claimedPriorityLevel: 1 });
      expect(scoreP1).toBe(140);

      // Candidate with Priority 3 and perfBonus (perfGain >= 15)
      const scoreP3 = computeParetoEfficiencyScore({
        name: "P3",
        claimedPriorityLevel: 3,
        perfGainPercent: 25,
        empiricalValueScore: 100,
        cognitiveComplexityScore: 10,
      });
      // Base 85 + (100/10)*10 (100) + min(30, 25) (25) = 210
      expect(scoreP3).toBe(210);
    });
  });

  describe("Arbitration Pairwise Evaluation & Intra-Level Tie Breaks", () => {
    it("handles mutual Priority 1 disqualification with winner NONE", () => {
      const res = arbitrateParetoApproaches(
        { name: "Bad1", hasErrors: true },
        { name: "Bad2", functionalErrors: ["Segfault"] },
      );
      expect(res.winner).toBe("NONE");
      expect(res.disqualifiedCandidates).toHaveLength(2);
      expect(res.reason).toContain("Both candidates failed Priority 1 baseline");
    });

    it("arbitrates pairwise comparison with deltaMetrics latency & throughput differences", () => {
      const candA: ParetoApproachCandidate = {
        name: "ArchA",
        claimedPriorityLevel: 3,
        perfGainPercent: 30,
        throughputGainPercent: 40,
        latencyReductionPercent: 25,
        cognitiveComplexityScore: 5,
      };
      const candB: ParetoApproachCandidate = {
        name: "ArchB",
        claimedPriorityLevel: 3,
        perfGainPercent: 20,
        throughputGainPercent: 20,
        latencyReductionPercent: 10,
        cognitiveComplexityScore: 8,
      };

      const res = arbitrateParetoPair(candA, candB);
      expect(res.winner).toBe("ArchA");
      expect(res.deltaMetrics?.throughputGainDiffPercent).toBe(20);
      expect(res.deltaMetrics?.latencyReductionDiffPercent).toBe(15);
      expect(res.deltaMetrics?.complexityDiff).toBe(-3);
    });

    it("breaks Priority 1, 2, 3, and 4 ties correctly", () => {
      const p1A: ParetoApproachCandidate = {
        name: "P1_A",
        claimedPriorityLevel: 1,
        cognitiveComplexityScore: 5,
      };
      const p1B: ParetoApproachCandidate = {
        name: "P1_B",
        claimedPriorityLevel: 1,
        cognitiveComplexityScore: 10,
      };
      const p1C: ParetoApproachCandidate = {
        name: "P1_C",
        claimedPriorityLevel: 1,
        cognitiveComplexityScore: 5,
        perfGainPercent: 15,
      };
      expect(arbitrateParetoApproaches(p1A, p1B).winner).toBe("P1_A");
      expect(arbitrateParetoApproaches(p1A, p1C).winner).toBe("P1_C");

      const p2A: ParetoApproachCandidate = {
        name: "P2_A",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 2,
      };
      const p2B: ParetoApproachCandidate = {
        name: "P2_B",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 4,
      };
      const p2C: ParetoApproachCandidate = {
        name: "P2_C",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 2,
        perfGainPercent: 10,
      };
      expect(arbitrateParetoApproaches(p2A, p2B).winner).toBe("P2_A");
      expect(arbitrateParetoApproaches(p2A, p2C).winner).toBe("P2_C");

      const p3A: ParetoApproachCandidate = {
        name: "P3_A",
        claimedPriorityLevel: 3,
        perfGainPercent: 40,
        cognitiveComplexityScore: 6,
      };
      const p3B: ParetoApproachCandidate = {
        name: "P3_B",
        claimedPriorityLevel: 3,
        perfGainPercent: 20,
        cognitiveComplexityScore: 6,
      };
      const p3C: ParetoApproachCandidate = {
        name: "P3_C",
        claimedPriorityLevel: 3,
        perfGainPercent: 40,
        cognitiveComplexityScore: 2,
      };
      expect(arbitrateParetoApproaches(p3A, p3B).winner).toBe("P3_A");
      expect(arbitrateParetoApproaches(p3A, p3C).winner).toBe("P3_C");

      const p4A: ParetoApproachCandidate = {
        name: "P4_A",
        claimedPriorityLevel: 4,
        cognitiveComplexityScore: 3,
      };
      const p4B: ParetoApproachCandidate = {
        name: "P4_B",
        claimedPriorityLevel: 4,
        cognitiveComplexityScore: 7,
      };
      expect(arbitrateParetoApproaches(p4A, p4B).winner).toBe("P4_A");
      expect(arbitrateParetoApproaches(p4A, { ...p4A, name: "P4_D" }).winner).toBe("P4_A");
    });
  });

  describe("Frontier Filtering & Multi-Approach Engine", () => {
    it("filters Pareto Frontier correctly with dominated and non-dominated approaches", () => {
      const dominant: ParetoApproachCandidate = {
        name: "Dominant",
        claimedPriorityLevel: 1,
        cognitiveComplexityScore: 2,
        empiricalValueScore: 100,
      };
      const dominated: ParetoApproachCandidate = {
        name: "Dominated",
        claimedPriorityLevel: 4,
        cognitiveComplexityScore: 10,
        empiricalValueScore: 20,
      };

      const frontier = filterParetoFrontier([dominant, dominated]);
      expect(frontier).toHaveLength(1);
      expect(frontier[0]?.name).toBe("Dominant");
    });

    it("handles arbitrateMultipleApproaches with 0 candidates, all disqualified, and exactly 1 candidate", () => {
      expect(arbitrateMultipleApproaches([]).winner).toBe("NONE");

      const allDisq = arbitrateMultipleApproaches([
        { name: "D1", hasErrors: true },
        { name: "D2", uxDegradation: true },
      ]);
      expect(allDisq.winner).toBe("NONE");
      expect(allDisq.disqualifiedCandidates).toHaveLength(2);

      const loneRes = arbitrateMultipleApproaches([{ name: "Lone", claimedPriorityLevel: 1 }]);
      expect(loneRes.winner).toBe("Lone");
      expect(loneRes.rankedCandidates).toHaveLength(1);
      expect(loneRes.paretoFrontier).toHaveLength(1);
    });

    it("arbitrates multi-candidate sets with explicit baseline and debate deadlock cycles", () => {
      const candA: ParetoApproachCandidate = { name: "A", claimedPriorityLevel: 1 };
      const candB: ParetoApproachCandidate = {
        name: "B",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 4,
      };
      const candC: ParetoApproachCandidate = {
        name: "C",
        claimedPriorityLevel: 3,
        perfGainPercent: 30,
      };

      const res = arbitrateParetoCandidates([candB, candC, candA], candB, {
        topic: "Architecture Consolidation",
        debateCycles: 4,
      });

      expect(res.winner).toBe("A");
      expect(res.loser).toBe("C");
      expect(res.candidateRankings).toEqual(["A", "C", "B"]);
      expect(res.forcedByThreshold).toBe(true);

      const deadlockRes = enforcePreDeclaredParetoArbitration("Storage Deadlock", 3, [
        candB,
        candC,
      ]);
      expect(deadlockRes.winner).toBe("C");
      expect(deadlockRes.forcedByThreshold).toBe(true);
      expect(deadlockRes.topic).toBe("Storage Deadlock");
    });
  });
});
