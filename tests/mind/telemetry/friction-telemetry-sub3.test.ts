import { describe, expect, it } from "bun:test";
import {
  calculateMedian,
  clamp01,
  createFrictionTelemetryAggregator,
  DEFAULT_BASELINE_LATENCY_MS,
  DEFAULT_CATEGORY_BASELINES,
  DEFAULT_EPOCH_DURATION_MS,
  DEFAULT_MAX_HISTORY_SNAPSHOTS,
  DEFAULT_MAX_LATENCY_INFLATION_FACTOR,
  DEFAULT_MIN_EVENTS_FOR_SIGNIFICANCE,
  DEFAULT_SMOOTHING_ALPHA,
  FrictionTelemetryAggregator,
  round4,
} from "../../../olt/scripts/src/mind/telemetry/friction-telemetry.ts";
import {
  createHealthScoringEngine,
  DEFAULT_CONSECUTIVE_DEGRADED_FOR_INTERVENTION,
  DEFAULT_CRITICAL_THRESHOLD,
  DEFAULT_NOMINAL_THRESHOLD,
  DEFAULT_WEIGHTS,
  formatHealthEvaluationSummary,
  formatInterventionSummary,
  HealthScoringEngine,
} from "../../../olt/scripts/src/mind/telemetry/health-scoring.ts";
import type {
  EpochEventCounts,
  EpochTelemetrySnapshot,
  ExecutionEventType,
  FrictionIndices,
  HealthEvaluationResult,
  HealthScoreStatus,
  OperationalExecutionEvent,
  RecordExecutionEventInput,
  StrategicFrictionIntervention,
} from "../../../olt/scripts/src/mind/telemetry/types.ts";

