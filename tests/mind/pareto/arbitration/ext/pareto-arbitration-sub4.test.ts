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


describe("6. Empirical Crucible Protocol & Time-Boxed Spikes", () => {
    it("creates, populates, evaluates, and finalizes a prototype spike", () => {
      const engine = new EmpiricalCrucibleEngine();

      const hypothesis: FalsifiableHypothesis = {
        statement: "Streaming JSON parser increases throughput by >= 25%",
        metricToMeasure: "throughputGainPercent",
        thresholdDeltaPercent: 25,
        expectedDirection: "increase",
        falsificationCriteria: "Throughput gain < 25% or functional errors",
      };

      const spikeConfig: PrototypeSpikeConfig = {
        spikeId: "spike-parser-101",
        title: "Streaming JSON Parser Prototype",
        topic: "Data Parsing",
        hypothesis,
        sandboxScope: ["src/parsers/streaming-json.ts"],
        timeBoxMinutes: 45,
      };

      // 1. Create Spike
      const spike = engine.createSpike(spikeConfig);
      expect(spike.spikeId).toBe("spike-parser-101");
      expect(spike.status).toBe(PROTOTYPE_SPIKE_STATUSES.IN_SPIKE);
      expect(spike.timeBoxDurationMs).toBe(45 * 60 * 1000);
      expect(engine.getActiveSpikes()).toHaveLength(1);

      // 2. Record Spike Data
      const candidates: ParetoApproachCandidate[] = [
        {
          name: "Streaming Byte Chunk Parser",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
          throughputGainPercent: 35, // 35% >= 25% target
          cognitiveComplexityScore: 4,
        },
        {
          name: "Legacy Monolithic Buffer Parser",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
          throughputGainPercent: 0,
          cognitiveComplexityScore: 2,
        },
      ];

      engine.recordSpikeData("spike-parser-101", {
        candidateResults: candidates,
        empiricalData: { benchIterations: 10000, avgChunkSizeKb: 64 },
        artifacts: ["artifacts/benchmarks/parser-results.json"],
      });

      const updatedSpike = engine.getSpike("spike-parser-101");
      expect(updatedSpike?.candidateResults).toHaveLength(2);
      expect(updatedSpike?.artifacts).toContain("artifacts/benchmarks/parser-results.json");

      // 3. Evaluate Spike
      const evaluated = engine.evaluateSpike("spike-parser-101");
      expect(evaluated.status).toBe(PROTOTYPE_SPIKE_STATUSES.EVALUATED);
      expect(evaluated.winningCandidate?.name).toBe("Streaming Byte Chunk Parser");
      expect(evaluated.hypothesisValidated).toBe(true);
      expect(evaluated.hypothesisValidationSummary).toContain("Hypothesis validated");

      // 4. Finalize Spike and Commit Bedrock Invariant
      const invariant = engine.finalizeSpike("spike-parser-101", {
        title: "Standard Bedrock Streaming Parser",
        reopenThreshold: 10.0,
      });

      expect(invariant).toBeDefined();
      expect(invariant?.topic).toBe("Data Parsing");
      expect(invariant?.winningApproach).toBe("Streaming Byte Chunk Parser");
      expect(invariant?.reopenThreshold).toBe(10.0);
      expect(invariant?.status).toBe(SETTLED_INVARIANT_STATUSES.ACTIVE);

      const finalizedSpike = engine.getSpike("spike-parser-101");
      expect(finalizedSpike?.status).toBe(PROTOTYPE_SPIKE_STATUSES.SETTLED);
      expect(finalizedSpike?.settledInvariantId).toBe(invariant?.invariantId);
    });

    it("falsifies hypothesis when empirical delta falls below threshold", () => {
      const engine = new EmpiricalCrucibleEngine();

      const hypothesis: FalsifiableHypothesis = {
        statement: "Custom allocator reduces memory footprint by >= 40%",
        metricToMeasure: "memoryReductionPercent",
        thresholdDeltaPercent: 40,
        expectedDirection: "decrease",
        falsificationCriteria: "Memory reduction < 40%",
      };

      engine.createSpike({
        spikeId: "spike-allocator-102",
        title: "Custom Allocator Spike",
        topic: "Memory Management",
        hypothesis,
        sandboxScope: "src/memory/allocator.ts",
      });

      const evaluated = engine.evaluateSpike("spike-allocator-102", [
        {
          name: "Slab Arena Allocator",
          claimedPriorityLevel: PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY,
          memoryReductionPercent: 18, // 18% is below 40% threshold
          cognitiveComplexityScore: 8,
        },
      ]);

      expect(evaluated.hypothesisValidated).toBe(false);
      expect(evaluated.hypothesisValidationSummary).toContain("Hypothesis falsified");
      expect(evaluated.hypothesisValidationSummary).toContain("18%");
    });

    it("cancels an ongoing spike with reason", () => {
      const engine = new EmpiricalCrucibleEngine();
      engine.createSpike({
        spikeId: "spike-cancel-103",
        title: "Spike To Cancel",
        topic: "General",
        hypothesis: {
          statement: "Test hypothesis",
          metricToMeasure: "perf",
          thresholdDeltaPercent: 10,
          expectedDirection: "increase",
          falsificationCriteria: "None",
        },
        sandboxScope: "test/",
      });

      const cancelled = engine.cancelSpike(
        "spike-cancel-103",
        "Superseded by hardware virtualization",
      );
      expect(cancelled.status).toBe(PROTOTYPE_SPIKE_STATUSES.CANCELLED);
      expect(cancelled.cancellationReason).toBe("Superseded by hardware virtualization");

      // Cannot record data to cancelled spike
      expect(() => {
        engine.recordSpikeData("spike-cancel-103", { candidateResults: [] });
      }).toThrow("terminal status");
    });
  });
});
