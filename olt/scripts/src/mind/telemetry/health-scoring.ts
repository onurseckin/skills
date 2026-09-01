/**
 * Composite Systemic Execution Health Scoring and Strategic Friction Intervention Engine.
 *
 * Factors the 4 operational friction indices into a normalized 0.0 - 1.0 composite score.
 * Tracks consecutive degraded epochs and manages Strategic Friction Interventions with
 * roadmap expansion locking and forced architectural simplifications.
 */

import type {
  EpochTelemetrySnapshot,
  FrictionIndices,
  HealthEvaluationResult,
  HealthScoreStatus,
  HealthScoringConfig,
  StrategicFrictionIntervention,
} from "./types.ts";
import { clamp01, round4 } from "./friction-telemetry.ts";

export const DEFAULT_NOMINAL_THRESHOLD = 0.85;
export const DEFAULT_CRITICAL_THRESHOLD = 0.6;
export const DEFAULT_CONSECUTIVE_DEGRADED_FOR_INTERVENTION = 2;
export const DEFAULT_MAX_INTERVENTION_HISTORY = 50;

export const DEFAULT_WEIGHTS = Object.freeze({
  taskAmbiguity: 0.3,
  workerRecycling: 0.25,
  supervisoryStrain: 0.25,
  infrastructureLatency: 0.2,
});

export class HealthScoringEngine {
  private readonly weights: {
    readonly taskAmbiguity: number;
    readonly workerRecycling: number;
    readonly supervisoryStrain: number;
    readonly infrastructureLatency: number;
  };
  private readonly nominalThreshold: number;
  private readonly criticalThreshold: number;
  private readonly consecutiveDegradedThreshold: number;
  private readonly maxInterventionHistory: number;

  private consecutiveDegradedEpochs: number = 0;
  private activeIntervention: StrategicFrictionIntervention | undefined = undefined;
  private interventionHistory: StrategicFrictionIntervention[] = [];
  private interventionCounter: number = 0;

  public constructor(config?: HealthScoringConfig | undefined) {
    const rawWeights = {
      taskAmbiguity: Math.max(
        0,
        config?.weights?.taskAmbiguityWeight ?? DEFAULT_WEIGHTS.taskAmbiguity,
      ),
      workerRecycling: Math.max(
        0,
        config?.weights?.workerRecyclingWeight ?? DEFAULT_WEIGHTS.workerRecycling,
      ),
      supervisoryStrain: Math.max(
        0,
        config?.weights?.supervisoryStrainWeight ?? DEFAULT_WEIGHTS.supervisoryStrain,
      ),
      infrastructureLatency: Math.max(
        0,
        config?.weights?.infrastructureLatencyWeight ?? DEFAULT_WEIGHTS.infrastructureLatency,
      ),
    };

    const totalWeight =
      rawWeights.taskAmbiguity +
      rawWeights.workerRecycling +
      rawWeights.supervisoryStrain +
      rawWeights.infrastructureLatency;

    const normalizedTotal = totalWeight > 0 ? totalWeight : 1.0;

    this.weights = Object.freeze({
      taskAmbiguity: rawWeights.taskAmbiguity / normalizedTotal,
      workerRecycling: rawWeights.workerRecycling / normalizedTotal,
      supervisoryStrain: rawWeights.supervisoryStrain / normalizedTotal,
      infrastructureLatency: rawWeights.infrastructureLatency / normalizedTotal,
    });

    this.nominalThreshold = config?.nominalThreshold ?? DEFAULT_NOMINAL_THRESHOLD;
    this.criticalThreshold = config?.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD;
    this.consecutiveDegradedThreshold =
      config?.consecutiveDegradedThreshold ?? DEFAULT_CONSECUTIVE_DEGRADED_FOR_INTERVENTION;
    this.maxInterventionHistory =
      config?.maxInterventionHistory ?? DEFAULT_MAX_INTERVENTION_HISTORY;
  }

  /**
   * Compute composite execution health score from friction indices.
   * Health Score = 1.0 - (w_task*TaskAmbiguity + w_worker*WorkerRecycling + w_sup*SupervisoryStrain + w_lat*InfrastructureLatency).
   */
  public computeHealthScore(indices: FrictionIndices): {
    score: number;
    status: HealthScoreStatus;
  } {
    const totalFriction =
      this.weights.taskAmbiguity * indices.taskAmbiguityIndex +
      this.weights.workerRecycling * indices.workerRecyclingIndex +
      this.weights.supervisoryStrain * indices.supervisoryStrainIndex +
      this.weights.infrastructureLatency * indices.infrastructureLatencyIndex;

    const score = round4(clamp01(1.0 - totalFriction));

    let status: HealthScoreStatus = "nominal";
    if (score < this.criticalThreshold) {
      status = "critical";
    } else if (score < this.nominalThreshold) {
      status = "degraded";
    }

    return { score, status };
  }

