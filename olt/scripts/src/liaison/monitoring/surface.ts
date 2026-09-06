import { evaluateSystemHealth } from "./health.ts";
import {
  evaluateObligation,
  summarizeObligations,
  type ObligationEvaluationInput,
} from "./obligations.ts";
import { extractRosterMetrics } from "./roster.ts";
import type {
  AgentIdentityInfo,
  DriftItem,
  MonitoringSnapshot,
  ObligationDirective,
  RenderOptions,
  SharedMetricItem,
  SystemHealthSummary,
  SystemLivenessInfo,
  SystemObligationSummary,
  SystemRosterMetrics,
  SystemRunStateInfo,
} from "./types.ts";

export interface MonitoringSurfaceInput {
  readonly systemId: string;
  readonly peerSystemId?: string | undefined;
  readonly liveness: SystemLivenessInfo;
  readonly roster: SystemRosterMetrics;
  readonly obligations: SystemObligationSummary;
  readonly runState?: SystemRunStateInfo | null | undefined;
  readonly sharedMetrics?: readonly SharedMetricItem[] | undefined;
  readonly drift?: readonly DriftItem[] | undefined;
}

export interface RawMonitoringDataInput {
  readonly systemId: string;
  readonly peerSystemId?: string | undefined;
  readonly liveness: SystemLivenessInfo;
  readonly agents: readonly AgentIdentityInfo[];
  readonly laneCount: number;
  readonly obligations: readonly (
    | ObligationEvaluationInput
    | { readonly directive: ObligationDirective }
  )[];
  readonly runState?: SystemRunStateInfo | null | undefined;
  readonly sharedMetrics?: readonly SharedMetricItem[] | undefined;
  readonly drift?: readonly DriftItem[] | undefined;
}

/**
 * Builds an immutable MonitoringSnapshot from aggregated surface inputs.
 */
export function buildMonitoringSnapshot(
  input: MonitoringSurfaceInput,
  nowInput?: string | Date | undefined,
): MonitoringSnapshot {
  const timestamp =
    nowInput instanceof Date
      ? nowInput.toISOString()
      : typeof nowInput === "string"
        ? nowInput
        : new Date().toISOString();

  const sharedMetrics = Object.freeze([...(input.sharedMetrics ?? [])]);
  const drift = Object.freeze([...(input.drift ?? [])]);

  const health = evaluateSystemHealth({
    liveness: input.liveness,
    roster: input.roster,
    obligations: input.obligations,
    runState: input.runState,
    drift,
  });

  const snapshot: MonitoringSnapshot = {
    snapshotId: `snap_${input.systemId}_${Date.now()}`,
    timestamp,
    systemId: input.systemId,
    peerSystemId: input.peerSystemId,
    liveness: Object.freeze({ ...input.liveness }),
    roster: input.roster,
    obligations: input.obligations,
    runState: input.runState ? Object.freeze({ ...input.runState }) : null,
    sharedMetrics,
    drift,
    health,
  };

  return Object.freeze(snapshot);
}

/**
 * Builds an immutable MonitoringSnapshot directly from raw data arrays.
 */
export function buildMonitoringSnapshotFromRaw(
  input: RawMonitoringDataInput,
  nowInput?: string | Date | undefined,
): MonitoringSnapshot {
  const roster = extractRosterMetrics(input.agents, input.laneCount);
  const evaluatedObligations = input.obligations.map((item) => evaluateObligation(item, nowInput));
  const obligationSummary = summarizeObligations(evaluatedObligations);

  return buildMonitoringSnapshot(
    {
      systemId: input.systemId,
      peerSystemId: input.peerSystemId,
      liveness: input.liveness,
      roster,
      obligations: obligationSummary,
      runState: input.runState,
      sharedMetrics: input.sharedMetrics,
      drift: input.drift,
    },
    nowInput,
  );
}

/**
 * Read-only monitoring surface client class.
 */
export class MonitoringSurface {
  public constructor(public readonly defaultOptions?: Readonly<RenderOptions>) {}

  public getSnapshot(
    input: MonitoringSurfaceInput,
    now?: string | Date | undefined,
  ): MonitoringSnapshot {
    return buildMonitoringSnapshot(input, now);
  }

  public getSnapshotFromRaw(
    input: RawMonitoringDataInput,
    now?: string | Date | undefined,
  ): MonitoringSnapshot {
    return buildMonitoringSnapshotFromRaw(input, now);
  }

  public evaluateHealth(params: {
    readonly liveness: SystemLivenessInfo;
    readonly roster: SystemRosterMetrics;
    readonly obligations: SystemObligationSummary;
    readonly runState?: SystemRunStateInfo | null | undefined;
    readonly drift?: readonly DriftItem[] | undefined;
  }): SystemHealthSummary {
    return evaluateSystemHealth(params);
  }
}
