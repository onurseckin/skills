export type {
  ExecutionEventType,
  LatencyCategory,
  EventMetadata,
  OperationalExecutionEvent,
  RecordExecutionEventInput,
  FrictionIndices,
  HealthScoreStatus,
  EpochEventCounts,
  EpochTelemetrySnapshot,
  StrategicFrictionIntervention,
  HealthEvaluationResult,
  FrictionTelemetryConfig,
  HealthScoringWeights,
  HealthScoringConfig,
} from "./types.ts";

export {
  clamp01,
  round4,
  calculateMedian,
  createFrictionTelemetryAggregator,
  DEFAULT_EPOCH_DURATION_MS,
  DEFAULT_BASELINE_LATENCY_MS,
  DEFAULT_MIN_EVENTS_FOR_SIGNIFICANCE,
  DEFAULT_SMOOTHING_ALPHA,
  DEFAULT_MAX_HISTORY_SNAPSHOTS,
  DEFAULT_MAX_LATENCY_INFLATION_FACTOR,
  DEFAULT_CATEGORY_BASELINES,
  FrictionTelemetryAggregator,
} from "./friction-telemetry.ts";

export {
  createHealthScoringEngine,
  formatInterventionSummary,
  formatHealthEvaluationSummary,
  DEFAULT_NOMINAL_THRESHOLD,
  DEFAULT_CRITICAL_THRESHOLD,
  DEFAULT_CONSECUTIVE_DEGRADED_FOR_INTERVENTION,
  DEFAULT_MAX_INTERVENTION_HISTORY,
  DEFAULT_WEIGHTS,
  HealthScoringEngine,
} from "./health-scoring.ts";

import {
  FrictionTelemetryAggregator,
  createFrictionTelemetryAggregator,
} from "./friction-telemetry.ts";
import { HealthScoringEngine, createHealthScoringEngine } from "./health-scoring.ts";
import type {
  FrictionTelemetryConfig,
  HealthEvaluationResult,
  HealthScoringConfig,
  OperationalExecutionEvent,
  RecordExecutionEventInput,
} from "./types.ts";

export class MindTelemetryCoordinator {
  private readonly aggregator: FrictionTelemetryAggregator;
  private readonly healthEngine: HealthScoringEngine;

  public constructor(options?: {
    readonly telemetryConfig?: FrictionTelemetryConfig | undefined;
    readonly healthConfig?: HealthScoringConfig | undefined;
    readonly initialStartTime?: number | undefined;
  }) {
    this.aggregator = createFrictionTelemetryAggregator(
      options?.telemetryConfig,
      options?.initialStartTime,
    );
    this.healthEngine = createHealthScoringEngine(options?.healthConfig);
  }

  public recordEvent(
    input: RecordExecutionEventInput | OperationalExecutionEvent,
  ): OperationalExecutionEvent {
    return this.aggregator.recordEvent(input);
  }

  public recordEvents(
    inputs: readonly (RecordExecutionEventInput | OperationalExecutionEvent)[],
  ): readonly OperationalExecutionEvent[] {
    return this.aggregator.recordEvents(inputs);
  }

  public closeAndEvaluateEpoch(epochEndTime?: number | undefined): HealthEvaluationResult {
    const snapshot = this.aggregator.closeEpoch(epochEndTime);
    return this.healthEngine.processEpoch(snapshot);
  }

  public getAggregator(): FrictionTelemetryAggregator {
    return this.aggregator;
  }

  public getHealthEngine(): HealthScoringEngine {
    return this.healthEngine;
  }

  public isRoadmapExpansionLocked(): boolean {
    return this.healthEngine.isRoadmapExpansionLocked();
  }

  public reset(initialStartTime?: number | undefined): void {
    this.aggregator.reset(initialStartTime);
    this.healthEngine.reset();
  }
}

export function createMindTelemetryCoordinator(options?: {
  readonly telemetryConfig?: FrictionTelemetryConfig | undefined;
  readonly healthConfig?: HealthScoringConfig | undefined;
  readonly initialStartTime?: number | undefined;
}): MindTelemetryCoordinator {
  return new MindTelemetryCoordinator(options);
}
