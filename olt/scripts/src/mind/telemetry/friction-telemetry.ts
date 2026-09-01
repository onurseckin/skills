/**
 * 15-Minute Windowed Friction Telemetry Aggregator.
 *
 * Ingests operational execution events, dampens transient anomaly blips,
 * computes 4 Operational Friction Indices, and produces rolling epoch snapshots.
 */

import type {
  EpochEventCounts,
  EpochTelemetrySnapshot,
  ExecutionEventType,
  FrictionIndices,
  FrictionTelemetryConfig,
  HealthScoreStatus,
  OperationalExecutionEvent,
  RecordExecutionEventInput,
} from "./types.ts";

export const DEFAULT_EPOCH_DURATION_MS = 900_000; // 15 minutes
export const DEFAULT_BASELINE_LATENCY_MS = 5_000; // 5 seconds
export const DEFAULT_MIN_EVENTS_FOR_SIGNIFICANCE = 3;
export const DEFAULT_SMOOTHING_ALPHA = 0.7;
export const DEFAULT_MAX_HISTORY_SNAPSHOTS = 96; // 24 hours of 15-minute epochs
export const DEFAULT_MAX_LATENCY_INFLATION_FACTOR = 3.0;

export const DEFAULT_CATEGORY_BASELINES: Readonly<Record<string, number>> = Object.freeze({
  compilation: 10_000,
  test: 15_000,
  packaging: 8_000,
  execution: 5_000,
  network: 1_000,
  pipeline: 20_000,
});

/**
 * Utility: Clamp number between 0.0 and 1.0.
 */
export function clamp01(val: number): number {
  if (Number.isNaN(val) || !Number.isFinite(val)) return 0.0;
  return Math.max(0.0, Math.min(1.0, val));
}

/**
 * Utility: Round to 4 decimal places.
 */
export function round4(val: number): number {
  if (Number.isNaN(val) || !Number.isFinite(val)) return 0.0;
  return Math.round(val * 10000) / 10000;
}

/**
 * Utility: Calculate median of numbers array.
 */
export function calculateMedian(values: readonly number[]): number {
  if (values.length === 0) return 0.0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const v1 = sorted[mid - 1] ?? 0;
    const v2 = sorted[mid] ?? 0;
    return (v1 + v2) / 2;
  }
  return sorted[mid] ?? 0;
}

export class FrictionTelemetryAggregator {
  private readonly epochDurationMs: number;
  private readonly baselineLatencyMs: number;
  private readonly categoryBaselines: Readonly<Record<string, number>>;
  private readonly minEventsForSignificance: number;
  private readonly smoothingAlpha: number;
  private readonly maxHistorySnapshots: number;
  private readonly maxLatencyInflationFactor: number;

  private currentEpochIndex: number = 0;
  private currentEpochStart: number;
  private bufferedEvents: OperationalExecutionEvent[] = [];
  private epochHistory: EpochTelemetrySnapshot[] = [];
  private eventCounter: number = 0;

  public constructor(
    config?: FrictionTelemetryConfig | undefined,
    initialStartTime?: number | undefined,
  ) {
    this.epochDurationMs = config?.epochDurationMs ?? DEFAULT_EPOCH_DURATION_MS;
    this.baselineLatencyMs = config?.baselineLatencyMs ?? DEFAULT_BASELINE_LATENCY_MS;
    this.categoryBaselines = config?.categoryBaselines ?? DEFAULT_CATEGORY_BASELINES;
    this.minEventsForSignificance =
      config?.minEventsForSignificance ?? DEFAULT_MIN_EVENTS_FOR_SIGNIFICANCE;
    this.smoothingAlpha = config?.smoothingAlpha ?? DEFAULT_SMOOTHING_ALPHA;
    this.maxHistorySnapshots = config?.maxHistorySnapshots ?? DEFAULT_MAX_HISTORY_SNAPSHOTS;
    this.maxLatencyInflationFactor =
      config?.maxLatencyInflationFactor ?? DEFAULT_MAX_LATENCY_INFLATION_FACTOR;

    this.currentEpochStart = initialStartTime ?? Date.now();
  }

  /**
   * Record an operational execution event.
   */
  public recordEvent(
    input: RecordExecutionEventInput | OperationalExecutionEvent,
  ): OperationalExecutionEvent {
    this.eventCounter += 1;
    const timestamp = input.timestamp ?? Date.now();
    const id = input.id && input.id.length > 0 ? input.id : `evt-${timestamp}-${this.eventCounter}`;

    const event: OperationalExecutionEvent = {
      id,
      type: input.type,
      timestamp,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    };

    this.bufferedEvents.push(event);
    return event;
  }

