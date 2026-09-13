/**
 * Strict type definitions for Tier 0 Quota Agent & Telemetry Monitor.
 * Invariants: 0 any, 0 suppressions, <= 400 lines.
 */

export type QuotaStatus = "HEALTHY" | "WARNING" | "CRITICAL_FREEZE";

export interface QuotaThresholdConfig {
  readonly freezeThresholdPercentage: number;
  readonly warningThresholdPercentage: number;
  readonly recoveryThresholdPercentage: number;
  readonly autoWakeBufferSeconds: number;
  readonly safeWindowSeconds: number;
  readonly cooldownSeconds: number;
  readonly failClosed: boolean;
}

export interface QuotaMetric {
  readonly name?: string | undefined;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly platform?: string | undefined;
  readonly platformId?: string | undefined;
  readonly remainingPercentage?: number | undefined;
  readonly remainingPercent?: number | undefined;
  readonly remainingFraction?: number | undefined;
  readonly remaining?: number | undefined;
  readonly total?: number | undefined;
  readonly used?: number | undefined;
  readonly resetTime?: string | undefined;
  readonly rawPayload?: Readonly<Record<string, unknown>> | undefined;
}

export interface QuotaSnapshot {
  readonly timestamp?: string | undefined;
  readonly metrics?: readonly QuotaMetric[] | undefined;
  readonly results?:
    | readonly { readonly metrics?: readonly QuotaMetric[] | undefined }[]
    | undefined;
  readonly remainingPercentage?: number | undefined;
  readonly resetTime?: string | undefined;
  readonly platformId?: string | undefined;
  readonly modelName?: string | undefined;
}

export interface ConstrainedModelInfo {
  readonly modelName: string;
  readonly platformId: string;
  readonly remainingPercentage: number;
  readonly resetTime?: string | undefined;
}

export interface QuotaEvaluationVerdict {
  readonly tripped: boolean;
  readonly shouldFreeze: boolean;
  readonly status: QuotaStatus;
  readonly remainingPercentage: number;
  readonly thresholdPercentage: number;
  readonly recoveryThresholdPercentage: number;
  readonly constrainedModel?: ConstrainedModelInfo | undefined;
  readonly unmeasuredModels?: readonly string[] | undefined;
  readonly reason?: string | undefined;
  readonly directive?: string | undefined;
  readonly resetTime?: string | undefined;
  readonly checkedAt: string;
}

export interface SentinelOptions {
  readonly now?: number | Date | string | undefined;
  readonly bufferSeconds?: number | undefined;
  readonly safeWindowSeconds?: number | undefined;
  readonly enableJitter?: boolean | undefined;
  readonly jitter?: boolean | undefined;
  readonly jitterFactor?: number | undefined;
  readonly jitterSeed?: number | undefined;
  readonly jitterSeconds?: number | undefined;
  readonly disableJitter?: boolean | undefined;
  readonly agentIndex?: number | undefined;
  readonly activeAgentsCount?: number | undefined;
  readonly maxJitterSeconds?: number | undefined;
}

export interface SentinelWakeSchedule {
  readonly type: "one_shot_timer";
  readonly durationSeconds: number;
  readonly targetWakeupIso: string;
  readonly prompt: string;
  readonly timerCondition: "never";
  readonly activeAgentsCount?: number | undefined;
  readonly jitterSeconds?: number | undefined;
  readonly fallbackUsed?: boolean | undefined;
}

export interface QuotaDagSnapshot {
  readonly snapshotId: string;
  readonly createdAt: string;
  readonly frozenAt: string;
  readonly resumedAt?: string | undefined;
  readonly status: "active_freeze" | "resumed";
  readonly triggeredByModel: string;
  readonly remainingQuotaPercentage: number;
  readonly resetTime?: string | undefined;
  readonly targetWakeupIso: string;
  readonly activeTaskIds: readonly string[];
  readonly pendingTaskIds: readonly string[];
  readonly completedTaskIds: readonly string[];
  readonly unstagedFilesCount: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export type QuotaMonitorState = "IDLE" | "MONITORING" | "FROZEN" | "RESUMING" | "STOPPED";

export interface QuotaMonitorStatus {
  readonly state: QuotaMonitorState;
  readonly isFrozen: boolean;
  readonly lastCheckAt?: string | undefined;
  readonly lastFreezeAt?: string | undefined;
  readonly lastResumeAt?: string | undefined;
  readonly lastEvaluation?: QuotaEvaluationVerdict | undefined;
  readonly currentSchedule?: SentinelWakeSchedule | undefined;
  readonly activeAgentsCount: number;
}

export interface QuotaMonitorOptions {
  readonly cadenceMs?: number | undefined;
  readonly thresholds?: Partial<QuotaThresholdConfig> | undefined;
  readonly storageDir?: string | undefined;
  readonly onFreeze?:
    | ((verdict: QuotaEvaluationVerdict, sentinel: SentinelWakeSchedule) => void | Promise<void>)
    | undefined;
  readonly onResume?: ((verdict: QuotaEvaluationVerdict) => void | Promise<void>) | undefined;
  readonly onMailboxEmit?:
    | ((channel: string, payload: Readonly<Record<string, unknown>>) => void | Promise<void>)
    | undefined;
  readonly quotaProvider?: (() => unknown) | undefined;
  readonly now?: (() => number) | undefined;
}

export const DEFAULT_FREEZE_THRESHOLD = 10.0;
export const DEFAULT_WARNING_THRESHOLD = 20.0;
export const DEFAULT_RECOVERY_THRESHOLD = 15.0;
export const DEFAULT_SAFE_WINDOW_SECONDS = 18000; // 5 hours
export const DEFAULT_AUTO_WAKE_BUFFER_SECONDS = 60; // 1 minute
export const DEFAULT_COOLDOWN_SECONDS = 60;
export const DEFAULT_MAX_JITTER_SECONDS = 300; // 5 minutes max jitter

export const CRITICAL_WRAP_UP_MESSAGE =
  "CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<10%). Wrap up current micro-step immediately. Do not claim or start new tasks. Keep working tree changes unstaged/stashed safely without destructive actions. Enter idle state.";

export const AUTO_WAKE_PROMPT =
  "Quota limit refreshed (+1m buffer). Resuming autonomous execution from idle state.";
