import type {
  DriftItem,
  OverallHealthStatus,
  SystemHealthSummary,
  SystemLivenessInfo,
  SystemObligationSummary,
  SystemRosterMetrics,
  SystemRunStateInfo,
} from "./types.ts";

/**
 * Evaluates the overall health of the system and answers directly:
 * "Is the system working well?" without event log parsing.
 */
export function evaluateSystemHealth(params: {
  readonly liveness: SystemLivenessInfo;
  readonly roster: SystemRosterMetrics;
  readonly obligations: SystemObligationSummary;
  readonly runState?: SystemRunStateInfo | null | undefined;
  readonly drift?: readonly DriftItem[] | undefined;
}): SystemHealthSummary {
  const { liveness, roster, obligations, runState, drift } = params;
  let score = 100;
  const reasons: string[] = [];
  const concerns: string[] = [];
  const recommendations: string[] = [];

  // 1. Liveness evaluation
  switch (liveness.status) {
    case "ALIVE":
      if (liveness.ageSeconds > liveness.declaredIntervalSeconds * 1.5) {
        score -= 10;
        concerns.push(
          `Heartbeat age (${liveness.ageSeconds}s) exceeds declared interval (${liveness.declaredIntervalSeconds}s).`,
        );
        recommendations.push("Inspect liaison daemon loop latency.");
      } else {
        reasons.push("Positive liveness asserted with healthy heartbeat.");
      }
      break;
    case "DEGRADED":
      score -= 20;
      concerns.push(
        `Liveness degraded: ${liveness.statusMessage || "Elevated heartbeat latency"}.`,
      );
      recommendations.push("Check host load and daemon resource limits.");
      break;
    case "UNREACHABLE":
      score -= 50;
      concerns.push(
        `Peer unreachable: missed ${liveness.consecutiveMissedBeats} consecutive beats (forensics §2.4).`,
      );
      recommendations.push("Restart peer liaison daemon out-of-band immediately.");
      break;
    case "FREEZE":
      score -= 15;
      concerns.push(`System in declared freeze: ${liveness.statusMessage}.`);
      recommendations.push("Wait for scheduled freeze window or quota reset.");
      break;
  }

  // 2. Roster and Concurrency evaluation
  if (roster.isSerialExecutionRisk) {
    if (roster.distinctImplementers === 1 && roster.laneCount > 1) {
      score -= 35;
      concerns.push(
        `Serial execution detected: single implementer serving ${roster.laneCount} lanes (forensics §2.9).`,
      );
      recommendations.push(
        "Deploy distinct implementer identities per lane to prevent serial masquerade.",
      );
    } else if (roster.distinctImplementers === 0 && roster.laneCount > 0) {
      score -= 30;
      concerns.push(`Zero implementers active for ${roster.laneCount} lane(s). Execution stalled.`);
      recommendations.push("Dispatch implementer agents to claim active lanes.");
    } else {
      score -= 15;
      concerns.push(
        `Serial bottleneck: ${roster.distinctImplementers} implementers for ${roster.laneCount} lanes (ratio ${roster.lanesPerImplementerRatio}).`,
      );
      recommendations.push("Increase implementer concurrency ratio.");
    }
  } else {
    reasons.push(
      `Concurrency healthy: ${roster.distinctImplementers} distinct implementer(s) across ${roster.laneCount} lane(s).`,
    );
  }

  // 3. Obligations evaluation
  if (obligations.overdueCount > 0) {
    const deduction = Math.min(40, obligations.overdueCount * 15);
    score -= deduction;
    concerns.push(
      `${obligations.overdueCount} open obligation(s) overdue without Phase-2 binding (protocol.md §2.2).`,
    );
    recommendations.push(
      "Inspect recipient write scope bindings or emit explicit Phase-2 refusals.",
    );
  } else if (obligations.totalObligations > 0) {
    reasons.push(
      `All ${obligations.totalObligations} obligation(s) resolved or within delivery window.`,
    );
  }

  if (obligations.refusedCount > 0) {
    reasons.push(
      `${obligations.refusedCount} obligation(s) resolved with explicit Phase-2 refusal (protocol.md §2).`,
    );
  }

  // 4. Drift & Ratchet evaluation
  if (drift && drift.length > 0) {
    let unabsorbedRegressions = 0;
    for (const item of drift) {
      if (item.isRegression && !item.absorbedRegressionAllowed) {
        unabsorbedRegressions++;
        concerns.push(
          `Unabsorbed ratchet regression on "${item.metricName}" (delta: ${item.delta}).`,
        );
      }
    }
    if (unabsorbedRegressions > 0) {
      score -= Math.min(30, unabsorbedRegressions * 15);
      recommendations.push("Resolve ratchet metric regressions before phase sealing.");
    } else {
      reasons.push("Ratchet metrics preserved with zero unabsorbed regressions.");
    }
  }

  // 5. Run state evaluation
  if (runState) {
    if (runState.unclaimedReadyLanes.length > 0) {
      score -= 5;
      concerns.push(
        `${runState.unclaimedReadyLanes.length} ready lane(s) unclaimed: ${runState.unclaimedReadyLanes.join(", ")}.`,
      );
      recommendations.push("Claim available ready lanes.");
    }
  }

  const healthScore = Math.max(0, Math.min(100, score));

  let status: OverallHealthStatus;
  if (healthScore >= 85) {
    status = "HEALTHY";
  } else if (healthScore >= 60) {
    status = "DEGRADED";
  } else if (healthScore >= 35) {
    status = "UNHEALTHY";
  } else {
    status = "CRITICAL";
  }

  const isWorkingWell =
    status === "HEALTHY" &&
    !roster.isSerialExecutionRisk &&
    obligations.overdueCount === 0 &&
    liveness.status === "ALIVE";

  return Object.freeze({
    status,
    healthScore,
    reasons: Object.freeze(reasons),
    concerns: Object.freeze(concerns),
    recommendations: Object.freeze(recommendations),
    isWorkingWell,
  });
}
