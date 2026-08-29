import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { DEFAULT_DARWIN_AUDIO_COMMAND, DEFAULT_DARWIN_SOUND_PATH } from "../hooks/config/index.ts";
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
  readonly commandArgv?: readonly string[] | undefined;
  readonly player?: AudioPlayer | undefined;
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
  readonly commandArgv?: readonly string[] | undefined;
  readonly player?: AudioPlayer | undefined;
  readonly platform?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly silent?: boolean | undefined;
}

export interface AudioPlayResult {
  readonly status: number | null;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
}

export type AudioPlayer = (
  executablePath: string,
  args: readonly string[],
  options: { readonly timeoutMs: number; readonly silent: boolean },
) => AudioPlayResult;

const AUDIO_PLAYER_CANDIDATE_PATHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  afplay: ["/usr/bin/afplay"],
  paplay: ["/usr/bin/paplay", "/bin/paplay"],
  aplay: ["/usr/bin/aplay", "/bin/aplay"],
});

export const ALLOWED_AUDIO_PLAYERS: readonly string[] = Object.freeze(
  Object.keys(AUDIO_PLAYER_CANDIDATE_PATHS),
);

const AUDIO_FILE_EXTENSIONS: readonly string[] = Object.freeze([
  ".aiff",
  ".aif",
  ".wav",
  ".mp3",
  ".m4a",
  ".ogg",
  ".flac",
]);

function resolveAudioPlayerPath(executable: string): string | undefined {
  for (const candidate of AUDIO_PLAYER_CANDIDATE_PATHS[executable] ?? []) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function isValidAudioFilePath(candidate: string): boolean {
  if (!candidate.startsWith("/")) return false;
  const lowered = candidate.toLowerCase();
  return AUDIO_FILE_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

function renderArgv(argv: readonly string[]): string {
  return argv.join(" ");
}

export function playCompletionAudioSync(options?: SoundExecutionOptions | undefined): {
  success: boolean;
  command: string;
  output?: string;
  error?: string;
} {
  const platform = options?.platform ?? process.platform;
  const timeoutMs = options?.timeoutMs ?? 5000;
  const silent = options?.silent ?? false;

  if (options?.command !== undefined && options.command.trim().length > 0) {
    return {
      success: false,
      command: options.command,
      error: `completion audio no longer accepts a raw "command" shell string ("${options.command}"); declare "commandArgv" as an argv array whose first element is an allowlisted audio player (${ALLOWED_AUDIO_PLAYERS.join(", ")}), or pass "sound"/"file" and let the platform default apply.`,
    };
  }

  const attempts: string[][] = [];

  if (options?.commandArgv !== undefined) {
    if (options.commandArgv.length === 0) {
      return {
        success: false,
        command: "",
        error: "commandArgv must not be empty",
      };
    }
    attempts.push([...options.commandArgv]);
  } else if (platform === "darwin") {
    attempts.push(["afplay", resolveAudioSoundPath(options?.sound ?? "Bottle", options?.file)]);
  } else if (platform === "linux") {
    const file =
      options?.file ?? (options?.sound ? `/usr/share/sounds/${options.sound}` : undefined);
    if (file === undefined) {
      return {
        success: true,
        command: "noop",
        output: "No audio file resolved for linux; audio skipped gracefully",
      };
    }
    attempts.push(["paplay", file], ["aplay", file]);
  } else {
    return {
      success: true,
      command: "noop",
      output: `Platform ${platform} audio skipped gracefully`,
    };
  }

  let lastError = "Audio playback failed";
  let lastCommand = "";

  for (const argv of attempts) {
    const executable = argv[0]!;
    lastCommand = renderArgv(argv);

    if (!ALLOWED_AUDIO_PLAYERS.includes(executable)) {
      return {
        success: false,
        command: lastCommand,
        error: `"${executable}" is not an allowlisted audio player. Allowed: ${ALLOWED_AUDIO_PLAYERS.join(", ")}.`,
      };
    }

    const soundPath = argv[1];
    if (soundPath === undefined || !isValidAudioFilePath(soundPath)) {
      return {
        success: false,
        command: lastCommand,
        error: `audio path "${soundPath ?? ""}" is not an absolute path ending in a recognized audio extension (${AUDIO_FILE_EXTENSIONS.join(", ")}).`,
      };
    }

    const resolved =
      options?.player === undefined ? resolveAudioPlayerPath(executable) : executable;
    if (resolved === undefined) {
      lastError = `no trusted absolute path could be resolved for allowlisted audio player "${executable}" on this system; refusing to fall back to a PATH-based lookup`;
      continue;
    }

    const play: AudioPlayer =
      options?.player ??
      ((executablePath, args, opts) => {
        const spawned = spawnSync(executablePath, [...args], {
          timeout: opts.timeoutMs,
          stdio: opts.silent ? "ignore" : "pipe",
          encoding: "utf8",
          shell: false,
        });
        return { status: spawned.status, stdout: spawned.stdout, stderr: spawned.stderr };
      });

    try {
      const result = play(resolved, argv.slice(1), { timeoutMs, silent });

      if (result.status === 0) {
        return {
          success: true,
          command: lastCommand,
          output: result.stdout ? result.stdout.trim() : `Played audio: ${soundPath}`,
        };
      }

      const err = result.stderr ? result.stderr.trim() : `Exited with code ${result.status}`;
      lastError = err.length > 0 ? err : "Audio playback failed";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    success: false,
    command: lastCommand,
    error: lastError,
  };
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
      ...(this.config.command === undefined ? {} : { command: this.config.command }),
      ...(this.config.commandArgv === undefined ? {} : { commandArgv: this.config.commandArgv }),
      ...(this.config.player === undefined ? {} : { player: this.config.player }),
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
