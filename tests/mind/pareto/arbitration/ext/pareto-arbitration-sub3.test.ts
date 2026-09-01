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


describe("5. Multi-Candidate Arbitration & Frontier Filtering", () => {
    it("arbitrates across multiple candidate options and ranks them lexicographically", () => {
      const candidates: ParetoApproachCandidate[] = [
        {
          name: "Broken Cand",
          hasErrors: true,
        },
        {
          name: "Speculative Cand",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
          cognitiveComplexityScore: 8,
        },
        {
          name: "Marginal +10% Cand",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
          perfGainPercent: 10,
          cognitiveComplexityScore: 6,
        },
        {
          name: "Clean Simplicity Cand",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
          cognitiveComplexityScore: 2,
        },
        {
          name: "Scalable +40% Cand",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
          perfGainPercent: 40,
          cognitiveComplexityScore: 4,
        },
      ];

      const result = arbitrateMultipleApproaches(candidates);

      expect(result.disqualifiedCandidates).toHaveLength(1);
      expect(result.disqualifiedCandidates[0]?.candidateName).toBe("Broken Cand");

      expect(result.winner).toBe("Scalable +40% Cand");
      expect(result.chosenPriorityLevel).toBe(
        PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
      );
      expect(result.rankedCandidates).toBeDefined();
      expect(result.rankedCandidates?.length).toBe(4);
      expect(result.rankedCandidates?.[0]?.candidate.name).toBe("Scalable +40% Cand");
    });

    it("handles empty candidate array gracefully", () => {
      const result = arbitrateMultipleApproaches([]);
      expect(result.winner).toBe("NONE");
      expect(result.disqualifiedCandidates).toHaveLength(0);
      expect(result.candidateRankings).toHaveLength(0);
    });

    it("handles single valid candidate immediately", () => {
      const lone: ParetoApproachCandidate = {
        name: "Sole Candidate",
        claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      };
      const result = arbitrateMultipleApproaches([lone]);
      expect(result.winner).toBe("Sole Candidate");
      expect(result.candidateRankings).toEqual(["Sole Candidate"]);
      expect(result.paretoFrontier).toHaveLength(1);
    });

    it("enforces pre-declared Pareto arbitration when debate deadlock occurs", () => {
      const candidates: ParetoApproachCandidate[] = [
        {
          name: "Deadlock Approach A (Simplicity)",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
          cognitiveComplexityScore: 3,
        },
        {
          name: "Deadlock Approach B (Scalable +30%)",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
          perfGainPercent: 30,
          cognitiveComplexityScore: 5,
        },
      ];

      const result = enforcePreDeclaredParetoArbitration("Storage Deadlock", 3, candidates);
      expect(result.forcedByThreshold).toBe(true);
      expect(result.winner).toBe("Deadlock Approach B (Scalable +30%)");
      expect(result.topic).toBe("Storage Deadlock");
    });

    it("filters non-dominated candidates onto the Pareto frontier", () => {
      const candidates: ParetoApproachCandidate[] = [
        {
          name: "Dominant Top",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
          empiricalValueScore: 100,
          cognitiveComplexityScore: 1,
        },
        {
          name: "Dominated Weak",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
          empiricalValueScore: 20,
          cognitiveComplexityScore: 90,
        },
      ];

      const frontier = filterParetoFrontier(candidates);
      expect(frontier).toHaveLength(1);
      expect(frontier[0]?.name).toBe("Dominant Top");
    });
  });
});
