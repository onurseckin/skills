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


describe("4. Anomaly Dampening Filter", () => {
    it("dampens isolated single-event blips when sample volume is below significance threshold", () => {
      const aggregator = new FrictionTelemetryAggregator({
        minEventsForSignificance: 4,
      });

      // Exactly 1 dispatch and 1 redispatch (raw ratio 1.00)
      const events: OperationalExecutionEvent[] = [
        { id: "1", type: "TASK_DISPATCH", timestamp: 1 },
        { id: "2", type: "TASK_REDISPATCH", timestamp: 2 },
      ];

      const counts = aggregator.countEpochEvents(events);
      const raw = aggregator.computeRawIndices(events, counts);
      expect(raw.taskAmbiguityIndex).toBe(1.0); // Raw registers as 100%

      // Apply dampener with 0 history
      const dampened = aggregator.applyAnomalyDampener(raw, counts, []);
      // Confidence scaling: 1 dispatch / 4 minSig = 0.25 -> 1.0 * 0.25 = 0.25
      expect(dampened.taskAmbiguityIndex).toBe(0.25);
    });

    it("applies temporal historical median smoothing against previous nominal epochs", () => {
      const aggregator = new FrictionTelemetryAggregator({
        minEventsForSignificance: 3,
        smoothingAlpha: 0.7, // 70% current, 30% historical
      });

      // Construct simulated history with 0 friction
      const nominalSnapshot: EpochTelemetrySnapshot = {
        epochIndex: 0,
        epochStart: 0,
        epochEnd: 900_000,
        durationMs: 900_000,
        eventCounts: {
          taskDispatches: 10,
          taskCompletions: 10,
          taskRedispatches: 0,
          workerZombieKills: 0,
          supervisoryBoundaryChecks: 2,
          supervisoryBoundarySlips: 0,
          latencyMeasurements: 5,
          totalEvents: 27,
          uniqueCoordinators: 1,
          uniqueWorkers: 5,
        },
        rawIndices: {
          taskAmbiguityIndex: 0.0,
          workerRecyclingIndex: 0.0,
          supervisoryStrainIndex: 0.0,
          infrastructureLatencyIndex: 0.0,
        },
        dampenedIndices: {
          taskAmbiguityIndex: 0.0,
          workerRecyclingIndex: 0.0,
          supervisoryStrainIndex: 0.0,
          infrastructureLatencyIndex: 0.0,
        },
        compositeHealthScore: 1.0,
        status: "nominal",
        anomalyDampened: false,
      };

      const rawCurrent: FrictionIndices = {
        taskAmbiguityIndex: 0.6,
        workerRecyclingIndex: 0.0,
        supervisoryStrainIndex: 0.0,
        infrastructureLatencyIndex: 0.0,
      };

      const countsCurrent: EpochEventCounts = {
        taskDispatches: 5, // >= minSig (confidence = 1.0)
        taskCompletions: 5,
        taskRedispatches: 3,
        workerZombieKills: 0,
        supervisoryBoundaryChecks: 1,
        supervisoryBoundarySlips: 0,
        latencyMeasurements: 3,
        totalEvents: 17,
        uniqueCoordinators: 1,
        uniqueWorkers: 3,
      };

      const dampened = aggregator.applyAnomalyDampener(rawCurrent, countsCurrent, [
        nominalSnapshot,
      ]);
      // finalTask = 0.7 * 0.6 + 0.3 * 0.0 = 0.42
      expect(dampened.taskAmbiguityIndex).toBe(0.42);
    });
  });