  /**
   * Evaluate root causes for degraded execution health based on dampened friction indices.
   */
  public analyzeRootCauses(indices: FrictionIndices): readonly string[] {
    const causes: string[] = [];

    if (indices.taskAmbiguityIndex >= 0.15) {
      causes.push(
        `Elevated task ambiguity (${(indices.taskAmbiguityIndex * 100).toFixed(1)}%): excessive redispatches or turn-one verification failures`,
      );
    }
    if (indices.workerRecyclingIndex >= 0.1) {
      causes.push(
        `Worker instability (${(indices.workerRecyclingIndex * 100).toFixed(1)}%): high zombie process termination frequency per completed work`,
      );
    }
    if (indices.supervisoryStrainIndex >= 0.1) {
      causes.push(
        `Supervisory boundary strain (${(indices.supervisoryStrainIndex * 100).toFixed(1)}%): elevated boundary slip attempts across coordinators`,
      );
    }
    if (indices.infrastructureLatencyIndex >= 0.15) {
      causes.push(
        `Infrastructure latency expansion (${(indices.infrastructureLatencyIndex * 100).toFixed(1)}%): compilation, test, or packaging runtime growth relative to baseline`,
      );
    }

    if (causes.length === 0) {
      causes.push("Systemic multi-factor execution friction across consecutive operational epochs");
    }

    return Object.freeze(causes);
  }

  /**
   * Determine required architectural simplifications and bottleneck eliminations.
   */
  public determineRequiredSimplifications(indices: FrictionIndices): readonly string[] {
    const simplifications: string[] = [
      "Mandate forced architectural simplification and eliminate operational bottlenecks",
      "Lock roadmap feature expansion until systemic health score recovers to nominal (>= 0.85)",
    ];

    if (indices.taskAmbiguityIndex >= 0.15) {
      simplifications.push(
        "Deconstruct ambiguous tasks into smaller atomic units with strict pre-conditions and idempotent outputs",
      );
    }
    if (indices.workerRecyclingIndex >= 0.1) {
      simplifications.push(
        "Audit worker process lifecycles, isolate unhandled exceptions, and eliminate memory/handle leaks",
      );
    }
    if (indices.supervisoryStrainIndex >= 0.1) {
      simplifications.push(
        "Enforce strict supervisor containment boundaries and restrict unauthorized cross-scope tool invocation",
      );
    }
    if (indices.infrastructureLatencyIndex >= 0.15) {
      simplifications.push(
        "Prune non-critical test suites, enable aggressive caching for builds, and resolve pipeline bottlenecks",
      );
    }

    return Object.freeze(simplifications);
  }

  /**
   * Process a closed epoch snapshot, evaluate health score status, track consecutive degraded epochs,
   * trigger or resolve Strategic Friction Interventions, and update roadmap expansion lock status.
   */
  public processEpoch(snapshot: EpochTelemetrySnapshot): HealthEvaluationResult {
    const indices = snapshot.dampenedIndices;
    const { score, status } = this.computeHealthScore(indices);

    const reasons: string[] = [];
    let interventionTriggered = false;
    let interventionResolved = false;

    if (status === "degraded" || status === "critical") {
      this.consecutiveDegradedEpochs += 1;
      reasons.push(
        `Epoch ${snapshot.epochIndex} scored ${score.toFixed(4)} (${status}), below nominal threshold ${this.nominalThreshold.toFixed(2)}.`,
      );
      reasons.push(`Consecutive degraded epochs: ${this.consecutiveDegradedEpochs}.`);

      // Trigger intervention if threshold met
      if (this.consecutiveDegradedEpochs >= this.consecutiveDegradedThreshold) {
        if (!this.activeIntervention) {
          this.interventionCounter += 1;
          const interventionId = `sfi-epoch-${snapshot.epochIndex}-${Date.now()}-${this.interventionCounter}`;
          const rootCauses = this.analyzeRootCauses(indices);
          const requiredSimplifications = this.determineRequiredSimplifications(indices);

          this.activeIntervention = {
            id: interventionId,
            triggeredAtEpoch: snapshot.epochIndex,
            triggeredAtTimestamp: snapshot.epochEnd,
            consecutiveDegradedEpochs: this.consecutiveDegradedEpochs,
            healthScore: score,
            roadmapExpansionLocked: true,
            rootCauses,
            requiredSimplifications,
            resolvedAt: null,
          };

          interventionTriggered = true;
          reasons.push(
            `Strategic Friction Intervention triggered: roadmap expansion locked, forced simplification mandated.`,
          );
        } else {
          // Update active intervention with latest score and count
          const rootCauses = this.analyzeRootCauses(indices);
          const requiredSimplifications = this.determineRequiredSimplifications(indices);
          this.activeIntervention = {
            ...this.activeIntervention,
            consecutiveDegradedEpochs: this.consecutiveDegradedEpochs,
            healthScore: score,
            rootCauses,
            requiredSimplifications,
          };
          reasons.push(
            `Strategic Friction Intervention remains active at epoch ${snapshot.epochIndex}.`,
          );
        }
      }
    } else {
      // Nominal status (score >= 0.85)
      const previousConsecutive = this.consecutiveDegradedEpochs;
      this.consecutiveDegradedEpochs = 0;
      reasons.push(
        `Epoch ${snapshot.epochIndex} scored ${score.toFixed(4)} (nominal >= ${this.nominalThreshold.toFixed(2)}).`,
      );

      if (this.activeIntervention) {
        // Resolve active intervention
        const resolvedIntervention: StrategicFrictionIntervention = {
          ...this.activeIntervention,
          roadmapExpansionLocked: false,
          resolvedAt: Date.now(),
          resolvedAtEpoch: snapshot.epochIndex,
        };

        this.interventionHistory.push(resolvedIntervention);
        if (this.interventionHistory.length > this.maxInterventionHistory) {
          this.interventionHistory.shift();
        }

        this.activeIntervention = undefined;
        interventionResolved = true;
        reasons.push(
          `Systemic health recovered after ${previousConsecutive} degraded epochs. Strategic Friction Intervention resolved and roadmap unlocked.`,
        );
      }
    }

    const roadmapExpansionLocked =
      this.activeIntervention !== undefined && this.activeIntervention.roadmapExpansionLocked;

    return {
      compositeHealthScore: score,
      status,
      consecutiveDegradedEpochs: this.consecutiveDegradedEpochs,
      interventionTriggered,
      interventionResolved,
      ...(this.activeIntervention !== undefined
        ? { activeIntervention: this.activeIntervention }
        : {}),
      roadmapExpansionLocked,
      reasons: Object.freeze(reasons),
    };
  }

