import { describe, expect, it } from "bun:test";
import {
  arbitrateMultipleApproaches,
  arbitrateParetoApproaches,
  arbitrateParetoCandidates,
  arbitrateParetoPair,
  computeParetoEfficiencyScore,
  enforcePreDeclaredParetoArbitration,
  filterParetoFrontier,
  type ParetoApproachCandidate,
} from "../../../../olt/scripts/src/mind/planning/index.ts";

describe("Pareto Decision Hierarchy & Arbitration Suite - Flow", () => {
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
      const p2A: ParetoApproachCandidate = {
        name: "P2A",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 4,
      };
      const p2B: ParetoApproachCandidate = {
        name: "P2B",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 9,
      };
      expect(arbitrateParetoApproaches(p2A, p2B).winner).toBe("P2A");

      const p2C: ParetoApproachCandidate = {
        name: "P2C",
        claimedPriorityLevel: 2,
        cognitiveComplexityScore: 4,
        perfGainPercent: 12,
      };
      expect(arbitrateParetoApproaches(p2A, p2C).winner).toBe("P2C");
    });

    it("breaks Priority 3 ties by performance gain, complexity, and default order", () => {
      const p3A: ParetoApproachCandidate = {
        name: "P3A",
        claimedPriorityLevel: 3,
        perfGainPercent: 40,
        cognitiveComplexityScore: 8,
      };
      const p3B: ParetoApproachCandidate = {
        name: "P3B",
        claimedPriorityLevel: 3,
        perfGainPercent: 25,
        cognitiveComplexityScore: 8,
      };
      expect(arbitrateParetoApproaches(p3A, p3B).winner).toBe("P3A");

      const p3C: ParetoApproachCandidate = {
        name: "P3C",
        claimedPriorityLevel: 3,
        perfGainPercent: 40,
        cognitiveComplexityScore: 3,
      };
      expect(arbitrateParetoApproaches(p3A, p3C).winner).toBe("P3C");
    });

    it("breaks Priority 4 ties by simplicity and default order", () => {
      const p4A: ParetoApproachCandidate = {
        name: "P4A",
        claimedPriorityLevel: 4,
        cognitiveComplexityScore: 5,
      };
      const p4B: ParetoApproachCandidate = {
        name: "P4B",
        claimedPriorityLevel: 4,
        cognitiveComplexityScore: 12,
      };
      expect(arbitrateParetoApproaches(p4A, p4B).winner).toBe("P4A");
      expect(arbitrateParetoApproaches(p4A, { ...p4A, name: "P4C" }).winner).toBe("P4A");
    });

    it("supports arbitrateParetoPair alias", () => {
      const res = arbitrateParetoPair(
        { name: "A", claimedPriorityLevel: 1 },
        { name: "B", claimedPriorityLevel: 2 },
      );
      expect(res.winner).toBe("A");
    });
  });

  describe("Efficiency Score & Frontier Operations", () => {
    it("computes Pareto efficiency scores with various baseline combinations", () => {
      expect(computeParetoEfficiencyScore({ name: "Err", hasErrors: true })).toBe(0);
      expect(computeParetoEfficiencyScore({ name: "UX", uxDegradation: true })).toBe(0);

      const candP1 = computeParetoEfficiencyScore({ name: "P1", claimedPriorityLevel: 1 });
      expect(candP1).toBe(140);

      const candP2 = computeParetoEfficiencyScore({ name: "P2", claimedPriorityLevel: 2 });
      expect(candP2).toBe(110);

      const candP3 = computeParetoEfficiencyScore({
        name: "P3",
        claimedPriorityLevel: 3,
        perfGainPercent: 20,
      });
      expect(candP3).toBe(145);

      const candP4 = computeParetoEfficiencyScore({ name: "P4", claimedPriorityLevel: 4 });
      expect(candP4).toBe(50);
    });

    it("filters Pareto frontiers across empty, single, and multi-candidate sets", () => {
      expect(filterParetoFrontier([])).toEqual([]);
      expect(filterParetoFrontier([{ name: "Single" }])).toHaveLength(1);

      const candGood = {
        name: "Good",
        claimedPriorityLevel: 1 as const,
        cognitiveComplexityScore: 2,
        empiricalValueScore: 90,
      };
      const candDominated = {
        name: "Dominated",
        claimedPriorityLevel: 4 as const,
        cognitiveComplexityScore: 20,
        empiricalValueScore: 10,
      };
      const frontier = filterParetoFrontier([candGood, candDominated]);
      expect(frontier).toHaveLength(1);
      expect(frontier[0]?.name).toBe("Good");
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
