import { spawnSync } from "node:child_process";
import { DEFAULT_DARWIN_AUDIO_COMMAND, DEFAULT_DARWIN_SOUND_PATH } from "../hooks/config.ts";
import { resolveAudioSoundPath } from "../hooks/dispatcher.ts";

/**
 * Standard known orchestrator tiers and roles that are permitted to trigger completion audio.
 */
export const DEFAULT_ORCHESTRATOR_TIERS: readonly string[] = Object.freeze([
  "orchestrator",
  "root",
  "supervisor",
  "coordinator",
  "run-supervisor",
  "parent",
]);

/**
 * Known subagent roles that must be filtered out as noise.
 */
export const DEFAULT_SUBAGENT_ROLES: readonly string[] = Object.freeze([
  "implementer",
  "validator",
  "mechanic",
  "critic",
  "probe",
  "subagent",
  "worker",
  "mechanic-validator",
  "quality-validator",
  "domain-mechanic",
]);

/**
 * Events permitted to trigger orchestrator completion audio chime.
 */
export const DEFAULT_ALLOWED_ORCHESTRATOR_EVENTS: readonly string[] = Object.freeze([
  "orchestrator:complete",
  "orchestrator:converged",
  "orchestrator:success",
  "orchestrator:fail",
  "run:complete",
  "run:fail",
  "loop:complete",
  "loop:converged",
  "supervision:complete",
  "multi-capsule:complete",
]);

/**
 * Subagent-level events that should be suppressed by anti-noise filter.
 */
export const DEFAULT_SUPPRESSED_SUBAGENT_EVENTS: readonly string[] = Object.freeze([
  "task:start",
  "task:review",
  "task:complete",
  "task:fail",
  "task:heartbeat",
  "task:claim",
  "task:submit",
  "task:reclaim",
  "critic:start",
  "critic:approve",
  "critic:reject",
  "probe:start",
  "probe:pass",
  "probe:fail",
  "gate:start",
  "gate:pass",
  "gate:fail",
  "repair:start",
  "repair:complete",
  "repair:fail",
  "subagent:start",
  "subagent:complete",
  "subagent:heartbeat",
  "mind:pulse",
  "mind:pulse-open",
]);

export const DEFAULT_COMPLETION_AUDIO_COOLDOWN_MS = 3000;

export interface CompletionAudioConfig {
  readonly enabled?: boolean | undefined;
  readonly sound?: string | undefined;
  readonly soundFile?: string | undefined;
  readonly command?: string | undefined;
  readonly cooldownMs?: number | undefined;
  readonly allowedTiers?: readonly string[] | undefined;
  readonly allowedEvents?: readonly string[] | undefined;
  readonly suppressedRoles?: readonly string[] | undefined;
  readonly suppressedEvents?: readonly string[] | undefined;
  readonly subagentFilterEnabled?: boolean | undefined;
  readonly silent?: boolean | undefined;
  readonly volume?: number | undefined;
  readonly platform?: string | undefined;
}

