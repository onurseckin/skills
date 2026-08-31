import {
  DEFAULT_ALLOWED_ORCHESTRATOR_EVENTS,
  DEFAULT_COMPLETION_AUDIO_COOLDOWN_MS,
  DEFAULT_ORCHESTRATOR_TIERS,
  DEFAULT_SUBAGENT_ROLES,
  DEFAULT_SUPPRESSED_SUBAGENT_EVENTS,
} from "./constants.ts";
import type {
  CompletionAudioConfig,
  CompletionAudioContext,
  CompletionAudioEvaluationInput,
  CompletionDecision,
} from "./types.ts";

export function isOrchestratorTier(
  roleOrTier?: string | undefined,
  allowedTiers: readonly string[] = DEFAULT_ORCHESTRATOR_TIERS,
): boolean {
  if (!roleOrTier || typeof roleOrTier !== "string") {
    return false;
  }
  const normalized = roleOrTier.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return allowedTiers.some((tier) => {
    const t = tier.toLowerCase();
    return normalized === t || normalized.startsWith(`${t}_`) || normalized.startsWith(`${t}-`);
  });
}

export function isSubagentRole(
  roleOrActor?: string | undefined,
  suppressedRoles: readonly string[] = DEFAULT_SUBAGENT_ROLES,
): boolean {
  if (!roleOrActor || typeof roleOrActor !== "string") {
    return false;
  }
  const normalized = roleOrActor.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return suppressedRoles.some((role) => {
    const r = role.toLowerCase();
    return normalized === r || normalized.startsWith(`${r}_`) || normalized.startsWith(`${r}-`);
  });
}

export function isSubagentNoise(
  event: string,
  context?: CompletionAudioContext | undefined,
  config?: CompletionAudioConfig | undefined,
): boolean {
  const suppressedEvents = config?.suppressedEvents ?? DEFAULT_SUPPRESSED_SUBAGENT_EVENTS;
  const normalizedEvent = event.trim().toLowerCase();

  if (suppressedEvents.some((se) => se.toLowerCase() === normalizedEvent)) {
    return true;
  }

  if (
    normalizedEvent.startsWith("task:") ||
    normalizedEvent.startsWith("gate:") ||
    normalizedEvent.startsWith("critic:") ||
    normalizedEvent.startsWith("probe:") ||
    normalizedEvent.startsWith("repair:") ||
    normalizedEvent.startsWith("subagent:") ||
    normalizedEvent.startsWith("mind:")
  ) {
    return true;
  }

  if (context && context.taskId && !isOrchestratorTier(context.tier ?? context.role)) {
    return true;
  }

  return false;
}

export function evaluateCompletionAudio(
  input: CompletionAudioEvaluationInput,
  config?: CompletionAudioConfig | undefined,
  lastPlayedAt = 0,
  now: number = Date.now(),
): CompletionDecision {
  const enabled = config?.enabled ?? true;
  if (!enabled) {
    return { shouldPlay: false, reason: "disabled" };
  }

  const platform = config?.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux" && !config?.command && !config?.commandArgv) {
    return { shouldPlay: false, reason: "platform_unsupported" };
  }

  const subagentFilterEnabled = config?.subagentFilterEnabled ?? true;
  const allowedEvents = config?.allowedEvents ?? DEFAULT_ALLOWED_ORCHESTRATOR_EVENTS;
  const allowedTiers = config?.allowedTiers ?? DEFAULT_ORCHESTRATOR_TIERS;
  const cooldownMs = config?.cooldownMs ?? DEFAULT_COMPLETION_AUDIO_COOLDOWN_MS;

  const context: CompletionAudioContext = {
    actor: input.actor,
    role: input.role,
    tier: input.tier,
    runId: input.runId,
    taskId: input.taskId,
  };

  if (subagentFilterEnabled) {
    if (isSubagentNoise(input.event, context, config)) {
      return { shouldPlay: false, reason: "subagent_noise_filtered" };
    }

    if (
      (input.role &&
        isSubagentRole(input.role, config?.suppressedRoles ?? DEFAULT_SUBAGENT_ROLES)) ||
      (input.actor &&
        isSubagentRole(input.actor, config?.suppressedRoles ?? DEFAULT_SUBAGENT_ROLES))
    ) {
      return { shouldPlay: false, reason: "role_suppressed" };
    }
  }

  const normalizedEvent = input.event.trim().toLowerCase();
  const isAllowedEvent = allowedEvents.some((ae) => {
    const normAe = ae.toLowerCase();
    if (normAe === "*" || normAe === normalizedEvent) {
      return true;
    }
    if (normAe.endsWith(":*")) {
      const prefix = normAe.slice(0, -2);
      return normalizedEvent.startsWith(`${prefix}:`);
    }
    if (normAe.startsWith("*:") && normalizedEvent.endsWith(normAe.slice(1))) {
      return true;
    }
    return false;
  });

  if (!isAllowedEvent) {
    return { shouldPlay: false, reason: "unsupported_event" };
  }

  const effectiveTier = input.tier ?? input.role;
  if (effectiveTier && !isOrchestratorTier(effectiveTier, allowedTiers)) {
    return { shouldPlay: false, reason: "subagent_noise_filtered" };
  }

  if (lastPlayedAt > 0 && cooldownMs > 0) {
    const elapsed = now - lastPlayedAt;
    if (elapsed < cooldownMs) {
      return {
        shouldPlay: false,
        reason: "cooldown_throttled",
        cooldownRemainingMs: cooldownMs - elapsed,
      };
    }
  }

  return {
    shouldPlay: true,
    reason: "orchestrator_tier_allowed",
    matchedEvent: input.event,
  };
}

export function filterCompletionAudioEvents(
  events: readonly CompletionAudioEvaluationInput[],
  config?: CompletionAudioConfig | undefined,
): readonly CompletionAudioEvaluationInput[] {
  return events.filter((e) => {
    const decision = evaluateCompletionAudio(e, config);
    return decision.shouldPlay;
  });
}
