import type {
  EpochMeshState,
  EpochMeshSyncResult,
  HealthScoreMetrics,
  TelemetryTrackAlphaState,
  TelemetryTrackBetaState,
} from "./types.ts";
import { ALPHA_DEFAULT_CADENCE_MS, BETA_DEFAULT_CADENCE_MS } from "./types.ts";

export function computeExecutionHealthScore(metrics: HealthScoreMetrics): number {
  let score = 100;
  score -= Math.min(metrics.toolErrors * 15, 60);

  if (metrics.stagnationSeconds > 300) {
    const excessMinutes = Math.floor((metrics.stagnationSeconds - 300) / 60);
    score -= Math.min(excessMinutes * 10, 40);
  }

  if (metrics.memorySupersessionDepth > 5) {
    score -= Math.min((metrics.memorySupersessionDepth - 5) * 5, 20);
  }

  if (metrics.leaseUtilizationRatio > 0.85) {
    score -= 15;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function createTrackAlphaState(
  agentId: string,
  customCadenceMs = ALPHA_DEFAULT_CADENCE_MS,
): TelemetryTrackAlphaState {
  return {
    agentId,
    lastHeartbeat: Date.now(),
    cadenceMs: customCadenceMs,
    healthScore: 100,
    memorySupersessionDepth: 0,
    memorySnapshots: [],
    stagnationRisk: "nominal",
  };
}

export function recordAlphaHeartbeat(
  state: TelemetryTrackAlphaState,
  snapshot?: { id: string; summary: string },
  metrics?: Partial<HealthScoreMetrics>,
): TelemetryTrackAlphaState {
  const now = Date.now();
  const timeSinceLast = (now - state.lastHeartbeat) / 1000;

  const toolErrors = metrics?.toolErrors ?? 0;
  const stagnationSeconds = metrics?.stagnationSeconds ?? timeSinceLast;
  const leaseUtilizationRatio = metrics?.leaseUtilizationRatio ?? 0.2;

  const nextSnapshots = snapshot
    ? [...state.memorySnapshots, { id: snapshot.id, timestamp: now, summary: snapshot.summary }]
    : state.memorySnapshots;

  const nextDepth = nextSnapshots.length;

  const healthScore = computeExecutionHealthScore({
    toolErrors,
    stagnationSeconds,
    memorySupersessionDepth: nextDepth,
    leaseUtilizationRatio,
  });

  let stagnationRisk: "nominal" | "warning" | "critical" = "nominal";
  if (healthScore < 40 || stagnationSeconds > 600) stagnationRisk = "critical";
  else if (healthScore < 70 || stagnationSeconds > 300) stagnationRisk = "warning";

  return {
    ...state,
    lastHeartbeat: now,
    healthScore,
    memorySupersessionDepth: nextDepth,
    memorySnapshots: nextSnapshots,
    stagnationRisk,
  };
}

export function createTrackBetaState(
  epochId: string,
  customCadenceMs = BETA_DEFAULT_CADENCE_MS,
  maxRounds = 5,
): TelemetryTrackBetaState {
  return {
    epochId,
    round: 1,
    maxRounds,
    cadenceMs: customCadenceMs,
    convergenceScore: 0.0,
    strategicAnchors: [],
    status: "deliberating",
  };
}

export function recordBetaRound(
  state: TelemetryTrackBetaState,
  roundMetrics: {
    convergenceScore: number;
    newAnchor?: string;
  },
): TelemetryTrackBetaState {
  const nextRound = state.round + 1;
  const nextAnchors = roundMetrics.newAnchor
    ? [...state.strategicAnchors, roundMetrics.newAnchor]
    : state.strategicAnchors;

  let status: TelemetryTrackBetaState["status"] = "deliberating";
  if (roundMetrics.convergenceScore >= 0.85) {
    status = "converged";
  } else if (nextRound > state.maxRounds) {
    status = "re_anchoring";
  }

  return {
    ...state,
    round: nextRound,
    convergenceScore: roundMetrics.convergenceScore,
    strategicAnchors: nextAnchors,
    status,
  };
}

export function createEpochMesh(epochId: string): EpochMeshState {
  return {
    epochId,
    currentRound: 1,
    activeAlphaAgents: [],
    globalHealthScore: 100,
    isSynchronized: true,
    lastMeshSyncAt: Date.now(),
  };
}

export function advanceEpoch(
  meshState: EpochMeshState,
  updates?: Partial<EpochMeshState>,
): EpochMeshState {
  return {
    ...meshState,
    ...updates,
    currentRound: (updates?.currentRound ?? meshState.currentRound) + 1,
    lastMeshSyncAt: Date.now(),
  };
}

export function syncTrackAlphaAndBeta(
  meshState: EpochMeshState,
  alphaStates: readonly TelemetryTrackAlphaState[],
  betaState: TelemetryTrackBetaState,
): EpochMeshSyncResult {
  const activeCount = alphaStates.length;
  const totalHealth = alphaStates.reduce((acc, a) => acc + a.healthScore, 0);
  const averageHealthScore = activeCount > 0 ? Math.round(totalHealth / activeCount) : 100;
  const isConverged = betaState.status === "converged" || betaState.convergenceScore >= 0.85;

  const nextMeshState: EpochMeshState = {
    ...meshState,
    currentRound: betaState.round,
    activeAlphaAgents: alphaStates.map((a) => a.agentId),
    globalHealthScore: averageHealthScore,
    isSynchronized: true,
    lastMeshSyncAt: Date.now(),
  };

  return {
    nextMeshState,
    converged: isConverged,
    activeAlphaCount: activeCount,
    averageHealthScore,
  };
}
