import type { AgentModelTier, ThinkingLevel } from "../core/contracts/agents.ts";
import { evidenced, type Evidenced } from "../core/contracts/evidence.ts";
import type { AgentRole } from "../core/contracts/packets.ts";
import type { HostCapabilities } from "../summary/host-telemetry.ts";

export type AbstractProfile = "deliberate" | "default" | "adversarial" | "cheap_bulk";

export const ABSTRACT_PROFILES: readonly AbstractProfile[] = [
  "deliberate",
  "default",
  "adversarial",
  "cheap_bulk",
] as const;

const ABSTRACT_PROFILE_SET = new Set<string>(ABSTRACT_PROFILES);

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

export interface ProfileBinding {
  readonly model?: string;
  readonly model_tier?: AgentModelTier;
  readonly thinking_level?: ThinkingLevel;
  readonly effort?: string;
  readonly context_window?: number;
}

export type ProfileBindings = Partial<Record<AbstractProfile, ProfileBinding>>;

export interface ResolvedProfile {
  readonly profile: AbstractProfile;
  readonly bound: boolean;
  readonly model: string | "unknown";
  readonly model_tier: AgentModelTier | "unknown";
  readonly thinking_level: ThinkingLevel | "unknown";
  readonly effort?: string;
  readonly context_window?: number;
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

export interface AgentProfileResolution {
  readonly role: string;
  readonly profile: AbstractProfile | "unknown";
  readonly supportedOnHost: boolean;
  readonly limitation?: string;
  readonly model?: Evidenced<string>;
  readonly model_tier?: Evidenced<AgentModelTier>;
  readonly thinking_level?: Evidenced<ThinkingLevel>;
  readonly context_window?: Evidenced<number>;
  readonly telemetryRecords: Record<string, Evidenced<unknown>>;
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
