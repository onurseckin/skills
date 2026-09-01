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


describe("EmpiricalCrucibleEngine", () => {
    it("coordinates full lifecycle: createSpike -> recordData -> evaluateSpike -> finalizeSpike", () => {
      const engine = new EmpiricalCrucibleEngine();

      const hypothesis: FalsifiableHypothesis = {
        id: "hyp-memory-pool-1",
        statement:
          "Slab allocator will reduce memory allocation overhead by >= 20% without regression.",
        nullHypothesis: "Slab allocator provides < 20% gain or causes memory leaks.",
        targetMetric: "throughput_ops_sec",
        expectedDirection: "increase",
        thresholdDeltaPercent: 20,
        falsificationCriteria: "Throughput gain < 20% or functional errors present.",
        validationMethod: "benchmark",
      };

      const config: PrototypeSpikeConfig = {
        spikeId: "spike-memory-pool-2026",
        title: "Memory Allocator Prototype Spike",
        topic: "Memory Management",
        hypothesis,
        sandboxScope: ["olt/scripts/src/mind/memory/scratch"],
        timeBoxMinutes: 45,
      };

      // 1. Create Spike
      const created = engine.createSpike(config);
      expect(created.status).toBe(PROTOTYPE_SPIKE_STATUSES.IN_SPIKE);
      expect(created.timeBoxDurationMs).toBe(45 * 60 * 1000);

      // 2. Record Prototype Spike Data
      const candidateApproaches: ParetoApproachCandidate[] = [
        {
          name: "Approach A: System Malloc (Incumbent)",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
          cognitiveComplexityScore: 1,
          perfGainPercent: 0,
        },
        {
          name: "Approach B: Arena Slab Pool",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
          cognitiveComplexityScore: 4,
          perfGainPercent: 32, // 32% >= 20% hypothesis & >= 15% scalability threshold
          functionalCorrectnessScore: 1.0,
        },
        {
          name: "Approach C: Leaky Unsafe Ring Buffer",
          hasErrors: true,
          functionalErrors: ["Memory leak under multi-threaded allocation"],
          perfGainPercent: 75,
        },
      ];

      engine.recordSpikeData(config.spikeId, {
        candidateResults: candidateApproaches,
        empiricalData: { slabHits: 95000, fragmentationPercent: 2.1 },
        artifacts: ["/tmp/benchmark-slab-results.json"],
      });

      // 3. Evaluate Spike
      const evaluated = engine.evaluateSpike(config.spikeId);
      expect(evaluated.status).toBe(PROTOTYPE_SPIKE_STATUSES.EVALUATED);
      expect(evaluated.winningCandidate?.name).toBe("Approach B: Arena Slab Pool");
      expect(evaluated.hypothesisValidated).toBe(true);
      expect(evaluated.hypothesisValidationSummary).toContain("Hypothesis validated");
      expect(evaluated.antiPatternsIdentified).toBeDefined();
      expect(evaluated.antiPatternsIdentified?.length).toBeGreaterThan(0);

      // 4. Finalize Spike (Commit to Bedrock Invariant)
      const invariant = engine.finalizeSpike(config.spikeId, {
        title: "Tier 1 Bedrock: Arena Slab Pool Allocator",
      });

      expect(invariant).toBeDefined();
      expect(invariant?.winningApproach).toBe("Approach B: Arena Slab Pool");
      expect(invariant?.reopenThreshold).toBe(ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD);

      // Verify active spike transitioned to SETTLED
      const settled = engine.getSpike(config.spikeId);
      expect(settled?.status).toBe(PROTOTYPE_SPIKE_STATUSES.SETTLED);
      expect(settled?.settledInvariantId).toBe(invariant?.invariantId);

      // Verify repository now has active invariant and anti-pattern
      const repo = engine.getRepository();
      expect(repo.hasActiveInvariantForTopic("Memory Management")).toBe(true);
      expect(repo.getAntiPatterns("Memory Management")).toHaveLength(1);
    });

    it("falsifies hypothesis when empirical gain is below target threshold", () => {
      const engine = new EmpiricalCrucibleEngine();

      const hypothesis: FalsifiableHypothesis = {
        id: "hyp-compression-1",
        statement: "Snappy compression will achieve >= 50% throughput gain over zstd.",
        nullHypothesis: "Snappy throughput gain is < 50%.",
        targetMetric: "throughput_ops_sec",
        expectedDirection: "increase",
        thresholdDeltaPercent: 50,
        falsificationCriteria: "Throughput gain < 50%.",
        validationMethod: "benchmark",
      };

      engine.createSpike({
        spikeId: "spike-compression-eval",
        title: "Snappy vs Zstd Spike",
        topic: "Payload Compression",
        hypothesis,
        sandboxScope: "scratch/compression",
      });

      const candidates: ParetoApproachCandidate[] = [
        {
          name: "Zstd Standard",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
          cognitiveComplexityScore: 2,
          perfGainPercent: 0,
        },
        {
          name: "Snappy Compressor",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
          cognitiveComplexityScore: 3,
          perfGainPercent: 18, // 18% is >= 15% Pareto threshold, but < 50% hypothesis target
        },
      ];

      const evaluated = engine.evaluateSpike("spike-compression-eval", candidates);
      expect(evaluated.status).toBe(PROTOTYPE_SPIKE_STATUSES.EVALUATED);
      expect(evaluated.winningCandidate?.name).toBe("Snappy Compressor");
      expect(evaluated.hypothesisValidated).toBe(false);
      expect(evaluated.hypothesisValidationSummary).toContain("Hypothesis falsified");
    });

    it("handles spike cancellation cleanly", () => {
      const engine = new EmpiricalCrucibleEngine();

      engine.createSpike({
        spikeId: "spike-to-cancel",
        title: "Exploratory SPIKE",
        topic: "RPC Protocol",
        hypothesis: {
          id: "hyp-rpc",
          statement: "gRPC reduces serialization by 20%",
          nullHypothesis: "gRPC does not reduce serialization",
          targetMetric: "latency",
          expectedDirection: "decrease",
          thresholdDeltaPercent: 20,
          falsificationCriteria: "Latency reduction < 20%",
          validationMethod: "benchmark",
        },
        sandboxScope: "scratch/rpc",
      });

      const cancelled = engine.cancelSpike(
        "spike-to-cancel",
        "Upstream project pivot rendered RPC spike moot.",
      );

      expect(cancelled.status).toBe(PROTOTYPE_SPIKE_STATUSES.CANCELLED);
      expect(cancelled.cancellationReason).toContain("Upstream project pivot");
      expect(engine.getActiveSpikes()).toHaveLength(0);
    });
  });
});