  /**
   * Ingest multiple operational execution events in batch.
   */
  public recordEvents(
    inputs: readonly (RecordExecutionEventInput | OperationalExecutionEvent)[],
  ): readonly OperationalExecutionEvent[] {
    const recorded: OperationalExecutionEvent[] = [];
    for (const input of inputs) {
      recorded.push(this.recordEvent(input));
    }
    return recorded;
  }

  /**
   * Get total number of in-flight buffered events in the current epoch.
   */
  public getBufferedEventsCount(): number {
    return this.bufferedEvents.length;
  }

  /**
   * Get current epoch index.
   */
  public getCurrentEpochIndex(): number {
    return this.currentEpochIndex;
  }

  /**
   * Get current epoch start timestamp (epochStart ms).
   */
  public getCurrentEpochStart(): number {
    return this.currentEpochStart;
  }

  /**
   * Count occurrences and unique participants in an array of events.
   */
  public countEpochEvents(events: readonly OperationalExecutionEvent[]): EpochEventCounts {
    let taskDispatches = 0;
    let taskCompletions = 0;
    let taskRedispatches = 0;
    let workerZombieKills = 0;
    let supervisoryBoundaryChecks = 0;
    let supervisoryBoundarySlips = 0;
    let latencyMeasurements = 0;

    const uniqueCoordinators = new Set<string>();
    const uniqueWorkers = new Set<string>();

    for (const event of events) {
      if (event.metadata?.coordinatorId) {
        uniqueCoordinators.add(event.metadata.coordinatorId);
      }
      if (event.metadata?.workerId) {
        uniqueWorkers.add(event.metadata.workerId);
      }

      switch (event.type) {
        case "TASK_DISPATCH":
          taskDispatches += 1;
          break;
        case "TASK_COMPLETE":
          taskCompletions += 1;
          break;
        case "TASK_REDISPATCH":
          taskRedispatches += 1;
          break;
        case "WORKER_ZOMBIE_KILL":
          workerZombieKills += 1;
          break;
        case "SUPERVISORY_BOUNDARY_CHECK":
          supervisoryBoundaryChecks += 1;
          break;
        case "SUPERVISORY_BOUNDARY_SLIP":
          supervisoryBoundarySlips += 1;
          break;
        case "LATENCY_MEASUREMENT":
          latencyMeasurements += 1;
          break;
      }
    }

    return {
      taskDispatches,
      taskCompletions,
      taskRedispatches,
      workerZombieKills,
      supervisoryBoundaryChecks,
      supervisoryBoundarySlips,
      latencyMeasurements,
      totalEvents: events.length,
      uniqueCoordinators: uniqueCoordinators.size,
      uniqueWorkers: uniqueWorkers.size,
    };
  }

  /**
   * Compute the 4 raw Operational Friction Indices from events and counts.
   */
  public computeRawIndices(
    events: readonly OperationalExecutionEvent[],
    counts: EpochEventCounts,
  ): FrictionIndices {
    // 1. Task Ambiguity Index: (re-dispatches / total dispatches)
    let rawTaskAmbiguity = 0.0;
    if (counts.taskDispatches > 0) {
      rawTaskAmbiguity = clamp01(counts.taskRedispatches / counts.taskDispatches);
    } else if (counts.taskRedispatches > 0) {
      rawTaskAmbiguity = 1.0;
    }

    // 2. Worker Recycling Index: (zombie terminations / completed tasks)
    let rawWorkerRecycling = 0.0;
    if (counts.taskCompletions > 0) {
      rawWorkerRecycling = clamp01(counts.workerZombieKills / counts.taskCompletions);
    } else if (counts.workerZombieKills > 0) {
      rawWorkerRecycling = 1.0;
    }

    // 3. Supervisory Strain Index: (boundary slip attempts / active supervisors)
    let rawSupervisoryStrain = 0.0;
    const effectiveSupervisors = Math.max(1, counts.uniqueCoordinators);
    if (counts.supervisoryBoundarySlips > 0) {
      rawSupervisoryStrain = clamp01(counts.supervisoryBoundarySlips / effectiveSupervisors);
    }

    // 4. Infrastructure Latency Index: growth in compilation/test/packaging runtimes relative to baseline
    let rawInfrastructureLatency = 0.0;
    const latencyFrictions: number[] = [];

    for (const event of events) {
      const durationMs = event.metadata?.durationMs;
      if (typeof durationMs === "number" && durationMs > 0) {
        const category = event.metadata?.latencyCategory;
        const baseline =
          event.metadata?.baselineDurationMs ??
          (category !== undefined && this.categoryBaselines[category] !== undefined
            ? (this.categoryBaselines[category] ?? this.baselineLatencyMs)
            : this.baselineLatencyMs);

        if (baseline > 0) {
          const inflationRatio = Math.max(0, (durationMs - baseline) / baseline);
          const frictionScore = clamp01(inflationRatio / this.maxLatencyInflationFactor);
          latencyFrictions.push(frictionScore);
        }
      }
    }

    if (latencyFrictions.length > 0) {
      // Use median within epoch to dampen isolated single-lag spikes from dominating the epoch
      rawInfrastructureLatency = calculateMedian(latencyFrictions);
    }

    return {
      taskAmbiguityIndex: round4(rawTaskAmbiguity),
      workerRecyclingIndex: round4(rawWorkerRecycling),
      supervisoryStrainIndex: round4(rawSupervisoryStrain),
      infrastructureLatencyIndex: round4(rawInfrastructureLatency),
    };
  }