  /**
   * Get the currently active Strategic Friction Intervention, if one exists.
   */
  public getActiveIntervention(): StrategicFrictionIntervention | undefined {
    return this.activeIntervention;
  }

  /**
   * Check whether roadmap expansion is currently locked due to active intervention.
   */
  public isRoadmapExpansionLocked(): boolean {
    return (
      this.activeIntervention !== undefined &&
      this.activeIntervention.roadmapExpansionLocked === true
    );
  }

  /**
   * Get the current count of consecutive degraded epochs.
   */
  public getConsecutiveDegradedEpochs(): number {
    return this.consecutiveDegradedEpochs;
  }

  /**
   * Get history of resolved Strategic Friction Interventions.
   */
  public getInterventionHistory(): readonly StrategicFrictionIntervention[] {
    return [...this.interventionHistory];
  }

  /**
   * Reset engine state.
   */
  public reset(): void {
    this.consecutiveDegradedEpochs = 0;
    this.activeIntervention = undefined;
    this.interventionHistory = [];
    this.interventionCounter = 0;
  }
}

/**
 * Factory helper to create a new HealthScoringEngine instance.
 */
export function createHealthScoringEngine(
  config?: HealthScoringConfig | undefined,
): HealthScoringEngine {
  return new HealthScoringEngine(config);
}

/**
 * Format Strategic Friction Intervention details into a human-readable diagnostic report.
 */
export function formatInterventionSummary(intervention: StrategicFrictionIntervention): string {
  const lines = [
    `[STRATEGIC FRICTION INTERVENTION] ID: ${intervention.id}`,
    `  - Triggered at Epoch: ${intervention.triggeredAtEpoch} (Consecutive Degraded: ${intervention.consecutiveDegradedEpochs})`,
    `  - Health Score: ${intervention.healthScore.toFixed(4)}`,
    `  - Roadmap Expansion Locked: ${intervention.roadmapExpansionLocked ? "YES (LOCKED)" : "NO (UNLOCKED)"}`,
    `  - Resolved: ${intervention.resolvedAt !== null ? `Yes (Epoch ${intervention.resolvedAtEpoch ?? "N/A"})` : "NO (ACTIVE)"}`,
    `  - Root Causes:`,
    ...intervention.rootCauses.map((rc) => `      * ${rc}`),
    `  - Required Simplifications:`,
    ...intervention.requiredSimplifications.map((rs) => `      * ${rs}`),
  ];
  return lines.join("\n");
}

/**
 * Format HealthEvaluationResult into a readable summary string.
 */
export function formatHealthEvaluationSummary(result: HealthEvaluationResult): string {
  const lines = [
    `Health Evaluation Summary:`,
    `  - Health Score: ${result.compositeHealthScore.toFixed(4)} [${result.status.toUpperCase()}]`,
    `  - Consecutive Degraded Epochs: ${result.consecutiveDegradedEpochs}`,
    `  - Roadmap Expansion Locked: ${result.roadmapExpansionLocked ? "LOCKED" : "UNLOCKED"}`,
    `  - Intervention Triggered: ${result.interventionTriggered}`,
    `  - Intervention Resolved: ${result.interventionResolved}`,
    `  - Reasons:`,
    ...result.reasons.map((r) => `      * ${r}`),
  ];
  return lines.join("\n");
}
