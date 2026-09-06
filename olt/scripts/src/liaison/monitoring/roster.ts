import type { AgentIdentityInfo, AgentRoleType, SystemRosterMetrics } from "./types.ts";

/**
 * Assesses whether the ratio of lanes to distinct implementers indicates
 * serial execution masquerading as a parallel plan (forensics §2.9).
 */
export function detectSerialExecution(
  distinctImplementers: number,
  laneCount: number,
): {
  readonly isRisk: boolean;
  readonly warning: string | null;
  readonly ratio: number;
} {
  const normalizedLanes = Math.max(0, laneCount);
  const normalizedImplementers = Math.max(0, distinctImplementers);

  if (normalizedImplementers === 0) {
    if (normalizedLanes === 0) {
      return Object.freeze({
        isRisk: false,
        warning: null,
        ratio: 0,
      });
    }
    return Object.freeze({
      isRisk: true,
      warning: `Zero implementers active for ${normalizedLanes} active lane(s). Execution stalled.`,
      ratio: Infinity,
    });
  }

  const ratio = Number((normalizedLanes / normalizedImplementers).toFixed(2));

  if (normalizedLanes > 1 && normalizedImplementers === 1) {
    return Object.freeze({
      isRisk: true,
      warning: `Serial execution detected: single implementer serving ${normalizedLanes} lanes (ratio ${ratio}). Violates concurrency architecture (forensics §2.9).`,
      ratio,
    });
  }

  if (normalizedLanes > 1 && normalizedImplementers < normalizedLanes) {
    return Object.freeze({
      isRisk: true,
      warning: `Serial bottleneck: ${normalizedImplementers} distinct implementers for ${normalizedLanes} lanes (ratio ${ratio}). Concurrency compromised.`,
      ratio,
    });
  }

  return Object.freeze({
    isRisk: false,
    warning: null,
    ratio,
  });
}

/**
 * Computes active agents by identity and type, lane count vs distinct implementers,
 * and serial execution risk metrics.
 */
export function extractRosterMetrics(
  agents: readonly AgentIdentityInfo[],
  laneCount: number,
): SystemRosterMetrics {
  const immutableAgents = Object.freeze([...agents]);
  const implementers = immutableAgents.filter((a) => a.roleType === "implementer");

  const distinctImplementerSet = new Set<string>();
  for (const implementer of implementers) {
    distinctImplementerSet.add(implementer.agentId);
  }

  const distinctImplementerIdentities = Object.freeze(Array.from(distinctImplementerSet).sort());
  const distinctImplementers = distinctImplementerIdentities.length;
  const implementerCount = implementers.length;
  const normalizedLanes = Math.max(0, laneCount);

  const assessment = detectSerialExecution(distinctImplementers, normalizedLanes);

  return Object.freeze({
    activeAgents: immutableAgents,
    totalActiveAgents: immutableAgents.length,
    implementerCount,
    distinctImplementers,
    distinctImplementerIdentities,
    laneCount: normalizedLanes,
    lanesPerImplementerRatio: assessment.ratio,
    isSerialExecutionRisk: assessment.isRisk,
    serialExecutionWarning: assessment.warning,
  });
}

/**
 * Groups agents by their role type for structured roster visualization.
 */
export function groupAgentsByRole(
  agents: readonly AgentIdentityInfo[],
): Readonly<Record<AgentRoleType, readonly AgentIdentityInfo[]>> {
  const result: Record<AgentRoleType, AgentIdentityInfo[]> = {
    liaison: [],
    orchestrator: [],
    coordinator: [],
    implementer: [],
    validator: [],
    critic: [],
    auditor: [],
    unknown: [],
  };

  for (const agent of agents) {
    const bucket = result[agent.roleType];
    if (bucket !== undefined) {
      bucket.push(agent);
    } else {
      result.unknown.push(agent);
    }
  }

  return Object.freeze({
    liaison: Object.freeze(result.liaison),
    orchestrator: Object.freeze(result.orchestrator),
    coordinator: Object.freeze(result.coordinator),
    implementer: Object.freeze(result.implementer),
    validator: Object.freeze(result.validator),
    critic: Object.freeze(result.critic),
    auditor: Object.freeze(result.auditor),
    unknown: Object.freeze(result.unknown),
  });
}

/**
 * Counts agent distribution by role.
 */
export function countAgentsByRole(
  agents: readonly AgentIdentityInfo[],
): Readonly<Record<AgentRoleType, number>> {
  const grouped = groupAgentsByRole(agents);
  return Object.freeze({
    liaison: grouped.liaison.length,
    orchestrator: grouped.orchestrator.length,
    coordinator: grouped.coordinator.length,
    implementer: grouped.implementer.length,
    validator: grouped.validator.length,
    critic: grouped.critic.length,
    auditor: grouped.auditor.length,
    unknown: grouped.unknown.length,
  });
}
