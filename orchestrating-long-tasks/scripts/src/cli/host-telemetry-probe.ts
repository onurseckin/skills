import type { DerivedTelemetryInput, TelemetryFieldConflict } from "../workflow/agents/grants.ts";
import { detectHostTelemetry, type HostTelemetryProbe } from "../summary/host-telemetry.ts";

/**
 * The hardcoded probe step shared by `agent:register`, `task:claim`, `task:submit` and
 * `agent:release`: read the host's own configuration for this agent, automatically, on every call —
 * never a separate command, never a round-trip back to the agent for telemetry it may not have.
 */
export function probeAgentTelemetry(agentId: string): DerivedTelemetryInput {
  return toDerivedTelemetry(detectHostTelemetry(agentId));
}

/** Attaches the probe's conflicts to a command's result only when there is one to report. */
export function withHostTelemetryConflicts(
  result: Record<string, unknown>,
  conflicts: readonly TelemetryFieldConflict[] | undefined,
): Record<string, unknown> {
  return conflicts === undefined || conflicts.length === 0
    ? result
    : { ...result, host_telemetry_conflicts: conflicts };
}

function toDerivedTelemetry(probe: HostTelemetryProbe | null): DerivedTelemetryInput {
  if (probe === null) return {};
  const capabilities = probe.capabilities;
  return {
    // Which runtime the capabilities were read off, carried so the record never lets them be read
    // as facts about the host the dispatcher declared: this machine can carry evidence of a
    // different one, and the two are recorded side by side rather than conflated.
    hostTool: probe.host_tool,
    ...(probe.provider === undefined ? {} : { provider: probe.provider.value }),
    ...(probe.model === undefined ? {} : { model: probe.model.value }),
    ...(probe.thinking_level === undefined ? {} : { thinkingLevel: probe.thinking_level.value }),
    ...(probe.context_window === undefined ? {} : { contextWindow: probe.context_window.value }),
    ...(Object.keys(capabilities).length === 0 ? {} : { capabilities }),
  };
}
