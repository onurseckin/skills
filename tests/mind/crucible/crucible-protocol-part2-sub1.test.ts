import { describe, expect, it } from "bun:test";
import {
  EmpiricalCrucibleEngine,
  ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD,
  PROTOTYPE_SPIKE_STATUSES,
  SETTLED_INVARIANT_STATUSES,
  SettledInvariantRepository,
  type AntiPatternRecord,
  type FalsifiableHypothesis,
  type PrototypeSpikeConfig,
  type ReopenChallengeInput,
} from "../../../olt/scripts/src/mind/crucible/index.ts";
import {
  PARETO_PRIORITY_LEVELS,
  type ParetoApproachCandidate,
} from "../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";

describe("Empirical Crucible Protocol & Bedrock Invariant Commitment", () => {
describe("SettledInvariantRepository", () => {
    it("commits winning resolution as a Tier 1 Bedrock Invariant with >= 10x reopen protection", () => {
      const repo = new SettledInvariantRepository();

      const invariant = repo.commitInvariant({
        topic: "State Synchronization",
        title: "Deterministic Lamport Timestamp Ordering",
        winningApproach: "Monotonic Vector Sequence Numbering",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        arbitrationSummary:
          "Defeated distributed consensus coordinator on simplicity and zero network overhead.",
      });

      expect(invariant.invariantId).toContain("bedrock-state-synchronization");
      expect(invariant.status).toBe(SETTLED_INVARIANT_STATUSES.ACTIVE);
      expect(invariant.reopenThreshold).toBe(ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD);
      expect(invariant.history).toHaveLength(1);
      expect(invariant.history[0]?.action).toBe("COMMITTED");
    });

    it("enforces order-of-magnitude threshold even if lower threshold requested", () => {
      const repo = new SettledInvariantRepository();

      const invariant = repo.commitInvariant({
        topic: "Cache Eviction",
        title: "ARC Cache Policy",
        winningApproach: "Adaptive Replacement Cache",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        arbitrationSummary: "35% throughput gain over LRU.",
        reopenThreshold: 2.0, // Attempted 2x, should be clamped to >= 10x
      });

      expect(invariant.reopenThreshold).toBe(ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD);
    });

    it("unconditionally rejects invariant reopen attempts below order-of-magnitude (10x / 1000%) threshold", () => {
      const repo = new SettledInvariantRepository();

      const invariant = repo.commitInvariant({
        topic: "Serialization",
        title: "Binary Packed Struct Protocol",
        winningApproach: "FlatBuffers Struct Alignment",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        arbitrationSummary: "Zero-copy deserialization baseline.",
      });

      // Challenger claims 2.5x speedup (250% improvement)
      const challenge: ReopenChallengeInput = {
        challengerId: "agent-optimizer-7",
        proposedApproach: "Custom Bitfield Compression",
        falsifiableClaim: "Bitfield compression achieves 2.5x memory compression over FlatBuffers",
        empiricalPerformanceDeltaRatio: 2.5, // 2.5x < 10.0x
        benchmarkData: { opsSec: 50000 },
      };

      const result = repo.challengeSettledInvariant(invariant.invariantId, challenge);

      expect(result.accepted).toBe(false);
      expect(result.requiredThresholdRatio).toBe(10.0);
      expect(result.empiricalDeltaRatio).toBe(2.5);
      expect(result.reason).toContain(
        "Order-of-magnitude empirical delta (>= 10.0x / 1000%) is required",
      );

      // Verify invariant remains active and rejection was logged in history
      const stored = repo.getInvariant(invariant.invariantId);
      expect(stored?.status).toBe(SETTLED_INVARIANT_STATUSES.ACTIVE);
      expect(stored?.history).toHaveLength(2);
      expect(stored?.history[1]?.action).toBe("CHALLENGE_REJECTED");
      expect(stored?.history[1]?.challengerId).toBe("agent-optimizer-7");
    });

    it("accepts invariant reopen challenge when order-of-magnitude (>= 10x) empirical delta is demonstrated", () => {
      const repo = new SettledInvariantRepository();

      const invariant = repo.commitInvariant({
        topic: "Diff Engine",
        title: "Myers AST Diffing",
        winningApproach: "Myers Tree Diff",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        arbitrationSummary: "Standard linear-space Myers AST diff.",
      });

      // Challenger proves 12.5x throughput improvement via SIMD chunking
      const challenge: ReopenChallengeInput = {
        challengerId: "agent-performance-lead",
        proposedApproach: "SIMD Vectorized Rolling Hash Diff",
        falsifiableClaim: "SIMD rolling hash diff executes in 1/12th the time (12.5x throughput)",
        empiricalPerformanceDeltaRatio: 12.5, // 12.5x >= 10.0x
        functionalSuperiorityProof: "Passed 10,000 fuzz test suites without divergence.",
        benchmarkData: { throughputOpsSec: 1250000, baselineOpsSec: 100000 },
      };

      const result = repo.challengeSettledInvariant(invariant.invariantId, challenge);

      expect(result.accepted).toBe(true);
      expect(result.empiricalDeltaRatio).toBe(12.5);
      expect(result.reason).toContain(
        "Order-of-magnitude empirical delta (12.50x >= 10.0x) satisfied",
      );
      expect(result.nextSteps).toBeDefined();

      // Verify invariant transitioned to CHALLENGED status and recorded in history
      const stored = repo.getInvariant(invariant.invariantId);
      expect(stored?.status).toBe(SETTLED_INVARIANT_STATUSES.CHALLENGED);
      expect(stored?.history).toHaveLength(2);
      expect(stored?.history[1]?.action).toBe("CHALLENGE_ACCEPTED");
    });

    it("manages query, supersession, anti-patterns, and state export/import", () => {
      const repo = new SettledInvariantRepository();

      const inv1 = repo.commitInvariant({
        topic: "Indexing",
        title: "B-Tree Indexing",
        winningApproach: "B-Tree",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
        arbitrationSummary: "Clean B-Tree invariant.",
      });

      expect(repo.hasActiveInvariantForTopic("Indexing")).toBe(true);
      expect(repo.getInvariantsByTopic("Indexing")).toHaveLength(1);

      const inv2 = repo.commitInvariant({
        topic: "Indexing",
        title: "LSM Tree Indexing",
        winningApproach: "LSM Tree",
        paretoPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
        arbitrationSummary: "10x write throughput proved via crucible.",
      });

      repo.supersedeInvariant(
        inv1.invariantId,
        inv2.invariantId,
        "Proved order-of-magnitude write throughput.",
      );
      expect(repo.getInvariant(inv1.invariantId)?.status).toBe(
        SETTLED_INVARIANT_STATUSES.SUPERSEDED,
      );

      const antiPattern: AntiPatternRecord = {
        id: "anti-unindexed-table-scan",
        name: "Full Table Scan in Critical Path",
        topic: "Indexing",
        description: "Full table scan causes O(N) degradation under load.",
        rejectedApproach: "Linear Array Scan",
        rejectionReason: "O(N) search latency unacceptable.",
        discoveredAt: new Date().toISOString(),
      };
      repo.recordAntiPattern(antiPattern);

      expect(repo.getAntiPatterns("Indexing")).toHaveLength(1);

      // Export and load round-trip
      const state = repo.exportState();
      const newRepo = new SettledInvariantRepository(state);
      expect(newRepo.getAllInvariants()).toHaveLength(2);
      expect(newRepo.getAntiPatterns("Indexing")).toHaveLength(1);
    });
  });
});
