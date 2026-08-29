import type { NormalizedQuotaMetric, UnifiedTelemetryReport } from "./types.ts";

export type CircuitBreakerStatus =
  | "OK"
  | "QUOTA_EXHAUSTED_CIRCUIT_BROKEN"
  | "QUOTA_UNKNOWN_CIRCUIT_BROKEN";

export const DEFAULT_QUOTA_THRESHOLD = 10.0;
export const DEFAULT_SAFE_WINDOW_SECONDS = 18000;
export const DEFAULT_AUTO_WAKE_BUFFER_SECONDS = 60;

export const CRITICAL_WRAP_UP_MESSAGE =
  "CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<10%). Wrap up current micro-step immediately. Do not claim or start new tasks. Keep working tree changes unstaged/stashed safely without destructive actions. Enter idle state.";

export const UNMEASURED_QUOTA_WRAP_UP_MESSAGE =
  "Quota availability is unavailable or unmeasured. Wrap up current micro-step immediately. Do not claim or start new tasks until a measured quota observation is available. Keep working tree changes unstaged/stashed safely without destructive actions. Enter idle state.";

export const AUTO_WAKE_PROMPT =
  "Quota limit refreshed (+1m buffer). Resuming autonomous execution from idle state.";

export interface WrapUpDirective {
  readonly recipient: string;
  readonly message: string;
  readonly action: "idle";
  readonly forbidKill: true;
  readonly reason: string;
}

export interface AutoWakeSchedulePayload {
  readonly type: "one_shot_timer";
  readonly durationSeconds: number;
  readonly targetWakeupIso: string;
  readonly prompt: string;
  readonly timerCondition: "never";
  readonly activeAgentsCount: number;
}

export interface ConstrainedModelInfo {
  readonly platformId: string;
  readonly modelName: string;
  readonly remainingPercentage: number;
  readonly resetTime?: string | undefined;
  readonly sourceTier?: string | undefined;
  readonly confidence?: string | undefined;
}

export interface CircuitBreakerEvaluation {
  readonly status: CircuitBreakerStatus;
  readonly isTriggered: boolean;
  readonly thresholdPercentage: number;
  readonly lowestRemainingQuota: number | null;
  readonly constrainedModels: readonly ConstrainedModelInfo[];
  readonly wrapUpDirectives: readonly WrapUpDirective[];
  readonly autoWakeSchedule: AutoWakeSchedulePayload | null;
  readonly summary: string;
  readonly evaluatedAt: string;
}

export interface QuotaCircuitBreakerOptions {
  readonly thresholdPercentage?: number | undefined;
  readonly activeAgentsCount?: number | undefined;
  readonly activeAgentIds?: readonly string[] | undefined;
  readonly now?: number | Date | string | undefined;
  readonly defaultSafeWindowSeconds?: number | undefined;
  readonly bufferSeconds?: number | undefined;
}

