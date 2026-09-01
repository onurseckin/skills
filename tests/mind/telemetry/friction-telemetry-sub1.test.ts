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


describe("1. Constants, Helpers & Baseline Defaults", () => {
    it("exports standard telemetry defaults", () => {
      expect(DEFAULT_EPOCH_DURATION_MS).toBe(900_000); // 15 minutes
      expect(DEFAULT_BASELINE_LATENCY_MS).toBe(5_000); // 5 seconds
      expect(DEFAULT_MIN_EVENTS_FOR_SIGNIFICANCE).toBe(3);
      expect(DEFAULT_SMOOTHING_ALPHA).toBe(0.7);
      expect(DEFAULT_MAX_HISTORY_SNAPSHOTS).toBe(96); // 24 hours of 15m epochs
      expect(DEFAULT_MAX_LATENCY_INFLATION_FACTOR).toBe(3.0);
    });

    it("defines category baselines for pipeline stages", () => {
      expect(DEFAULT_CATEGORY_BASELINES.compilation).toBe(10_000);
      expect(DEFAULT_CATEGORY_BASELINES.test).toBe(15_000);
      expect(DEFAULT_CATEGORY_BASELINES.packaging).toBe(8_000);
      expect(DEFAULT_CATEGORY_BASELINES.execution).toBe(5_000);
      expect(DEFAULT_CATEGORY_BASELINES.network).toBe(1_000);
      expect(DEFAULT_CATEGORY_BASELINES.pipeline).toBe(20_000);
    });

    it("verifies clamp01 and round4 math utilities", () => {
      expect(clamp01(-0.5)).toBe(0.0);
      expect(clamp01(1.5)).toBe(1.0);
      expect(clamp01(0.75)).toBe(0.75);
      expect(clamp01(Number.NaN)).toBe(0.0);
      expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0.0);

      expect(round4(0.123456)).toBe(0.1235);
      expect(round4(0.85)).toBe(0.85);
      expect(round4(Number.NaN)).toBe(0.0);
    });

    it("verifies calculateMedian on various array sizes", () => {
      expect(calculateMedian([])).toBe(0.0);
      expect(calculateMedian([5])).toBe(5);
      expect(calculateMedian([1, 9, 3])).toBe(3);
      expect(calculateMedian([10, 20, 30, 40])).toBe(25);
    });
  });

describe("2. Operational Execution Event Ingestion & Counting", () => {
    it("records individual and batch events with auto-generated IDs and timestamps", () => {
      const aggregator = createFrictionTelemetryAggregator(undefined, 1_000_000);

      const evt1 = aggregator.recordEvent({
        type: "TASK_DISPATCH",
        metadata: { workerId: "w-1", coordinatorId: "coord-A" },
      });

      expect(evt1.id).toBeDefined();
      expect(evt1.type).toBe("TASK_DISPATCH");
      expect(aggregator.getBufferedEventsCount()).toBe(1);

      const batch: RecordExecutionEventInput[] = [
        { type: "TASK_COMPLETE", metadata: { workerId: "w-1" } },
        { type: "TASK_REDISPATCH", metadata: { workerId: "w-2" } },
        { type: "WORKER_ZOMBIE_KILL", metadata: { workerId: "w-3" } },
      ];

      const recorded = aggregator.recordEvents(batch);
      expect(recorded).toHaveLength(3);
      expect(aggregator.getBufferedEventsCount()).toBe(4);
    });

    it("counts occurrences and unique coordinators/workers accurately", () => {
      const aggregator = new FrictionTelemetryAggregator();

      const events: OperationalExecutionEvent[] = [
        {
          id: "e1",
          type: "TASK_DISPATCH",
          timestamp: 100,
          metadata: { coordinatorId: "c1", workerId: "w1" },
        },
        {
          id: "e2",
          type: "TASK_DISPATCH",
          timestamp: 101,
          metadata: { coordinatorId: "c1", workerId: "w2" },
        },
        {
          id: "e3",
          type: "TASK_COMPLETE",
          timestamp: 102,
          metadata: { coordinatorId: "c1", workerId: "w1" },
        },
        {
          id: "e4",
          type: "TASK_REDISPATCH",
          timestamp: 103,
          metadata: { coordinatorId: "c1", workerId: "w2" },
        },
        { id: "e5", type: "WORKER_ZOMBIE_KILL", timestamp: 104, metadata: { workerId: "w2" } },
        {
          id: "e6",
          type: "SUPERVISORY_BOUNDARY_CHECK",
          timestamp: 105,
          metadata: { coordinatorId: "c2" },
        },
        {
          id: "e7",
          type: "SUPERVISORY_BOUNDARY_SLIP",
          timestamp: 106,
          metadata: { coordinatorId: "c2" },
        },
        {
          id: "e8",
          type: "LATENCY_MEASUREMENT",
          timestamp: 107,
          metadata: { durationMs: 12000, latencyCategory: "compilation" },
        },
      ];

      const counts = aggregator.countEpochEvents(events);
      expect(counts.totalEvents).toBe(8);
      expect(counts.taskDispatches).toBe(2);
      expect(counts.taskCompletions).toBe(1);
      expect(counts.taskRedispatches).toBe(1);
      expect(counts.workerZombieKills).toBe(1);
      expect(counts.supervisoryBoundaryChecks).toBe(1);
      expect(counts.supervisoryBoundarySlips).toBe(1);
      expect(counts.latencyMeasurements).toBe(1);
      expect(counts.uniqueCoordinators).toBe(2); // c1, c2
      expect(counts.uniqueWorkers).toBe(2); // w1, w2
    });
  });

