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
  type ParetoArbitrationOptions,
  type ParetoCandidate,
} from "../../../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";
import {
  EmpiricalCrucibleEngine,
  type FinalizeSpikeOptions,
  type SpikeFilterOptions,
} from "../../../../../olt/scripts/src/mind/crucible/crucible-protocol.ts";
import { SettledInvariantRepository } from "../../../../../olt/scripts/src/mind/crucible/bedrock-commitment.ts";
import {
  DEFAULT_SPIKE_TIMEBOX_MS,
  ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD,
  PROTOTYPE_SPIKE_STATUSES,
  SETTLED_INVARIANT_STATUSES,
  type AntiPatternRecord,
  type FalsifiableHypothesis,
  type PrototypeSpikeConfig,
  type ReopenChallengeInput,
  type SettledInvariant,
  type SettledInvariantStore,
} from "../../../../../olt/scripts/src/mind/crucible/types.ts";

describe("Pre-Declared Pareto Decision Hierarchy & Arbitration Suite", () => {
describe("3. Priority 2 vs Priority 3 & Marginal Gains (<15%) Rejection", () => {
    it("unconditionally rejects marginal performance gains (< 15%) in favor of cognitive simplicity", () => {
      const candidateSimple: ParetoApproachCandidate = {
        name: "Simple In-Memory Store",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 3,
        perfGainPercent: 0,
      };

      const candidateMarginal: ParetoApproachCandidate = {
        name: "Complex Segment Tree Store",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        cognitiveComplexityScore: 12,
        perfGainPercent: 8, // 8% is strictly below 15% threshold
      };

      const result = arbitrateParetoApproaches(candidateSimple, candidateMarginal);
      expect(result.winner).toBe(candidateSimple.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      );
      expect(result.reason).toContain("unconditionally defeats");
      expect(result.reason).toContain("8%");
      expect(result.reason).toContain("below the 15% scalability threshold");
      expect(result.marginDelta).toBe(8);
    });

    it("downgrades candidate claiming Priority 3 with <15% gain to Priority 4 (speculative abstraction)", () => {
      const marginalCandidate: ParetoApproachCandidate = {
        name: "Micro Optimized Loop",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        perfGainPercent: 14.9, // Just below 15%
      };

      const effLevel = resolveEffectivePriorityLevel(marginalCandidate);
      expect(effLevel).toBe(PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION);
    });

    it("selects candidate when performance gain is significant (>= 15%)", () => {
      const candidateSimple: ParetoApproachCandidate = {
        name: "Basic Serial Sorter",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
        perfGainPercent: 0,
      };

      const candidateScalable: ParetoApproachCandidate = {
        name: "Radix SIMD Parallel Sorter",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        cognitiveComplexityScore: 6,
        perfGainPercent: 55, // 55% >= 15% threshold
      };

      const result = arbitrateParetoApproaches(candidateSimple, candidateScalable);
      expect(result.winner).toBe(candidateScalable.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
      );
      expect(result.marginDelta).toBe(55);
      expect(result.reason).toContain("supersedes");
    });

    it("breaks ties between two Priority 2 candidates via lower cognitive complexity score", () => {
      const simpleApproach: ParetoApproachCandidate = {
        name: "Clean Helper Function",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
      };

      const verboseApproach: ParetoApproachCandidate = {
        name: "Multi-layered Helper Classes",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 7,
      };

      const result = arbitrateParetoApproaches(simpleApproach, verboseApproach);
      expect(result.winner).toBe(simpleApproach.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      );
      expect(result.reason).toContain("lower cognitive complexity score (2 vs 7)");
    });

    it("breaks ties between two Priority 3 candidates via higher performance gain", () => {
      const candidateFast: ParetoApproachCandidate = {
        name: "GPU Shader Compute",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        throughputGainPercent: 120,
        cognitiveComplexityScore: 8,
      };

      const candidateFaster: ParetoApproachCandidate = {
        name: "Direct VRAM Texture Buffer",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        throughputGainPercent: 250,
        cognitiveComplexityScore: 8,
      };

      const result = arbitrateParetoApproaches(candidateFast, candidateFaster);
      expect(result.winner).toBe(candidateFaster.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
      );
      expect(result.reason).toContain("higher throughput gain (250% vs 120%");
    });
  });

describe("4. Priority 4: Speculative Abstraction Rejection", () => {
    it("unconditionally rejects speculative abstraction against any valid baseline", () => {
      const speculative: ParetoApproachCandidate = {
        name: "Universal Polymorphic Meta-Schema",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
        isSpeculativeAbstraction: true,
        cognitiveComplexityScore: 15,
      };

      const practical: ParetoApproachCandidate = {
        name: "Typed Interface Spec",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
      };

      const result = arbitrateParetoApproaches(speculative, practical);
      expect(result.winner).toBe(practical.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      );
      expect(result.loser).toBe(speculative.name);
    });

    it("breaks ties between Priority 4 candidates by preferring lower cognitive complexity", () => {
      const specA: ParetoApproachCandidate = {
        name: "Speculative A",
        isSpeculativeAbstraction: true,
        cognitiveComplexityScore: 6,
      };
      const specB: ParetoApproachCandidate = {
        name: "Speculative B",
        isSpeculativeAbstraction: true,
        cognitiveComplexityScore: 14,
      };

      const result = arbitrateParetoApproaches(specA, specB);
      expect(result.winner).toBe(specA.name);
      expect(result.reason).toContain("lower cognitive complexity (6 vs 14)");
    });
  });
});
