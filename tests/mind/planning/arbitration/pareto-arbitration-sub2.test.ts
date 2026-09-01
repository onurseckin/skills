import { describe, expect, it } from "bun:test";
import {
  arbitrateMultipleApproaches,
  arbitrateParetoApproaches,
  arbitrateParetoPair,
  checkPriority1Violation,
  computeParetoEfficiencyScore,
  describePriorityLevel,
  extractPerformanceGain,
  filterParetoFrontier,
  PARETO_PRIORITY_LEVELS,
  resolveEffectivePriorityLevel,
  SCALABILITY_THRESHOLD_PERCENT,
  type ParetoApproachCandidate,
} from "../../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";

describe("Pareto Decision Hierarchy & Arbitration Engine", () => {


describe("arbitrateMultipleApproaches", () => {
    it("arbitrates across multiple candidate options and ranks them lexicographically", () => {
      const candidates: ParetoApproachCandidate[] = [
        {
          name: "Approach D (Broken)",
          hasErrors: true,
          perfGainPercent: 100,
        },
        {
          name: "Approach C (Speculative)",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
          cognitiveComplexityScore: 8,
        },
        {
          name: "Approach B (Marginal +8%)",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
          perfGainPercent: 8,
          cognitiveComplexityScore: 7,
        },
        {
          name: "Approach A (Clean Simplicity)",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
          cognitiveComplexityScore: 2,
          perfGainPercent: 0,
        },
        {
          name: "Approach E (High Scalability +35%)",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
          perfGainPercent: 35,
          cognitiveComplexityScore: 4,
        },
      ];

      const result = arbitrateMultipleApproaches(candidates);

      // Approach D is disqualified due to Priority 1
      expect(result.disqualifiedCandidates).toHaveLength(1);
      expect(result.disqualifiedCandidates[0]?.candidateName).toBe("Approach D (Broken)");

      // Approach E (+35% gain) achieves Priority 3 >= 15% and supersedes Priority 2
      expect(result.winner).toBe("Approach E (High Scalability +35%)");
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
      );
      expect(result.candidateRankings).toBeDefined();
      expect(result.candidateRankings?.[0]).toBe("Approach E (High Scalability +35%)");
    });

    it("handles empty candidate array gracefully", () => {
      const result = arbitrateMultipleApproaches([]);
      expect(result.winner).toBe("NONE");
      expect(result.disqualifiedCandidates).toHaveLength(0);
    });

    it("handles single valid candidate immediately", () => {
      const lone: ParetoApproachCandidate = {
        name: "Only Candidate",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      };
      const result = arbitrateMultipleApproaches([lone]);
      expect(result.winner).toBe("Only Candidate");
      expect(result.candidateRankings).toEqual(["Only Candidate"]);
    });
  });

describe("Utility & Frontier Functions", () => {
    it("extracts performance gain from various candidate fields", () => {
      expect(extractPerformanceGain({ name: "A", perfGainPercent: 20 })).toBe(20);
      expect(extractPerformanceGain({ name: "B", throughputGainPercent: 30 })).toBe(30);
      expect(extractPerformanceGain({ name: "C", latencyReductionPercent: 15 })).toBe(15);
      expect(extractPerformanceGain({ name: "D" })).toBe(0);
    });

    it("calculates Pareto efficiency score with 80/20 balance", () => {
      const scoreSimple = computeParetoEfficiencyScore({
        name: "Simple",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
        empiricalValueScore: 90,
      });
      expect(scoreSimple).toBeGreaterThan(100);

      const scoreBroken = computeParetoEfficiencyScore({
        name: "Broken",
        hasErrors: true,
      });
      expect(scoreBroken).toBe(0);
    });

    it("filters non-dominated Pareto frontier candidates", () => {
      const candidates: ParetoApproachCandidate[] = [
        {
          name: "Dominant A",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
          cognitiveComplexityScore: 1,
          empiricalValueScore: 100,
        },
        {
          name: "Dominated B",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
          cognitiveComplexityScore: 10,
          empiricalValueScore: 10,
        },
      ];
      const frontier = filterParetoFrontier(candidates);
      expect(frontier).toHaveLength(1);
      expect(frontier[0]?.name).toBe("Dominant A");
    });

    it("supports arbitrateParetoPair backward-compatible wrapper", () => {
      const candA: ParetoApproachCandidate = {
        name: "A",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
      };
      const candB: ParetoApproachCandidate = {
        name: "B",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
        cognitiveComplexityScore: 8,
      };

      const result = arbitrateParetoPair(candA, candB);
      expect(result.winner).toBe("A");
      expect(result.loser).toBe("B");
      expect(result.winningLevel).toBe(
        PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      );
    });

    it("provides human-readable descriptions for all priority levels", () => {
      expect(describePriorityLevel(1)).toContain("UX Delight");
      expect(describePriorityLevel(2)).toContain("Cognitive Simplicity");
      expect(describePriorityLevel(3)).toContain("Scalability");
      expect(describePriorityLevel(4)).toContain("Speculative Abstraction");
    });
  });
});
