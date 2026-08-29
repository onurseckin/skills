import type {
  HostSchedulerConfig,
  HostSchedulerId,
  ThinkingLevel,
} from "../mind/preplanning/types.ts";

export type { HostSchedulerConfig, HostSchedulerId, ThinkingLevel };

export const HOST_SCHEDULERS_MATRIX: Readonly<Record<HostSchedulerId, HostSchedulerConfig>> =
  Object.freeze({
    antigravity: Object.freeze({
      host_id: "antigravity",
      default_cadence_seconds: 300, // 5 minutes
      tier_0_2_model: "gemini-3.7-flash",
      tier_0_2_thinking: "high",
      tier_3_model: "gemini-3.7-flash",
      tier_3_thinking: "medium",
      max_single_task_seconds: 300, // 5 minutes SLA boundary
      heartbeat_tick_seconds: 60,
      watchdog_timeout_seconds: 300,
    }),
    claude_code: Object.freeze({
      host_id: "claude_code",
      default_cadence_seconds: 900, // 15 minutes
      tier_0_2_model: "claude-5-opus",
      tier_0_2_thinking: "high",
      tier_3_model: "claude-5-sonnet",
      tier_3_thinking: "medium",
      max_single_task_seconds: 300, // 5 minutes SLA boundary
      heartbeat_tick_seconds: 180,
      watchdog_timeout_seconds: 900,
    }),
    codex: Object.freeze({
      host_id: "codex",
      default_cadence_seconds: 900, // 15 minutes
      tier_0_2_model: "gpt-5.6-sol",
      tier_0_2_thinking: "high",
      tier_3_model: "gpt-5.6-terra",
      tier_3_thinking: "medium",
      max_single_task_seconds: 300, // 5 minutes SLA boundary
      heartbeat_tick_seconds: 180,
      watchdog_timeout_seconds: 900,
    }),
    cursor: Object.freeze({
      host_id: "cursor",
      default_cadence_seconds: 300, // 5 minutes
      tier_0_2_model: "cursor-latest",
      tier_0_2_thinking: "high",
      tier_3_model: "cursor-latest",
      tier_3_thinking: "medium",
      max_single_task_seconds: 300, // 5 minutes SLA boundary
      heartbeat_tick_seconds: 60,
      watchdog_timeout_seconds: 300,
    }),
  });

export function getHostSchedulerConfig(hostId: HostSchedulerId): HostSchedulerConfig {
  const config = HOST_SCHEDULERS_MATRIX[hostId];
  if (!config) {
    throw new Error(`Unknown host scheduler ID: ${hostId}`);
  }
  return config;
}

export function getAllHostSchedulers(): readonly HostSchedulerConfig[] {
  return Object.freeze(Object.values(HOST_SCHEDULERS_MATRIX));
}

export function isHighThinkingEnforced(config: HostSchedulerConfig): boolean {
  return (
    config.tier_0_2_thinking === "high" &&
    (config.tier_3_thinking === "medium" || config.tier_3_thinking === "high")
  );
}

export function assertHostThinkingPolicy(config: HostSchedulerConfig): void {
  if (config.tier_0_2_thinking !== "high") {
    throw new Error(
      `Host ${config.host_id} violates high thinking policy: Tier 0-2 expected "high", received "${config.tier_0_2_thinking}"`,
    );
  }
  if (config.tier_3_thinking !== "medium" && config.tier_3_thinking !== "high") {
    throw new Error(
      `Host ${config.host_id} violates thinking policy: Tier 3 expected "medium" or "high", received "${config.tier_3_thinking}"`,
    );
  }
}

export function validateHostSchedulerConfig(config: HostSchedulerConfig): {
  readonly isValid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  if (config.tier_0_2_thinking !== "high") {
    errors.push(`Tier 0-2 thinking must be "high", received "${config.tier_0_2_thinking}"`);
  }

  if (config.tier_3_thinking !== "medium" && config.tier_3_thinking !== "high") {
    errors.push(`Tier 3 thinking must be "medium" or "high", received "${config.tier_3_thinking}"`);
  }

  if (config.max_single_task_seconds > 300) {
    errors.push(
      `max_single_task_seconds must not exceed 300s (5 minutes SLA), received ${config.max_single_task_seconds}`,
    );
  }

  if (config.default_cadence_seconds <= 0) {
    errors.push(
      `default_cadence_seconds must be positive, received ${config.default_cadence_seconds}`,
    );
  }

  if (!config.tier_0_2_model || config.tier_0_2_model.trim() === "") {
    errors.push("tier_0_2_model must not be empty");
  }

  if (!config.tier_3_model || config.tier_3_model.trim() === "") {
    errors.push("tier_3_model must not be empty");
  }

  return {
    isValid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

export function resolveModelForTier(
  hostId: HostSchedulerId,
  tier: "tier_0_2" | "tier_3",
): { readonly model: string; readonly thinking: ThinkingLevel } {
  const config = getHostSchedulerConfig(hostId);
  assertHostThinkingPolicy(config);
  const model = tier === "tier_0_2" ? config.tier_0_2_model : config.tier_3_model;
  const thinking = tier === "tier_0_2" ? config.tier_0_2_thinking : config.tier_3_thinking;
  return {
    model,
    thinking,
  };
}
