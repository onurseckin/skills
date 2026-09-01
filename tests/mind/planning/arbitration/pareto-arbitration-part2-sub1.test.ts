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
  describe("Priority 1: User Experience Delight & Functional Correctness", () => {
    it("disqualifies candidate with runtime or structural errors immediately", () => {
      const candidateBroken: ParetoApproachCandidate = {
        name: "Broken Super Fast Approach",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        perfGainPercent: 85,
        cognitiveComplexityScore: 2,
        hasErrors: true,
      };

      const candidateSimple: ParetoApproachCandidate = {
        name: "Simple Baseline Approach",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        perfGainPercent: 0,
        cognitiveComplexityScore: 3,
        hasErrors: false,
      };

      const result = arbitrateParetoApproaches(candidateBroken, candidateSimple);
      expect(result.winner).toBe(candidateSimple.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      );
      expect(result.disqualifiedCandidates).toHaveLength(1);
      expect(result.disqualifiedCandidates[0]?.candidateName).toBe(candidateBroken.name);
      expect(result.reason).toContain("is disqualified");
    });

    it("disqualifies candidate with functional errors or test failures", () => {
      const candidateBuggy: ParetoApproachCandidate = {
        name: "Buggy Approach",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        functionalErrors: ["Index out of bounds on empty queue", "Data loss on restart"],
      };

      const candidateWorking: ParetoApproachCandidate = {
        name: "Working Approach",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 5,
      };

      const result = arbitrateParetoApproaches(candidateBuggy, candidateWorking);
      expect(result.winner).toBe(candidateWorking.name);
      expect(result.disqualifiedCandidates).toHaveLength(1);
      expect(result.disqualifiedCandidates[0]?.reason).toContain("functional error(s)");
    });

    it("disqualifies candidate with user experience degradation", () => {
      const candidateDegraded: ParetoApproachCandidate = {
        name: "Janky UI High Perf Approach",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        perfGainPercent: 40,
        uxDegradation: true,
      };

      const candidateDelight: ParetoApproachCandidate = {
        name: "Fluid Responsive UI Approach",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
        uxDegradation: false,
        functionalCorrectnessScore: 1.0,
      };

      const result = arbitrateParetoApproaches(candidateDegraded, candidateDelight);
      expect(result.winner).toBe(candidateDelight.name);
      expect(result.disqualifiedCandidates[0]?.reason).toContain(
        "introduces user experience degradation",
      );
    });

    it("handles case where all candidates violate Priority 1 baseline", () => {
      const candidateA: ParetoApproachCandidate = {
        name: "Error Candidate A",
        hasErrors: true,
      };
      const candidateB: ParetoApproachCandidate = {
        name: "Error Candidate B",
        hasErrors: true,
      };

      const result = arbitrateParetoApproaches(candidateA, candidateB);
      expect(result.winner).toBe("NONE");
      expect(result.disqualifiedCandidates).toHaveLength(2);
      expect(result.candidateRankings).toHaveLength(0);
    });
  });

  describe("Priority 2: Cognitive Simplicity & Architectural Maintainability", () => {
    it("unconditionally defeats marginal performance gains (< 15% delta)", () => {
      const candidateSimple: ParetoApproachCandidate = {
        name: "Simple In-Memory Cache",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 3,
        perfGainPercent: 0,
      };

      const candidateComplex: ParetoApproachCandidate = {
        name: "Over-engineered Distributed Segment Tree Cache",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        cognitiveComplexityScore: 9,
        perfGainPercent: 12, // 12% is < 15% threshold
      };

      const result = arbitrateParetoApproaches(candidateSimple, candidateComplex);
      expect(result.winner).toBe(candidateSimple.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      );
      expect(result.reason).toContain("unconditionally defeats");
      expect(result.reason).toContain("12%");
      expect(result.reason).toContain(`${SCALABILITY_THRESHOLD_PERCENT}% scalability threshold`);
      expect(result.marginDelta).toBe(12);
    });

    it("breaks ties between two Priority 2 approaches using cognitive complexity score", () => {
      const approachSimple: ParetoApproachCandidate = {
        name: "Lightweight Map Store",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
      };

      const approachModerate: ParetoApproachCandidate = {
        name: "Moderate Helper Store",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 6,
      };

      const result = arbitrateParetoApproaches(approachSimple, approachModerate);
      expect(result.winner).toBe(approachSimple.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      );
      expect(result.reason).toContain("lower cognitive complexity score (2 vs 6)");
    });
  });

  describe("Priority 3: Measurable Performance Scalability & Resource Efficiency (>= 15%)", () => {
    it("takes precedence over simplicity when empirical gain is >= 15%", () => {
      const candidateSimple: ParetoApproachCandidate = {
        name: "Simple Serial Parser",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
        perfGainPercent: 0,
      };

      const candidateScalable: ParetoApproachCandidate = {
        name: "Zero-Copy SIMD Stream Parser",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        cognitiveComplexityScore: 5,
        perfGainPercent: 45, // 45% is >= 15% threshold
      };

      const result = arbitrateParetoApproaches(candidateSimple, candidateScalable);
      expect(result.winner).toBe(candidateScalable.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
      );
      expect(result.marginDelta).toBe(45);
    });

    it("breaks ties among Priority 3 candidates by higher throughput gain", () => {
      const approachFast: ParetoApproachCandidate = {
        name: "Multi-threaded Chunking",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        perfGainPercent: 60,
        cognitiveComplexityScore: 6,
      };

      const approachModerate: ParetoApproachCandidate = {
        name: "Worker Pool Chunking",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        perfGainPercent: 30,
        cognitiveComplexityScore: 6,
      };

      const result = arbitrateParetoApproaches(approachFast, approachModerate);
      expect(result.winner).toBe(approachFast.name);
      expect(result.reason).toContain("higher throughput gain (60% vs 30%");
    });
  });

  describe("Priority 4: Speculative Abstraction & Generality", () => {
    it("unconditionally rejects speculative abstraction against valid baseline", () => {
      const candidateSpeculative: ParetoApproachCandidate = {
        name: "Generic Polymorphic Meta-Framework",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
        isSpeculativeAbstraction: true,
        cognitiveComplexityScore: 10,
      };

      const candidateConcrete: ParetoApproachCandidate = {
        name: "Concrete Target Implementation",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 3,
      };

      const result = arbitrateParetoApproaches(candidateSpeculative, candidateConcrete);
      expect(result.winner).toBe(candidateConcrete.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      );
    });
  });
});
