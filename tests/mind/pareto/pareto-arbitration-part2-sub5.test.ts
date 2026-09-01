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
} from "../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";
import {
  EmpiricalCrucibleEngine,
  type FinalizeSpikeOptions,
  type SpikeFilterOptions,
} from "../../../olt/scripts/src/mind/crucible/crucible-protocol.ts";
import { SettledInvariantRepository } from "../../../olt/scripts/src/mind/crucible/bedrock-commitment.ts";
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
} from "../../../olt/scripts/src/mind/crucible/types.ts";

describe("Pre-Declared Pareto Decision Hierarchy & Arbitration Suite", () => {
describe("7. Settled Bedrock Invariants & Reopening Protection (>= 10x Threshold)", () => {
    it("commits invariants and rejects challenge when empirical delta is below 10x", () => {
      const repository = new SettledInvariantRepository();

      const invariant = repository.commitInvariant({
        topic: "HTTP Client Transport",
        title: "Zero-Copy HTTP/2 Connection Pooling",
        winningApproach: "Multiplexed Async Connection Pool",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        arbitrationSummary: "Proven 300% throughput over serial connection",
        reopenThreshold: 10.0,
      });

      expect(invariant.invariantId).toBeDefined();
      expect(invariant.reopenThreshold).toBe(10.0);
      expect(repository.hasActiveInvariantForTopic("HTTP Client Transport")).toBe(true);

      // Challenge 1: Marginal 2.5x gain (Reopen Delta Ratio = 2.5) -> REJECTED
      const challengeSmall: ReopenChallengeInput = {
        challengerId: "worker-speculative-1",
        proposedApproach: "Rust FFI Connection Bridge",
        falsifiableClaim: "Yields 2.5x faster throughput",
        empiricalPerformanceDeltaRatio: 2.5,
      };

      const resultSmall = repository.challengeSettledInvariant(
        invariant.invariantId,
        challengeSmall,
      );
      expect(resultSmall.accepted).toBe(false);
      expect(resultSmall.empiricalDeltaRatio).toBe(2.5);
      expect(resultSmall.requiredThresholdRatio).toBe(10.0);
      expect(resultSmall.reason).toContain("Challenge rejected");
      expect(resultSmall.reason).toContain("2.50x");

      // Invariant remains ACTIVE
      const currentInv = repository.getInvariant(invariant.invariantId);
      expect(currentInv?.status).toBe(SETTLED_INVARIANT_STATUSES.ACTIVE);
      expect(currentInv?.history).toHaveLength(2); // COMMITTED + CHALLENGE_REJECTED
    });

    it("accepts challenge when challenger provides order-of-magnitude (>= 10x) empirical delta", () => {
      const repository = new SettledInvariantRepository();

      const invariant = repository.commitInvariant({
        topic: "Graph Compilation",
        title: "Standard Recursive Visitor",
        winningApproach: "Recursive Tree Visitor",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        arbitrationSummary: "Clean simple recursion",
        reopenThreshold: 10.0,
      });

      // Challenge 2: Breakthrough 12.5x gain -> ACCEPTED
      const challengeOrderOfMag: ReopenChallengeInput = {
        challengerId: "architect-lead-1",
        proposedApproach: "Direct Bytecode JIT Compiler",
        falsifiableClaim: "Achieves 12.5x faster graph compilation on million-node DAGs",
        empiricalPerformanceDeltaRatio: 12.5,
        functionalSuperiorityProof: "Passes 100% test matrix with zero regressions",
      };

      const resultAccept = repository.challengeSettledInvariant(
        invariant.invariantId,
        challengeOrderOfMag,
      );
      expect(resultAccept.accepted).toBe(true);
      expect(resultAccept.empiricalDeltaRatio).toBe(12.5);
      expect(resultAccept.reason).toContain("Challenge accepted");
      expect(resultAccept.nextSteps?.length).toBeGreaterThan(0);

      // Invariant status transitions to CHALLENGED
      const challengedInv = repository.getInvariant(invariant.invariantId);
      expect(challengedInv?.status).toBe(SETTLED_INVARIANT_STATUSES.CHALLENGED);
    });

    it("supports superseding settled invariants and anti-pattern recording", () => {
      const repository = new SettledInvariantRepository();

      const oldInv = repository.commitInvariant({
        topic: "Hashing",
        title: "Murmur3 Hash",
        winningApproach: "Murmur3 32-bit",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        arbitrationSummary: "Fast simple hash",
      });

      const newInv = repository.commitInvariant({
        topic: "Hashing",
        title: "XXHash64",
        winningApproach: "XXHash64 SIMD",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        arbitrationSummary: "15x faster with 0 collision rate",
      });

      const superseded = repository.supersedeInvariant(
        oldInv.invariantId,
        newInv.invariantId,
        "XXHash64 demonstrated 15x empirical delta",
      );
      expect(superseded).toBe(true);

      const oldUpdated = repository.getInvariant(oldInv.invariantId);
      expect(oldUpdated?.status).toBe(SETTLED_INVARIANT_STATUSES.SUPERSEDED);

      // Record anti-pattern
      repository.recordAntiPattern({
        id: "anti-hashing-md5",
        name: "MD5 for Cryptographic Security",
        topic: "Hashing",
        description: "Broken collision resistance",
        rejectedApproach: "MD5",
        rejectionReason: "Collision vulnerability",
        discoveredAt: new Date().toISOString(),
      });

      const antiPatterns = repository.getAntiPatterns("Hashing");
      expect(antiPatterns).toHaveLength(1);
      expect(antiPatterns[0]?.rejectedApproach).toBe("MD5");
    });

    it("exports, imports, and clears repository state", () => {
      const repository = new SettledInvariantRepository();
      repository.commitInvariant({
        topic: "Storage",
        title: "IndexedDB Local Store",
        winningApproach: "IndexedDB KeyValue",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        arbitrationSummary: "Reliable browser storage",
      });

      const state = repository.exportState();
      expect(state.invariants).toHaveLength(1);

      const newRepo = new SettledInvariantRepository(state);
      expect(newRepo.getAllInvariants()).toHaveLength(1);

      newRepo.clear();
      expect(newRepo.getAllInvariants()).toHaveLength(0);
    });
  });
});