describe("15-Minute Friction Telemetry & Systemic Execution Health Suite", () => {


describe("7. Strategic Friction Intervention & Roadmap Expansion Locking", () => {
    function makeSnapshot(
      epochIndex: number,
      dampenedIndices: FrictionIndices,
    ): EpochTelemetrySnapshot {
      return {
        epochIndex,
        epochStart: epochIndex * 900_000,
        epochEnd: (epochIndex + 1) * 900_000,
        durationMs: 900_000,
        eventCounts: {
          taskDispatches: 10,
          taskCompletions: 10,
          taskRedispatches: 3,
          workerZombieKills: 2,
          supervisoryBoundaryChecks: 2,
          supervisoryBoundarySlips: 1,
          latencyMeasurements: 5,
          totalEvents: 33,
          uniqueCoordinators: 2,
          uniqueWorkers: 5,
        },
        rawIndices: dampenedIndices,
        dampenedIndices,
        compositeHealthScore: 0.75,
        status: "degraded",
        anomalyDampened: false,
      };
    }

    it("does NOT trigger intervention on a single isolated degraded epoch (requires 2 consecutive)", () => {
      const engine = new HealthScoringEngine();

      const degradedIndices: FrictionIndices = {
        taskAmbiguityIndex: 0.3,
        workerRecyclingIndex: 0.2,
        supervisoryStrainIndex: 0.2,
        infrastructureLatencyIndex: 0.1,
      };

      const snap0 = makeSnapshot(0, degradedIndices);
      const eval0 = engine.processEpoch(snap0);

      expect(eval0.status).toBe("degraded");
      expect(eval0.consecutiveDegradedEpochs).toBe(1);
      expect(eval0.interventionTriggered).toBe(false);
      expect(eval0.roadmapExpansionLocked).toBe(false);
      expect(engine.isRoadmapExpansionLocked()).toBe(false);
      expect(engine.getActiveIntervention()).toBeUndefined();
    });

    it("triggers Strategic Friction Intervention and locks roadmap expansion across 2 consecutive degraded epochs", () => {
      const engine = new HealthScoringEngine();

      const degradedIndices: FrictionIndices = {
        taskAmbiguityIndex: 0.35,
        workerRecyclingIndex: 0.2,
        supervisoryStrainIndex: 0.15,
        infrastructureLatencyIndex: 0.25,
      };

      // Epoch 0: Degraded
      const eval0 = engine.processEpoch(makeSnapshot(0, degradedIndices));
      expect(eval0.consecutiveDegradedEpochs).toBe(1);
      expect(eval0.roadmapExpansionLocked).toBe(false);

      // Epoch 1: Consecutive Degraded -> TRIGGER!
      const eval1 = engine.processEpoch(makeSnapshot(1, degradedIndices));
      expect(eval1.consecutiveDegradedEpochs).toBe(2);
      expect(eval1.interventionTriggered).toBe(true);
      expect(eval1.roadmapExpansionLocked).toBe(true);
      expect(engine.isRoadmapExpansionLocked()).toBe(true);

      const intervention = engine.getActiveIntervention();
      expect(intervention).toBeDefined();
      expect(intervention?.roadmapExpansionLocked).toBe(true);
      expect(intervention?.triggeredAtEpoch).toBe(1);
      expect(intervention?.consecutiveDegradedEpochs).toBe(2);
      expect(intervention?.rootCauses.length).toBeGreaterThan(0);
      expect(intervention?.requiredSimplifications.length).toBeGreaterThan(0);
    });

    it("resolves intervention and unlocks roadmap expansion when health recovers to nominal", () => {
      const engine = new HealthScoringEngine();

      const degradedIndices: FrictionIndices = {
        taskAmbiguityIndex: 0.35,
        workerRecyclingIndex: 0.2,
        supervisoryStrainIndex: 0.15,
        infrastructureLatencyIndex: 0.25,
      };

      const nominalIndices: FrictionIndices = {
        taskAmbiguityIndex: 0.02,
        workerRecyclingIndex: 0.01,
        supervisoryStrainIndex: 0.0,
        infrastructureLatencyIndex: 0.02,
      };

      // Trigger intervention across epochs 0 and 1
      engine.processEpoch(makeSnapshot(0, degradedIndices));
      engine.processEpoch(makeSnapshot(1, degradedIndices));
      expect(engine.isRoadmapExpansionLocked()).toBe(true);

      // Epoch 2: Recovery to Nominal (Score >= 0.85)
      const eval2 = engine.processEpoch(makeSnapshot(2, nominalIndices));

      expect(eval2.status).toBe("nominal");
      expect(eval2.consecutiveDegradedEpochs).toBe(0);
      expect(eval2.interventionResolved).toBe(true);
      expect(eval2.roadmapExpansionLocked).toBe(false);
      expect(engine.isRoadmapExpansionLocked()).toBe(false);
      expect(engine.getActiveIntervention()).toBeUndefined();

      // Check intervention history recorded
      const history = engine.getInterventionHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.resolvedAtEpoch).toBe(2);
      expect(history[0]?.roadmapExpansionLocked).toBe(false);
    });

    it("formats intervention summary and health evaluation diagnostic reports", () => {
      const engine = new HealthScoringEngine();
      const degradedIndices: FrictionIndices = {
        taskAmbiguityIndex: 0.4,
        workerRecyclingIndex: 0.2,
        supervisoryStrainIndex: 0.2,
        infrastructureLatencyIndex: 0.3,
      };

      engine.processEpoch(makeSnapshot(0, degradedIndices));
      const res = engine.processEpoch(makeSnapshot(1, degradedIndices));
      const intervention = engine.getActiveIntervention()!;

      const report = formatInterventionSummary(intervention);
      expect(report).toContain("[STRATEGIC FRICTION INTERVENTION]");
      expect(report).toContain("Roadmap Expansion Locked: YES (LOCKED)");
      expect(report).toContain("Root Causes:");
      expect(report).toContain("Required Simplifications:");

      const evalSummary = formatHealthEvaluationSummary(res);
      expect(evalSummary).toContain("Health Evaluation Summary:");
      expect(evalSummary).toContain("Roadmap Expansion Locked: LOCKED");
      expect(evalSummary).toContain("Intervention Triggered: true");
    });
  });
});
