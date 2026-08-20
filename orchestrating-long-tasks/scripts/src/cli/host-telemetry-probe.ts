import type { JsonObject } from "../contracts/json.ts";
import type { DerivedTelemetryInput, TelemetryFieldConflict } from "../workflow/agents/grants.ts";
import { detectHostTelemetry, type HostTelemetryProbe } from "../summary/host-telemetry.ts";
import { readAgentTranscriptTelemetry } from "../workflow/agents/transcript-telemetry.ts";

/**
 * The hardcoded probe step shared by `agent:register`, `task:claim`, `task:submit` and
 * `agent:release`: read the host's own configuration AND the host's own transcript for this agent,
 * automatically, on every call — never a separate command, never a round-trip back to the agent for
 * telemetry it may not have (B32.3, B34). The two sources are independent: a machine can identify a
 * config-probed host while carrying no transcript evidence for this particular agent id, or the
 * reverse, so either one alone is enough to return something.
 */
export function probeAgentTelemetry(agentId: string): DerivedTelemetryInput {
  const derived = toDerivedTelemetry(detectHostTelemetry(agentId));
  const transcript = readAgentTranscriptTelemetry(agentId);
  return transcript === null ? derived : { ...derived, transcript };
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
  // Real recorded spend rides along inside the same open bag as the structural capabilities: it is
  // audit context about the host, not a per-agent grant field, exactly like `nesting_depth` above it.
  const capabilities: JsonObject = {
    ...probe.capabilities,
    ...(probe.last_model_usage === undefined ? {} : { last_model_usage: probe.last_model_usage }),
  };
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
