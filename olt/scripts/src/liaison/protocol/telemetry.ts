import type {
  AgentRoster,
  AgentTypeCounts,
  BrowserSessionMetrics,
  EvidenceArtefact,
  ExecutionTelemetry,
  TelemetryAnomaly,
} from "./types.ts";

export function computeAgentTypeCounts(roster: AgentRoster): AgentTypeCounts {
  const counts: Record<string, number> = {};
  for (const [agentType, agents] of Object.entries(roster)) {
    counts[agentType] = Array.isArray(agents) ? new Set(agents).size : 0;
  }
  return counts;
}

export function extractImplementerIds(roster: AgentRoster): readonly string[] {
  const implementers: string[] = [];
  for (const [role, agents] of Object.entries(roster)) {
    if (role.toLowerCase().includes("implementer") && Array.isArray(agents)) {
      for (const agent of agents) {
        if (typeof agent === "string" && !implementers.includes(agent)) {
          implementers.push(agent);
        }
      }
    }
  }
  return implementers;
}

export function computeDistinctImplementerCount(roster: AgentRoster): number {
  return extractImplementerIds(roster).length;
}

export function createExecutionTelemetry(params: {
  readonly run_id: string;
  readonly wave_id?: string;
  readonly distinct_agents_by_type: AgentRoster;
  readonly lane_count: number;
  readonly distinct_implementer_count?: number;
  readonly evidence_artefacts: readonly EvidenceArtefact[];
  readonly browser_sessions: BrowserSessionMetrics;
  readonly timestamp?: string;
}): ExecutionTelemetry {
  const implementerCount =
    params.distinct_implementer_count ??
    computeDistinctImplementerCount(params.distinct_agents_by_type);

  return {
    run_id: params.run_id,
    ...(params.wave_id !== undefined ? { wave_id: params.wave_id } : {}),
    timestamp: params.timestamp ?? new Date().toISOString(),
    distinct_agents_by_type: params.distinct_agents_by_type,
    lane_count: params.lane_count,
    distinct_implementer_count: implementerCount,
    evidence_artefacts: params.evidence_artefacts,
    browser_sessions: params.browser_sessions,
  };
}

export function isExecutionTelemetry(value: unknown): value is ExecutionTelemetry {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.run_id === "string" &&
    typeof t.timestamp === "string" &&
    typeof t.distinct_agents_by_type === "object" &&
    t.distinct_agents_by_type !== null &&
    typeof t.lane_count === "number" &&
    typeof t.distinct_implementer_count === "number" &&
    Array.isArray(t.evidence_artefacts) &&
    typeof t.browser_sessions === "object" &&
    t.browser_sessions !== null
  );
}

export function serializeTelemetry(telemetry: ExecutionTelemetry): string {
  return JSON.stringify(telemetry, null, 2);
}

export function parseTelemetry(serialized: string): ExecutionTelemetry {
  const parsed: unknown = JSON.parse(serialized);
  if (!isExecutionTelemetry(parsed)) {
    throw new Error("Invalid telemetry payload: does not conform to ExecutionTelemetry schema");
  }
  return parsed;
}

export function detectTelemetryAnomalies(
  telemetry: ExecutionTelemetry,
): readonly TelemetryAnomaly[] {
  const anomalies: TelemetryAnomaly[] = [];

  if (telemetry.lane_count < 0 || telemetry.distinct_implementer_count < 0) {
    anomalies.push({
      type: "INVALID_METRIC",
      severity: "ERROR",
      message: "Lane count or implementer count cannot be negative",
      details: {
        lane_count: telemetry.lane_count,
        distinct_implementer_count: telemetry.distinct_implementer_count,
      },
    });
  }

  if (
    telemetry.browser_sessions.opened < 0 ||
    telemetry.browser_sessions.closed < 0 ||
    telemetry.browser_sessions.active < 0
  ) {
    anomalies.push({
      type: "INVALID_METRIC",
      severity: "ERROR",
      message: "Browser session metrics cannot be negative",
      details: {
        opened: telemetry.browser_sessions.opened,
        closed: telemetry.browser_sessions.closed,
        active: telemetry.browser_sessions.active,
      },
    });
  }

  // Serial execution check: lane count > 1 while implementer count < lane count
  if (telemetry.lane_count > 1 && telemetry.distinct_implementer_count < telemetry.lane_count) {
    anomalies.push({
      type: "SERIAL_EXECUTION_DETECTED",
      severity: "ERROR",
      message: `Serial execution detected: ${telemetry.lane_count} lanes executed by only ${telemetry.distinct_implementer_count} distinct implementer(s)`,
      details: {
        lane_count: telemetry.lane_count,
        distinct_implementer_count: telemetry.distinct_implementer_count,
        deficit: telemetry.lane_count - telemetry.distinct_implementer_count,
      },
    });
  }

  // Browser session leak check: opened > closed
  if (telemetry.browser_sessions.opened > telemetry.browser_sessions.closed) {
    const unclosed = telemetry.browser_sessions.opened - telemetry.browser_sessions.closed;
    anomalies.push({
      type: "BROWSER_SESSION_LEAK",
      severity: "WARNING",
      message: `Browser session leak detected: ${unclosed} session(s) opened but not closed`,
      details: {
        opened: telemetry.browser_sessions.opened,
        closed: telemetry.browser_sessions.closed,
        active: telemetry.browser_sessions.active,
        unclosed,
      },
    });
  }

  // Empty evidence artefacts when lanes were executed
  if (telemetry.lane_count > 0 && telemetry.evidence_artefacts.length === 0) {
    anomalies.push({
      type: "EMPTY_EVIDENCE_ARTEFACTS",
      severity: "WARNING",
      message: "No evidence artefacts reported despite active lane execution",
      details: {
        lane_count: telemetry.lane_count,
      },
    });
  }

  return anomalies;
}

export function filterArtefactsByClass(
  telemetry: ExecutionTelemetry,
  artefactClass: string,
): readonly EvidenceArtefact[] {
  return telemetry.evidence_artefacts.filter(
    (a) => a.artefact_class.toLowerCase() === artefactClass.toLowerCase(),
  );
}

export function hasArtefactClass(telemetry: ExecutionTelemetry, artefactClass: string): boolean {
  return filterArtefactsByClass(telemetry, artefactClass).length > 0;
}

export function groupArtefactsByClass(
  telemetry: ExecutionTelemetry,
): Record<string, readonly EvidenceArtefact[]> {
  const groups: Record<string, EvidenceArtefact[]> = {};
  for (const artefact of telemetry.evidence_artefacts) {
    const key = artefact.artefact_class;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(artefact);
  }
  return groups;
}