describe("5. 15-Minute Epoch Lifecycle & History Tracking", () => {
    it("progresses across multiple 15-minute epochs and retains history", () => {
      const startTime = 1_000_000;
      const aggregator = new FrictionTelemetryAggregator(
        { epochDurationMs: 900_000, maxHistorySnapshots: 10 },
        startTime,
      );

      expect(aggregator.getCurrentEpochIndex()).toBe(0);
      expect(aggregator.getCurrentEpochStart()).toBe(startTime);

      // Epoch 0 Events
      aggregator.recordEvent({ type: "TASK_DISPATCH", metadata: { coordinatorId: "c1" } });
      aggregator.recordEvent({ type: "TASK_COMPLETE", metadata: { workerId: "w1" } });

      const snap0 = aggregator.closeEpoch(startTime + 900_000);
      expect(snap0.epochIndex).toBe(0);
      expect(snap0.epochStart).toBe(startTime);
      expect(snap0.epochEnd).toBe(startTime + 900_000);
      expect(snap0.status).toBe("nominal");
      expect(aggregator.getCurrentEpochIndex()).toBe(1);
      expect(aggregator.getCurrentEpochStart()).toBe(startTime + 900_000);

      // Epoch 1 Events
      aggregator.recordEvent({ type: "TASK_DISPATCH", metadata: { coordinatorId: "c1" } });
      const snap1 = aggregator.closeEpoch(startTime + 1_800_000);
      expect(snap1.epochIndex).toBe(1);

      const history = aggregator.getEpochHistory();
      expect(history).toHaveLength(2);
      expect(aggregator.getLatestSnapshot()?.epochIndex).toBe(1);
    });

    it("peeks current snapshot without closing active epoch", () => {
      const aggregator = new FrictionTelemetryAggregator();
      aggregator.recordEvent({ type: "TASK_DISPATCH" });

      const peek = aggregator.peekCurrentSnapshot();
      expect(peek.eventCounts.taskDispatches).toBe(1);
      expect(aggregator.getBufferedEventsCount()).toBe(1); // Buffered events not cleared
      expect(aggregator.getCurrentEpochIndex()).toBe(0); // Epoch not advanced
    });

    it("resets aggregator to clean state", () => {
      const aggregator = new FrictionTelemetryAggregator();
      aggregator.recordEvent({ type: "TASK_DISPATCH" });
      aggregator.closeEpoch();

      expect(aggregator.getEpochHistory()).toHaveLength(1);
      aggregator.reset(2_000_000);

      expect(aggregator.getCurrentEpochIndex()).toBe(0);
      expect(aggregator.getCurrentEpochStart()).toBe(2_000_000);
      expect(aggregator.getBufferedEventsCount()).toBe(0);
      expect(aggregator.getEpochHistory()).toHaveLength(0);
    });
  });

describe("6. Composite Health Scoring & Status Thresholds", () => {
    it("calculates nominal health score (>= 0.85) when friction is minimal", () => {
      const engine = new HealthScoringEngine();
      const indices: FrictionIndices = {
        taskAmbiguityIndex: 0.05,
        workerRecyclingIndex: 0.02,
        supervisoryStrainIndex: 0.0,
        infrastructureLatencyIndex: 0.05,
      };

      // totalFriction = 0.3*0.05 + 0.25*0.02 + 0.25*0.0 + 0.2*0.05 = 0.015 + 0.005 + 0 + 0.01 = 0.03
      // score = 1.0 - 0.03 = 0.97
      const { score, status } = engine.computeHealthScore(indices);
      expect(score).toBe(0.97);
      expect(status).toBe("nominal");
    });

    it("calculates degraded health score (< 0.85 and >= 0.60) under moderate friction", () => {
      const engine = new HealthScoringEngine();
      const indices: FrictionIndices = {
        taskAmbiguityIndex: 0.3, // 0.3 * 0.3 = 0.09
        workerRecyclingIndex: 0.2, // 0.25 * 0.2 = 0.05
        supervisoryStrainIndex: 0.1, // 0.25 * 0.1 = 0.025
        infrastructureLatencyIndex: 0.2, // 0.2 * 0.2 = 0.04
      };

      // totalFriction = 0.09 + 0.05 + 0.025 + 0.04 = 0.205
      // score = 1.0 - 0.205 = 0.795
      const { score, status } = engine.computeHealthScore(indices);
      expect(score).toBe(0.795);
      expect(status).toBe("degraded");
    });

    it("calculates critical health score (< 0.60) under severe multi-dimensional friction", () => {
      const engine = new HealthScoringEngine();
      const indices: FrictionIndices = {
        taskAmbiguityIndex: 0.7, // 0.3 * 0.7 = 0.21
        workerRecyclingIndex: 0.6, // 0.25 * 0.6 = 0.15
        supervisoryStrainIndex: 0.4, // 0.25 * 0.4 = 0.10
        infrastructureLatencyIndex: 0.5, // 0.2 * 0.5 = 0.10
      };

      // totalFriction = 0.21 + 0.15 + 0.10 + 0.10 = 0.56
      // score = 1.0 - 0.56 = 0.44
      const { score, status } = engine.computeHealthScore(indices);
      expect(score).toBe(0.44);
      expect(status).toBe("critical");
    });
  });
});