describe("3. Calculation of 4 Operational Friction Indices", () => {
    it("computes Task Ambiguity Index: (task redispatches / total dispatches)", () => {
      const aggregator = new FrictionTelemetryAggregator();
      const events: OperationalExecutionEvent[] = [
        { id: "1", type: "TASK_DISPATCH", timestamp: 1 },
        { id: "2", type: "TASK_DISPATCH", timestamp: 2 },
        { id: "3", type: "TASK_DISPATCH", timestamp: 3 },
        { id: "4", type: "TASK_DISPATCH", timestamp: 4 },
        { id: "5", type: "TASK_REDISPATCH", timestamp: 5 }, // 1 redispatch out of 4 dispatches = 0.25
      ];
      const counts = aggregator.countEpochEvents(events);
      const raw = aggregator.computeRawIndices(events, counts);

      expect(raw.taskAmbiguityIndex).toBe(0.25);
    });

    it("computes Worker Recycling Index: (zombie kills / task completions)", () => {
      const aggregator = new FrictionTelemetryAggregator();
      const events: OperationalExecutionEvent[] = [
        { id: "1", type: "TASK_COMPLETE", timestamp: 1 },
        { id: "2", type: "TASK_COMPLETE", timestamp: 2 },
        { id: "3", type: "WORKER_ZOMBIE_KILL", timestamp: 3 }, // 1 zombie kill out of 2 completions = 0.50
      ];
      const counts = aggregator.countEpochEvents(events);
      const raw = aggregator.computeRawIndices(events, counts);

      expect(raw.workerRecyclingIndex).toBe(0.5);
    });

    it("computes Supervisory Strain Index: (boundary slip attempts / unique coordinators)", () => {
      const aggregator = new FrictionTelemetryAggregator();
      const events: OperationalExecutionEvent[] = [
        {
          id: "1",
          type: "SUPERVISORY_BOUNDARY_SLIP",
          timestamp: 1,
          metadata: { coordinatorId: "c1" },
        },
        {
          id: "2",
          type: "SUPERVISORY_BOUNDARY_SLIP",
          timestamp: 2,
          metadata: { coordinatorId: "c2" },
        },
      ];
      const counts = aggregator.countEpochEvents(events);
      const raw = aggregator.computeRawIndices(events, counts);

      // 2 slips across 2 coordinators = 2/2 = 1.0 (clamped)
      expect(raw.supervisoryStrainIndex).toBe(1.0);
    });

    it("computes Infrastructure Latency Index relative to category baselines", () => {
      const aggregator = new FrictionTelemetryAggregator();
      const events: OperationalExecutionEvent[] = [
        // Compilation baseline: 10,000ms. Measured: 25,000ms -> inflation = (25-10)/10 = 1.5 -> score = 1.5 / 3.0 = 0.5
        {
          id: "1",
          type: "LATENCY_MEASUREMENT",
          timestamp: 1,
          metadata: { durationMs: 25_000, latencyCategory: "compilation" },
        },
        // Test baseline: 15,000ms. Measured: 30,000ms -> inflation = (30-15)/15 = 1.0 -> score = 1.0 / 3.0 = 0.3333
        {
          id: "2",
          type: "LATENCY_MEASUREMENT",
          timestamp: 2,
          metadata: { durationMs: 30_000, latencyCategory: "test" },
        },
      ];
      const counts = aggregator.countEpochEvents(events);
      const raw = aggregator.computeRawIndices(events, counts);

      // Median of [0.5, 0.3333] = 0.4167
      expect(raw.infrastructureLatencyIndex).toBeCloseTo(0.4167, 3);
    });
  });
});
