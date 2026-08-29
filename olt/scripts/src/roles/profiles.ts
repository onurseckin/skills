import type {
  AgentModelTier,
  AgentRole,
  Evidenced,
  ThinkingLevel,
} from "../core/contracts/index.ts";
import { evidenced } from "../core/contracts/index.ts";
import type { HostCapabilities } from "../summary/metrics/index.ts";
import type {
  AbstractProfile,
  AgentProfileResolution,
  ProfileBindings,
  ResolvedProfile,
} from "./types.ts";

export const ABSTRACT_PROFILES: readonly AbstractProfile[] = [
  "deliberate",
  "default",
  "adversarial",
  "cheap_bulk",
] as const;

export const ABSTRACT_PROFILE_SET = new Set<string>(ABSTRACT_PROFILES);

export function isAbstractProfile(value: unknown): value is AbstractProfile {
  return typeof value === "string" && ABSTRACT_PROFILE_SET.has(value);
}

export const ROLE_PROFILE_MAP: Readonly<Record<string, AbstractProfile>> = {
  mind: "deliberate",
  orchestrator: "deliberate",
  coordinator: "default",
  planner: "deliberate",
  implementer: "default",
  repairer: "default",
  "sub-implementer": "default",
  validator: "adversarial",
  critic: "adversarial",
  "completeness-critic": "adversarial",
  "plan-validator": "adversarial",
  "sub-validator": "adversarial",
  "sub-investigator": "cheap_bulk",
};

export function roleToProfile(role: string | AgentRole): AbstractProfile | undefined {
  return ROLE_PROFILE_MAP[role];
}

export function resolveRoleArchetype(roleName: string): AbstractProfile {
  const mapped = ROLE_PROFILE_MAP[roleName];
  if (mapped !== undefined) {
    return mapped;
  }
  const lower = roleName.toLowerCase();
  if (lower.startsWith("validator") || lower.includes("validator") || lower.includes("critic")) {
    return "adversarial";
  }
  if (lower.includes("investigator")) {
    return "cheap_bulk";
  }
  if (lower.includes("mind") || lower.includes("orchestrator") || lower.includes("planner")) {
    return "deliberate";
  }
  return "default";
}

export function resolveProfile(
  profile: AbstractProfile,
  bindings?: ProfileBindings,
): ResolvedProfile {
  const binding = bindings?.[profile];
  if (!binding) {
    return {
      profile,
      bound: false,
      model: "unknown",
      model_tier: "unknown",
      thinking_level: "unknown",
    };
  }

  const model = binding.model?.trim();
  const modelTier = binding.model_tier;
  const thinkingLevel = binding.thinking_level;

  const isBound =
    (model !== undefined && model.length > 0) ||
    modelTier !== undefined ||
    thinkingLevel !== undefined ||
    binding.effort !== undefined ||
    binding.context_window !== undefined;

  return {
    profile,
    bound: isBound,
    model: model && model.length > 0 ? model : "unknown",
    model_tier: modelTier ?? "unknown",
    thinking_level: thinkingLevel ?? "unknown",
    ...(binding.effort !== undefined ? { effort: binding.effort } : {}),
    ...(binding.context_window !== undefined ? { context_window: binding.context_window } : {}),
  };
}

export function formatHostDegradation(host: string): string {
  return `per-agent model selection unavailable on ${host}`;
}

export function isPerAgentModelSelectionSupported(hostCapabilities?: HostCapabilities): boolean {
  return hostCapabilities?.per_agent_model_selection?.value === true;
}

export function resolveAgentProfile(
  role: string,
  host: string,
  hostCapabilities?: HostCapabilities,
  bindings?: ProfileBindings,
): AgentProfileResolution {
  const profile = roleToProfile(role);
  const supported = isPerAgentModelSelectionSupported(hostCapabilities);

  if (!profile) {
    return {
      role,
      profile: "unknown",
      supportedOnHost: supported,
      ...(supported ? {} : { limitation: formatHostDegradation(host) }),
      telemetryRecords: {},
    };
  }

  if (!supported) {
    return {
      role,
      profile,
      supportedOnHost: false,
      limitation: formatHostDegradation(host),
      telemetryRecords: {},
    };
  }

  const resolved = resolveProfile(profile, bindings);
  const telemetryRecords: Record<string, Evidenced<unknown>> = {};

  let evidencedModel: Evidenced<string> | undefined;
  if (resolved.model !== "unknown") {
    evidencedModel = evidenced(resolved.model, "agent_reported");
    telemetryRecords.model = evidencedModel;
  }

  let evidencedTier: Evidenced<AgentModelTier> | undefined;
  if (resolved.model_tier !== "unknown") {
    evidencedTier = evidenced(resolved.model_tier, "agent_reported");
    telemetryRecords.model_tier = evidencedTier;
  }

  let evidencedThinking: Evidenced<ThinkingLevel> | undefined;
  if (resolved.thinking_level !== "unknown") {
    evidencedThinking = evidenced(resolved.thinking_level, "agent_reported");
    telemetryRecords.thinking_level = evidencedThinking;
  }

  let evidencedContext: Evidenced<number> | undefined;
  if (resolved.context_window !== undefined) {
    evidencedContext = evidenced(resolved.context_window, "agent_reported");
    telemetryRecords.context_window = evidencedContext;
  }

  return {
    role,
    profile,
    supportedOnHost: true,
    ...(evidencedModel !== undefined ? { model: evidencedModel } : {}),
    ...(evidencedTier !== undefined ? { model_tier: evidencedTier } : {}),
    ...(evidencedThinking !== undefined ? { thinking_level: evidencedThinking } : {}),
    ...(evidencedContext !== undefined ? { context_window: evidencedContext } : {}),
    telemetryRecords,
  };
}