  /**
   * Anomaly Dampening Filter:
   * Dampens transient single-event blips and small-sample extremes using
   * sample-volume confidence scaling and historical median smoothing.
   */
  public applyAnomalyDampener(
    raw: FrictionIndices,
    counts: EpochEventCounts,
    history: readonly EpochTelemetrySnapshot[],
  ): FrictionIndices {
    const minSig = this.minEventsForSignificance;

    // A. Sample-volume confidence dampener (prevents 1 task failure out of 1 dispatch from registering as 100% systemic failure)
    const taskConfidence = counts.taskDispatches >= minSig ? 1.0 : counts.taskDispatches / minSig;
    const workerConfidence =
      counts.taskCompletions >= minSig ? 1.0 : counts.taskCompletions / minSig;
    const supervisorDenominator = Math.max(
      1,
      counts.uniqueCoordinators + counts.supervisoryBoundaryChecks,
    );
    const supervisorConfidence =
      supervisorDenominator >= minSig ? 1.0 : supervisorDenominator / minSig;
    const latencyConfidence =
      counts.latencyMeasurements >= minSig
        ? 1.0
        : Math.max(0.5, counts.latencyMeasurements / minSig);

    const sampleDampenedTask = raw.taskAmbiguityIndex * taskConfidence;
    const sampleDampenedWorker = raw.workerRecyclingIndex * workerConfidence;
    const sampleDampenedSupervisor = raw.supervisoryStrainIndex * supervisorConfidence;
    const sampleDampenedLatency = raw.infrastructureLatencyIndex * latencyConfidence;

    // B. Temporal historical smoothing against historical baseline
    if (history.length === 0) {
      return {
        taskAmbiguityIndex: round4(clamp01(sampleDampenedTask)),
        workerRecyclingIndex: round4(clamp01(sampleDampenedWorker)),
        supervisoryStrainIndex: round4(clamp01(sampleDampenedSupervisor)),
        infrastructureLatencyIndex: round4(clamp01(sampleDampenedLatency)),
      };
    }

    // Get recent historical window (last 5 epochs)
    const recentHistory = history.slice(-5);
    const histTaskMedian = calculateMedian(
      recentHistory.map((s) => s.dampenedIndices.taskAmbiguityIndex),
    );
    const histWorkerMedian = calculateMedian(
      recentHistory.map((s) => s.dampenedIndices.workerRecyclingIndex),
    );
    const histSupervisorMedian = calculateMedian(
      recentHistory.map((s) => s.dampenedIndices.supervisoryStrainIndex),
    );
    const histLatencyMedian = calculateMedian(
      recentHistory.map((s) => s.dampenedIndices.infrastructureLatencyIndex),
    );

    const alpha = this.smoothingAlpha;

    // If current sample count is low, weight historical baseline more heavily to dampen transient blips
    const finalTask = alpha * sampleDampenedTask + (1 - alpha) * histTaskMedian;
    const finalWorker = alpha * sampleDampenedWorker + (1 - alpha) * histWorkerMedian;
    const finalSupervisor = alpha * sampleDampenedSupervisor + (1 - alpha) * histSupervisorMedian;
    const finalLatency = alpha * sampleDampenedLatency + (1 - alpha) * histLatencyMedian;

    return {
      taskAmbiguityIndex: round4(clamp01(finalTask)),
      workerRecyclingIndex: round4(clamp01(finalWorker)),
      supervisoryStrainIndex: round4(clamp01(finalSupervisor)),
      infrastructureLatencyIndex: round4(clamp01(finalLatency)),
    };
  }

  /**
   * Compute composite health score and status from dampened friction indices.
   * Health Score = 1.0 - (0.30*TaskAmbiguity + 0.25*WorkerRecycling + 0.25*SupervisoryStrain + 0.20*InfrastructureLatency).
   */
  public computeCompositeScore(indices: FrictionIndices): {
    score: number;
    status: HealthScoreStatus;
  } {
    const friction =
      0.3 * indices.taskAmbiguityIndex +
      0.25 * indices.workerRecyclingIndex +
      0.25 * indices.supervisoryStrainIndex +
      0.2 * indices.infrastructureLatencyIndex;

    const score = round4(clamp01(1.0 - friction));
    let status: HealthScoreStatus = "nominal";
    if (score < 0.6) {
      status = "critical";
    } else if (score < 0.85) {
      status = "degraded";
    }

    return { score, status };
  }