export function extractResetTime(metric: NormalizedQuotaMetric): string | undefined {
  const payload = metric.rawPayload;
  if (!payload || typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;

  if (typeof record.resetTime === "string" && record.resetTime.trim()) {
    return record.resetTime.trim();
  }
  if (typeof record.reset_time === "string" && record.reset_time.trim()) {
    return record.reset_time.trim();
  }

  if (typeof record.quotaInfo === "object" && record.quotaInfo !== null) {
    const quotaInfo = record.quotaInfo as Record<string, unknown>;
    if (typeof quotaInfo.resetTime === "string" && quotaInfo.resetTime.trim()) {
      return quotaInfo.resetTime.trim();
    }
    if (typeof quotaInfo.reset_time === "string" && quotaInfo.reset_time.trim()) {
      return quotaInfo.reset_time.trim();
    }
  }

  if (typeof record.userStatus === "object" && record.userStatus !== null) {
    const userStatus = record.userStatus as Record<string, unknown>;
    if (typeof userStatus.quotaInfo === "object" && userStatus.quotaInfo !== null) {
      const qInfo = userStatus.quotaInfo as Record<string, unknown>;
      if (typeof qInfo.resetTime === "string" && qInfo.resetTime.trim()) {
        return qInfo.resetTime.trim();
      }
      if (typeof qInfo.reset_time === "string" && qInfo.reset_time.trim()) {
        return qInfo.reset_time.trim();
      }
    }
    if (typeof userStatus.resetTime === "string" && userStatus.resetTime.trim()) {
      return userStatus.resetTime.trim();
    }
  }

  return undefined;
}

export function evaluateCircuitBreaker(
  report: UnifiedTelemetryReport,
  options?: QuotaCircuitBreakerOptions,
  defaults: { threshold: number; safeWindow: number; buffer: number } = {
    threshold: DEFAULT_QUOTA_THRESHOLD,
    safeWindow: DEFAULT_SAFE_WINDOW_SECONDS,
    buffer: DEFAULT_AUTO_WAKE_BUFFER_SECONDS,
  },
): CircuitBreakerEvaluation {
  const threshold = options?.thresholdPercentage ?? defaults.threshold;
  const defaultSafeWindow = options?.defaultSafeWindowSeconds ?? defaults.safeWindow;
  const bufferSec = options?.bufferSeconds ?? defaults.buffer;
  const activeAgentsCount = options?.activeAgentsCount ?? options?.activeAgentIds?.length ?? 0;

  const nowMs =
    options?.now !== undefined
      ? options.now instanceof Date
        ? options.now.getTime()
        : typeof options.now === "string"
          ? new Date(options.now).getTime()
          : options.now
      : Date.now();

  const constrainedModels: ConstrainedModelInfo[] = [];
  let lowestRemainingQuota: number | null = null;
  let measuredObservationCount = 0;
  let hasUnmeasuredObservation = report.results.length === 0;

  for (const res of report.results) {
    if (res.isDetected !== true) {
      hasUnmeasuredObservation = true;
      continue;
    }
    if (res.errors.length > 0 || res.metrics.length === 0) hasUnmeasuredObservation = true;
    for (const metric of res.metrics) {
      const remainingPercentage = metric.remainingPercentage;
      if (typeof remainingPercentage !== "number" || !Number.isFinite(remainingPercentage)) {
        hasUnmeasuredObservation = true;
        continue;
      }
      measuredObservationCount += 1;

      if (lowestRemainingQuota === null || remainingPercentage < lowestRemainingQuota) {
        lowestRemainingQuota = remainingPercentage;
      }

      if (remainingPercentage < threshold) {
        constrainedModels.push({
          platformId: res.platformId,
          modelName: metric.rawMetricName,
          remainingPercentage,
          resetTime: extractResetTime(metric),
          sourceTier: metric.sourceTier,
          confidence: metric.confidence,
        });
      }
    }
  }

  const summaryRemainingQuota = report.summary?.lowestRemainingQuota;
  const summaryShowsExhaustion =
    typeof summaryRemainingQuota === "number" &&
    Number.isFinite(summaryRemainingQuota) &&
    summaryRemainingQuota < threshold;
  if (
    summaryShowsExhaustion &&
    (lowestRemainingQuota === null || summaryRemainingQuota < lowestRemainingQuota)
  ) {
    lowestRemainingQuota = summaryRemainingQuota;
  }

  const isExhausted = constrainedModels.length > 0 || summaryShowsExhaustion;
  const isUnknown = !isExhausted && (measuredObservationCount === 0 || hasUnmeasuredObservation);
  const isTriggered = isExhausted || isUnknown;

  if (!isTriggered) {
    const summary =
      lowestRemainingQuota !== null
        ? `Quota healthy at ${lowestRemainingQuota.toFixed(2)}% (threshold: ${threshold.toFixed(2)}%). Circuit breaker inactive.`
        : "No quota metrics detected; execution running normally.";

    return {
      status: "OK",
      isTriggered: false,
      thresholdPercentage: threshold,
      lowestRemainingQuota,
      constrainedModels: [],
      wrapUpDirectives: [],
      autoWakeSchedule: null,
      summary,
      evaluatedAt: new Date(nowMs).toISOString(),
    };
  }

  const wrapUpMessage = isUnknown ? UNMEASURED_QUOTA_WRAP_UP_MESSAGE : CRITICAL_WRAP_UP_MESSAGE;
  const wrapUpReason = isUnknown
    ? "Quota availability is unavailable or unmeasured; fail closed."
    : `Quota threshold breached (<${threshold}%).`;
  const wrapUpDirectives: WrapUpDirective[] =
    options?.activeAgentIds && options.activeAgentIds.length > 0
      ? options.activeAgentIds.map((agentId) => ({
          recipient: agentId,
          message: wrapUpMessage,
          action: "idle" as const,
          forbidKill: true as const,
          reason: wrapUpReason,
        }))
      : [
          {
            recipient: "all_active_agents",
            message: wrapUpMessage,
            action: "idle" as const,
            forbidKill: true as const,
            reason: wrapUpReason,
          },
        ];

  const validResetDates: Date[] = [];
  for (const model of constrainedModels) {
    if (model.resetTime) {
      const parsed = new Date(model.resetTime);
      if (!isNaN(parsed.getTime())) {
        validResetDates.push(parsed);
      }
    }
  }

  let targetWakeupMs: number;
  let durationSeconds: number;

  if (validResetDates.length > 0) {
    validResetDates.sort((a, b) => a.getTime() - b.getTime());
    const earliestResetDate = validResetDates[0]!;

    targetWakeupMs = earliestResetDate.getTime() + bufferSec * 1000;
    const diffSeconds = Math.ceil((targetWakeupMs - nowMs) / 1000);
    durationSeconds = Math.max(bufferSec, diffSeconds);
  } else {
    durationSeconds = defaultSafeWindow + bufferSec;
    targetWakeupMs = nowMs + durationSeconds * 1000;
  }

  const autoWakeSchedule: AutoWakeSchedulePayload = {
    type: "one_shot_timer",
    durationSeconds,
    targetWakeupIso: new Date(targetWakeupMs).toISOString(),
    prompt: AUTO_WAKE_PROMPT,
    timerCondition: "never",
    activeAgentsCount,
  };

  const summary = isUnknown
    ? `⚠️ Quota availability is unavailable or unmeasured. ${
        lowestRemainingQuota !== null
          ? `Lowest measured quota: ${lowestRemainingQuota.toFixed(2)}%. `
          : "No trustworthy quota percentage was observed. "
      }Auto-wake in ${durationSeconds}s at ${autoWakeSchedule.targetWakeupIso}.`
    : `🚨 CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<${threshold}%). Lowest quota: ${
        lowestRemainingQuota !== null ? `${lowestRemainingQuota.toFixed(2)}%` : "unknown"
      }. ${constrainedModels.length} constrained models. Auto-wake in ${durationSeconds}s at ${autoWakeSchedule.targetWakeupIso}.`;

  return {
    status: isUnknown ? "QUOTA_UNKNOWN_CIRCUIT_BROKEN" : "QUOTA_EXHAUSTED_CIRCUIT_BROKEN",
    isTriggered: true,
    thresholdPercentage: threshold,
    lowestRemainingQuota,
    constrainedModels,
    wrapUpDirectives,
    autoWakeSchedule,
    summary,
    evaluatedAt: new Date(nowMs).toISOString(),
  };
}
