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


