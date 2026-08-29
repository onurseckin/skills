import type { JsonObject } from "../core/contracts/index.ts";
import type { DerivedTelemetryInput, TelemetryFieldConflict } from "../workflow/agents/grants.ts";
import { detectHostTelemetry, type HostTelemetryProbe } from "../summary/metrics/index.ts";
import { readAgentTranscriptTelemetry } from "../workflow/agents/transcript-telemetry.ts";

export function probeAgentTelemetry(agentId: string): DerivedTelemetryInput {
  const derived = toDerivedTelemetry(detectHostTelemetry(agentId));
  const transcript = readAgentTranscriptTelemetry(agentId);
  return transcript === null ? derived : { ...derived, transcript };
}

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
  const capabilities: JsonObject = {
    ...probe.capabilities,
    ...(probe.last_model_usage === undefined ? {} : { last_model_usage: probe.last_model_usage }),
  };
  return {
    hostTool: probe.host_tool,
    ...(probe.provider === undefined ? {} : { provider: probe.provider.value }),
    ...(probe.model === undefined ? {} : { model: probe.model.value }),
    ...(probe.thinking_level === undefined ? {} : { thinkingLevel: probe.thinking_level.value }),
    ...(probe.context_window === undefined ? {} : { contextWindow: probe.context_window.value }),
    ...(Object.keys(capabilities).length === 0 ? {} : { capabilities }),
  };
}