  /**
   * Preview current snapshot without closing the epoch.
   */
  public peekCurrentSnapshot(): EpochTelemetrySnapshot {
    const epochStart = this.currentEpochStart;
    const epochEnd = Date.now();
    const durationMs = Math.max(0, epochEnd - epochStart);

    const counts = this.countEpochEvents(this.bufferedEvents);
    const rawIndices = this.computeRawIndices(this.bufferedEvents, counts);
    const dampenedIndices = this.applyAnomalyDampener(rawIndices, counts, this.epochHistory);
    const { score, status } = this.computeCompositeScore(dampenedIndices);

    const anomalyDampened =
      Math.abs(dampenedIndices.taskAmbiguityIndex - rawIndices.taskAmbiguityIndex) > 0.001 ||
      Math.abs(dampenedIndices.workerRecyclingIndex - rawIndices.workerRecyclingIndex) > 0.001 ||
      Math.abs(dampenedIndices.supervisoryStrainIndex - rawIndices.supervisoryStrainIndex) >
        0.001 ||
      Math.abs(dampenedIndices.infrastructureLatencyIndex - rawIndices.infrastructureLatencyIndex) >
        0.001;

    return {
      epochIndex: this.currentEpochIndex,
      epochStart,
      epochEnd,
      durationMs,
      eventCounts: counts,
      rawIndices,
      dampenedIndices,
      compositeHealthScore: score,
      status,
      anomalyDampened,
    };
  }

  /**
   * Close the active epoch, compute indices and dampening, record snapshot to history,
   * and advance to the next epoch.
   */
  public closeEpoch(epochEndTime?: number | undefined): EpochTelemetrySnapshot {
    const epochStart = this.currentEpochStart;
    const epochEnd = epochEndTime ?? epochStart + this.epochDurationMs;
    const durationMs = Math.max(0, epochEnd - epochStart);

    const counts = this.countEpochEvents(this.bufferedEvents);
    const rawIndices = this.computeRawIndices(this.bufferedEvents, counts);
    const dampenedIndices = this.applyAnomalyDampener(rawIndices, counts, this.epochHistory);
    const { score, status } = this.computeCompositeScore(dampenedIndices);

    const anomalyDampened =
      Math.abs(dampenedIndices.taskAmbiguityIndex - rawIndices.taskAmbiguityIndex) > 0.001 ||
      Math.abs(dampenedIndices.workerRecyclingIndex - rawIndices.workerRecyclingIndex) > 0.001 ||
      Math.abs(dampenedIndices.supervisoryStrainIndex - rawIndices.supervisoryStrainIndex) >
        0.001 ||
      Math.abs(dampenedIndices.infrastructureLatencyIndex - rawIndices.infrastructureLatencyIndex) >
        0.001;

    const snapshot: EpochTelemetrySnapshot = {
      epochIndex: this.currentEpochIndex,
      epochStart,
      epochEnd,
      durationMs,
      eventCounts: counts,
      rawIndices,
      dampenedIndices,
      compositeHealthScore: score,
      status,
      anomalyDampened,
    };

    this.epochHistory.push(snapshot);
    if (this.epochHistory.length > this.maxHistorySnapshots) {
      this.epochHistory.shift();
    }

    // Advance to next epoch
    this.currentEpochIndex += 1;
    this.currentEpochStart = epochEnd;
    this.bufferedEvents = [];

    return snapshot;
  }

  /**
   * Get all historical snapshots.
   */
  public getEpochHistory(): readonly EpochTelemetrySnapshot[] {
    return [...this.epochHistory];
  }

  /**
   * Get the most recent closed snapshot, if any.
   */
  public getLatestSnapshot(): EpochTelemetrySnapshot | undefined {
    return this.epochHistory[this.epochHistory.length - 1];
  }

  /**
   * Reset aggregator to clean initial state.
   */
  public reset(initialStartTime?: number | undefined): void {
    this.currentEpochIndex = 0;
    this.currentEpochStart = initialStartTime ?? Date.now();
    this.bufferedEvents = [];
    this.epochHistory = [];
    this.eventCounter = 0;
  }
}

/**
 * Factory helper to create a new aggregator instance.
 */
export function createFrictionTelemetryAggregator(
  config?: FrictionTelemetryConfig | undefined,
  initialStartTime?: number | undefined,
): FrictionTelemetryAggregator {
  return new FrictionTelemetryAggregator(config, initialStartTime);
}