export interface CompletionAudioContext {
  readonly actor?: string | undefined;
  readonly role?: string | undefined;
  readonly tier?: string | undefined;
  readonly runId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly status?: string | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface CompletionAudioEvaluationInput {
  readonly event: string;
  readonly actor?: string | undefined;
  readonly role?: string | undefined;
  readonly tier?: string | undefined;
  readonly runId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly timestamp?: number | undefined;
}

export type CompletionDecisionReason =
  | "orchestrator_tier_allowed"
  | "subagent_noise_filtered"
  | "disabled"
  | "unsupported_event"
  | "cooldown_throttled"
  | "platform_unsupported"
  | "role_suppressed"
  | "event_suppressed";

export interface CompletionDecision {
  readonly shouldPlay: boolean;
  readonly reason: CompletionDecisionReason;
  readonly matchedEvent?: string | undefined;
  readonly cooldownRemainingMs?: number | undefined;
}

export interface CompletionAudioPlayResult {
  readonly played: boolean;
  readonly event: string;
  readonly sound?: string | undefined;
  readonly command?: string | undefined;
  readonly reason?: CompletionDecisionReason | undefined;
  readonly durationMs?: number | undefined;
  readonly output?: string | undefined;
  readonly error?: string | undefined;
}

/**
 * Checks whether a given role or tier is an orchestrator-level authority.
 */
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

/**
 * Checks whether a given role or actor string matches a subagent pattern.
 */
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

/**
 * Determines whether an event or event context represents subagent noise.
 */
export function isSubagentNoise(
  event: string,
  context?: CompletionAudioContext | undefined,
  config?: CompletionAudioConfig | undefined,
): boolean {
  const suppressedEvents = config?.suppressedEvents ?? DEFAULT_SUPPRESSED_SUBAGENT_EVENTS;
  const suppressedRoles = config?.suppressedRoles ?? DEFAULT_SUBAGENT_ROLES;

  const normalizedEvent = event.trim().toLowerCase();

  // If the event itself is an explicitly suppressed subagent event
  if (suppressedEvents.some((se) => se.toLowerCase() === normalizedEvent)) {
    return true;
  }

  // Namespace pattern checks for subagent events
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

  if (context) {
    // If context explicitly belongs to an individual task and not an orchestrator tier
    if (context.taskId && !isOrchestratorTier(context.tier ?? context.role)) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether an audio chime should be played for an event.
 */
export function evaluateCompletionAudio(
  input: CompletionAudioEvaluationInput,
  config?: CompletionAudioConfig | undefined,
  lastPlayedAt: number = 0,
  now: number = Date.now(),
): CompletionDecision {
  const enabled = config?.enabled ?? true;
  if (!enabled) {
    return { shouldPlay: false, reason: "disabled" };
  }

  const platform = config?.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux" && !config?.command) {
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

  // Subagent Anti-Noise Filter check
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

  // Check event allowance
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

  // Tier validation if tier or role is supplied
  const effectiveTier = input.tier ?? input.role;
  if (effectiveTier && !isOrchestratorTier(effectiveTier, allowedTiers)) {
    return { shouldPlay: false, reason: "subagent_noise_filtered" };
  }

  // Anti-Spam Rate Limiting / Cooldown Throttle
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

export interface SoundExecutionOptions {
  readonly sound?: string | undefined;
  readonly file?: string | undefined;
  readonly command?: string | undefined;
  readonly platform?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly silent?: boolean | undefined;
}

/**
 * Safely plays the completion audio sound across platforms.
 */
export function playCompletionAudioSync(options?: SoundExecutionOptions | undefined): {
  success: boolean;
  command: string;
  output?: string;
  error?: string;
} {
  const platform = options?.platform ?? process.platform;
  const timeoutMs = options?.timeoutMs ?? 5000;
  const silent = options?.silent ?? false;

  let command = options?.command;
  let soundPath = options?.file;

  if (!command) {
    if (platform === "darwin") {
      soundPath = resolveAudioSoundPath(options?.sound ?? "Bottle", options?.file);
      command = `afplay "${soundPath}"`;
    } else if (platform === "linux") {
      const file =
        options?.file ?? (options?.sound ? `/usr/share/sounds/${options.sound}` : undefined);
      command = file ? `paplay "${file}" || aplay "${file}"` : `printf '\\a'`;
    } else {
      return {
        success: true,
        command: "noop",
        output: `Platform ${platform} audio skipped gracefully`,
      };
    }
  }

  try {
    const result = spawnSync("sh", ["-c", command], {
      timeout: timeoutMs,
      stdio: silent ? "ignore" : "pipe",
      encoding: "utf8",
    });

    if (result.status === 0) {
      return {
        success: true,
        command,
        output: result.stdout
          ? result.stdout.trim()
          : soundPath
            ? `Played audio: ${soundPath}`
            : "Audio notification played",
      };
    }

    const err = result.stderr ? result.stderr.trim() : `Exited with code ${result.status}`;
    return {
      success: false,
      command,
      error: err.length > 0 ? err : "Audio playback failed",
    };
  } catch (err) {
    return {
      success: false,
      command,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Filter an array of completion audio events, returning only those permitted to chime.
 */
export function filterCompletionAudioEvents(
  events: readonly CompletionAudioEvaluationInput[],
  config?: CompletionAudioConfig | undefined,
): readonly CompletionAudioEvaluationInput[] {
  return events.filter((ev) => evaluateCompletionAudio(ev, config).shouldPlay);
}

/**
 * Completion Audio Manager providing stateful rate limiting and noise-filtered dispatch.
 */
export class CompletionAudioManager {
  private config: CompletionAudioConfig;
  private lastPlayedAt: number = 0;

  public constructor(config: CompletionAudioConfig = {}) {
    this.config = { ...config };
  }

  public getConfig(): CompletionAudioConfig {
    return { ...this.config };
  }

  public updateConfig(patch: Partial<CompletionAudioConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  public getLastPlayedAt(): number {
    return this.lastPlayedAt;
  }

  public resetCooldown(): void {
    this.lastPlayedAt = 0;
  }

  public evaluate(
    input: CompletionAudioEvaluationInput,
    now: number = Date.now(),
  ): CompletionDecision {
    return evaluateCompletionAudio(input, this.config, this.lastPlayedAt, now);
  }

  public async notifyCompletion(
    event: string,
    context?: CompletionAudioContext | undefined,
    now: number = Date.now(),
  ): Promise<CompletionAudioPlayResult> {
    const input: CompletionAudioEvaluationInput = {
      event,
      actor: context?.actor,
      role: context?.role,
      tier: context?.tier,
      runId: context?.runId,
      taskId: context?.taskId,
      timestamp: now,
    };

    const decision = this.evaluate(input, now);
    if (!decision.shouldPlay) {
      return {
        played: false,
        event,
        reason: decision.reason,
      };
    }

    const sound = this.config.sound ?? "Bottle";
    const file =
      this.config.soundFile ?? (sound === "Bottle" ? DEFAULT_DARWIN_SOUND_PATH : undefined);
    const command =
      this.config.command ?? (file ? `afplay "${file}"` : DEFAULT_DARWIN_AUDIO_COMMAND);

    const execResult = playCompletionAudioSync({
      sound,
      file,
      command: this.config.command,
      platform: this.config.platform,
      silent: this.config.silent,
    });

    if (execResult.success) {
      this.lastPlayedAt = now;
    }

    return {
      played: execResult.success,
      event,
      sound,
      command: execResult.command,
      reason: decision.reason,
      output: execResult.output,
      error: execResult.error,
    };
  }
}
