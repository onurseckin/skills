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
describe("1. Pre-Declared Hierarchy Levels & Constants", () => {
    it("exports all 4 standard priority levels and aliases correctly", () => {
      expect(PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS).toBe(1);
      expect(PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS).toBe(1);
      expect(PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY).toBe(2);
      expect(PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY).toBe(2);
      expect(PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY).toBe(3);
      expect(PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT).toBe(3);
      expect(PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION).toBe(4);
      expect(SCALABILITY_THRESHOLD_PERCENT).toBe(15);
      expect(PARETO_DEBATE_CYCLE_THRESHOLD).toBe(2);
      expect(ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD).toBe(10.0);
    });

    it("maps priority level names and labels accurately", () => {
      expect(PARETO_PRIORITY_NAMES[1]).toBe("UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS");
      expect(PARETO_PRIORITY_NAMES[2]).toBe("COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY");
      expect(PARETO_PRIORITY_NAMES[3]).toBe("MEASURABLE_PERFORMANCE_SCALABILITY");
      expect(PARETO_PRIORITY_NAMES[4]).toBe("SPECULATIVE_ABSTRACTION");

      expect(PARETO_LEVEL_NAMES[1]).toContain("Priority 1");
      expect(PARETO_LEVEL_NAMES[2]).toContain("Priority 2");
      expect(PARETO_LEVEL_NAMES[3]).toContain("Priority 3");
      expect(PARETO_LEVEL_NAMES[4]).toContain("Priority 4");

      expect(describePriorityLevel(1)).toContain("UX Delight");
      expect(describePriorityLevel(2)).toContain("Cognitive Simplicity");
      expect(describePriorityLevel(3)).toContain("Scalability");
      expect(describePriorityLevel(4)).toContain("Speculative Abstraction");
    });

    it("evaluates precedence ranks according to the hierarchy (1 > 3 > 2 > 4)", () => {
      expect(getPriorityPrecedenceRank(1)).toBe(1); // Priority 1 is highest
      expect(getPriorityPrecedenceRank(3)).toBe(2); // Priority 3 (>=15% scalability) precedes Priority 2
      expect(getPriorityPrecedenceRank(2)).toBe(3); // Priority 2 (simplicity) precedes Priority 4
      expect(getPriorityPrecedenceRank(4)).toBe(4); // Priority 4 (speculative abstraction) is lowest
    });
  });

describe("2. Priority 1: User Experience Delight & Functional Correctness (Baseline)", () => {
    it("disqualifies candidate with runtime or structural errors immediately", () => {
      const brokenCandidate: ParetoApproachCandidate = {
        name: "Broken Fast Parser",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        perfGainPercent: 90,
        cognitiveComplexityScore: 2,
        hasErrors: true,
      };

      const validCandidate: ParetoApproachCandidate = {
        name: "Standard Reliable Parser",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        perfGainPercent: 0,
        cognitiveComplexityScore: 3,
        hasErrors: false,
      };

      const result = arbitrateParetoApproaches(brokenCandidate, validCandidate);
      expect(result.winner).toBe(validCandidate.name);
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      );
      expect(result.disqualifiedCandidates).toHaveLength(1);
      expect(result.disqualifiedCandidates[0]?.candidateName).toBe(brokenCandidate.name);
      expect(result.disqualifiedCandidates[0]?.failedPriorityLevel).toBe(1);
      expect(result.reason).toContain("is disqualified");
    });

    it("disqualifies candidate with specific functional errors or test failures", () => {
      const candidateWithErrors: ParetoApproachCandidate = {
        name: "Unstable Worker Pool",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        perfGainPercent: 50,
        functionalErrors: ["Deadlock on shutdown", "Memory leak in worker lifecycle"],
      };

      const cleanCandidate: ParetoApproachCandidate = {
        name: "Synchronous Queue Worker",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 4,
      };

      const result = arbitrateParetoApproaches(candidateWithErrors, cleanCandidate);
      expect(result.winner).toBe(cleanCandidate.name);
      expect(result.disqualifiedCandidates).toHaveLength(1);
      expect(result.disqualifiedCandidates[0]?.reason).toContain("2 functional error(s)");
      expect(result.disqualifiedCandidates[0]?.reason).toContain("Deadlock on shutdown");
    });

    it("disqualifies candidate with user experience degradation", () => {
      const jankyCandidate: ParetoApproachCandidate = {
        name: "Blocking Frame Renderer",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        perfGainPercent: 30,
        uxDegradation: true,
      };

      const smoothCandidate: ParetoApproachCandidate = {
        name: "Fluid 60fps Scheduler",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
        uxDegradation: false,
        functionalCorrectnessScore: 1.0,
      };

      const result = arbitrateParetoApproaches(jankyCandidate, smoothCandidate);
      expect(result.winner).toBe(smoothCandidate.name);
      expect(result.disqualifiedCandidates).toHaveLength(1);
      expect(result.disqualifiedCandidates[0]?.reason).toContain(
        "introduces user experience degradation",
      );
    });

    it("disqualifies candidate with correctness score below strict threshold", () => {
      const imperfectCandidate: ParetoApproachCandidate = {
        name: "Approximate Matcher",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        perfGainPercent: 70,
        functionalCorrectnessScore: 0.92,
      };

      const perfectCandidate: ParetoApproachCandidate = {
        name: "Exact Matcher",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        functionalCorrectnessScore: 1.0,
      };

      const result = arbitrateParetoApproaches(imperfectCandidate, perfectCandidate, {
        strictCorrectnessThreshold: 1.0,
      });

      expect(result.winner).toBe(perfectCandidate.name);
      expect(result.disqualifiedCandidates).toHaveLength(1);
      expect(result.disqualifiedCandidates[0]?.reason).toContain("correctness score (0.92)");
    });

    it("handles catastrophic case where all candidates violate Priority 1 baseline", () => {
      const candidateA: ParetoApproachCandidate = {
        name: "Broken Option A",
        hasErrors: true,
      };
      const candidateB: ParetoApproachCandidate = {
        name: "Broken Option B",
        functionalErrors: ["Fatal SIGSEGV"],
      };

      const result = arbitrateParetoApproaches(candidateA, candidateB);
      expect(result.winner).toBe("NONE");
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      );
      expect(result.disqualifiedCandidates).toHaveLength(2);
      expect(result.candidateRankings).toHaveLength(0);
      expect(result.reason).toContain("Both candidates failed Priority 1 baseline");
    });
  });
});
