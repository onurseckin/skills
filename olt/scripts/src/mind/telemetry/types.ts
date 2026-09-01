/**
 * Core type definitions for 15-Minute Windowed Friction Telemetry
 * and Composite Systemic Execution Health Scoring.
 */

export type ExecutionEventType =
  | "TASK_DISPATCH"
  | "TASK_COMPLETE"
  | "TASK_REDISPATCH"
  | "WORKER_ZOMBIE_KILL"
  | "SUPERVISORY_BOUNDARY_CHECK"
  | "SUPERVISORY_BOUNDARY_SLIP"
  | "LATENCY_MEASUREMENT";

export type LatencyCategory =
  | "compilation"
  | "test"
  | "packaging"
  | "execution"
  | "network"
  | "pipeline";

export interface EventMetadata {
  readonly coordinatorId?: string | undefined;
  readonly workerId?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly baselineDurationMs?: number | undefined;
  readonly latencyCategory?: LatencyCategory | string | undefined;
  readonly error?: string | undefined;
  readonly taskId?: string | undefined;
  readonly attempt?: number | undefined;
  readonly reason?: string | undefined;
  readonly boundaryScope?: string | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface OperationalExecutionEvent {
  readonly id: string;
  readonly type: ExecutionEventType;
  readonly timestamp: number;
  readonly metadata?: EventMetadata | undefined;
}

export interface RecordExecutionEventInput {
  readonly id?: string | undefined;
  readonly type: ExecutionEventType;
  readonly timestamp?: number | undefined;
  readonly metadata?: EventMetadata | undefined;
}

export interface FrictionIndices {
  /** Task Ambiguity Index [0.0, 1.0]: ratio of tasks requiring re-dispatch or failing verification on turn one */
  readonly taskAmbiguityIndex: number;
  /** Worker Recycling Index [0.0, 1.0]: frequency of zombie terminations per completed work */
  readonly workerRecyclingIndex: number;
  /** Supervisory Strain Index [0.0, 1.0]: boundary slip attempts per active supervisor / coordinator */
  readonly supervisoryStrainIndex: number;
  /** Infrastructure Latency Index [0.0, 1.0]: latency inflation ratio relative to baseline */
  readonly infrastructureLatencyIndex: number;
}

export type HealthScoreStatus = "nominal" | "degraded" | "critical";

export interface EpochEventCounts {
  readonly taskDispatches: number;
  readonly taskCompletions: number;
  readonly taskRedispatches: number;
  readonly workerZombieKills: number;
  readonly supervisoryBoundaryChecks: number;
  readonly supervisoryBoundarySlips: number;
  readonly latencyMeasurements: number;
  readonly totalEvents: number;
  readonly uniqueCoordinators: number;
  readonly uniqueWorkers: number;
}

export interface EpochTelemetrySnapshot {
  readonly epochIndex: number;
  readonly epochStart: number;
  readonly epochEnd: number;
  readonly durationMs: number;
  readonly eventCounts: EpochEventCounts;
  readonly rawIndices: FrictionIndices;
  readonly dampenedIndices: FrictionIndices;
  readonly compositeHealthScore: number;
  readonly status: HealthScoreStatus;
  readonly anomalyDampened: boolean;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface StrategicFrictionIntervention {
  readonly id: string;
  readonly triggeredAtEpoch: number;
  readonly triggeredAtTimestamp: number;
  readonly consecutiveDegradedEpochs: number;
  readonly healthScore: number;
  readonly roadmapExpansionLocked: boolean;
  readonly rootCauses: readonly string[];
  readonly requiredSimplifications: readonly string[];
  readonly resolvedAt: number | null;
  readonly resolvedAtEpoch?: number | null | undefined;
}

export interface HealthEvaluationResult {
  readonly compositeHealthScore: number;
  readonly status: HealthScoreStatus;
  readonly consecutiveDegradedEpochs: number;
  readonly interventionTriggered: boolean;
  readonly interventionResolved: boolean;
  readonly activeIntervention?: StrategicFrictionIntervention | undefined;
  readonly roadmapExpansionLocked: boolean;
  readonly reasons: readonly string[];
}

export interface FrictionTelemetryConfig {
  /** Epoch duration in milliseconds. Defaults to 900,000 ms (15 minutes). */
  readonly epochDurationMs?: number | undefined;
  /** Baseline infrastructure latency in milliseconds for unclassified operations. Defaults to 5,000 ms. */
  readonly baselineLatencyMs?: number | undefined;
  /** Category-specific baseline latencies in milliseconds. */
  readonly categoryBaselines?: Readonly<Record<string, number>> | undefined;
  /** Minimum events count required before raw index reaches full significance (prevents 1-event extremes). Defaults to 3. */
  readonly minEventsForSignificance?: number | undefined;
  /** Exponential smoothing alpha for historical epoch dampening. Defaults to 0.70. */
  readonly smoothingAlpha?: number | undefined;
  /** Maximum number of past epoch snapshots to retain in history. Defaults to 96 (24 hours of 15-minute epochs). */
  readonly maxHistorySnapshots?: number | undefined;
  /** Latency inflation factor that maps to maximum friction (1.0). Defaults to 3.0 (i.e. 3x baseline = 1.0). */
  readonly maxLatencyInflationFactor?: number | undefined;
}

export interface HealthScoringWeights {
  readonly taskAmbiguityWeight?: number | undefined;
  readonly workerRecyclingWeight?: number | undefined;
  readonly supervisoryStrainWeight?: number | undefined;
  readonly infrastructureLatencyWeight?: number | undefined;
}

export interface HealthScoringConfig {
  readonly weights?: HealthScoringWeights | undefined;
  readonly nominalThreshold?: number | undefined;
  readonly criticalThreshold?: number | undefined;
  readonly consecutiveDegradedThreshold?: number | undefined;
  readonly maxInterventionHistory?: number | undefined;
}
