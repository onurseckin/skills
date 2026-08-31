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
