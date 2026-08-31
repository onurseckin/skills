import type { UnifiedTelemetryReport } from "./types.ts";
import {
  AUTO_WAKE_PROMPT,
  computeAutoWakeSchedule,
  extractResetTime,
} from "./circuit-breaker-autowake.ts";

export type CircuitBreakerStatus =
  | "OK"
  | "QUOTA_EXHAUSTED_CIRCUIT_BROKEN"
  | "QUOTA_UNKNOWN_CIRCUIT_BROKEN";

export const DEFAULT_QUOTA_THRESHOLD = 10.0;
export const DEFAULT_RECOVERY_THRESHOLD = 15.0;
export const DEFAULT_SAFE_WINDOW_SECONDS = 18000;
export const DEFAULT_AUTO_WAKE_BUFFER_SECONDS = 60;
export const DEFAULT_COOLDOWN_SECONDS = 60;

export const CRITICAL_WRAP_UP_MESSAGE =
  "CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<10%). Wrap up current micro-step immediately. Do not claim or start new tasks. Keep working tree changes unstaged/stashed safely without destructive actions. Enter idle state.";

export const UNMEASURED_QUOTA_WRAP_UP_MESSAGE =
  "Quota availability is unavailable or unmeasured. Wrap up current micro-step immediately. Do not claim or start new tasks until a measured quota observation is available. Keep working tree changes unstaged/stashed safely without destructive actions. Enter idle state.";

export { AUTO_WAKE_PROMPT, computeAutoWakeSchedule, extractResetTime };

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
  readonly jitterSeconds?: number | undefined;
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
  readonly recoveryThresholdPercentage?: number | undefined;
  readonly lowestRemainingQuota: number | null;
  readonly constrainedModels: readonly ConstrainedModelInfo[];
  readonly wrapUpDirectives: readonly WrapUpDirective[];
  readonly autoWakeSchedule: AutoWakeSchedulePayload | null;
  readonly summary: string;
  readonly evaluatedAt: string;
  readonly activeHost?: string | null | undefined;
  readonly inCooldown?: boolean | undefined;
}

export interface QuotaCircuitBreakerOptions {
  readonly thresholdPercentage?: number | undefined;
  readonly recoveryThresholdPercentage?: number | undefined;
  readonly previousStatus?: CircuitBreakerStatus | "TRIPPED" | "OK" | undefined;
  readonly cooldownSeconds?: number | undefined;
  readonly lastTrippedAt?: number | Date | string | undefined;
  readonly activeAgentsCount?: number | undefined;
  readonly activeAgentIds?: readonly string[] | undefined;
  readonly agentIndex?: number | undefined;
  readonly activeHost?: string | undefined;
  readonly now?: number | Date | string | undefined;
  readonly defaultSafeWindowSeconds?: number | undefined;
  readonly bufferSeconds?: number | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly enableJitter?: boolean | undefined;
  readonly jitter?: boolean | undefined;
  readonly jitterSeconds?: number | undefined;
  readonly jitterFactor?: number | undefined;
  readonly disableJitter?: boolean | undefined;
  readonly jitterSeed?: number | undefined;
}

export function normalizeCanonicalHost(host: string): string {
  const norm = host
    .toLowerCase()
    .trim()
    .replace(/[-_ ]+/g, "_");
  if (norm.includes("antigravity") || norm.includes("gemini")) return "antigravity";
  if (norm.includes("claude")) return "claude_code";
  if (norm.includes("codex") || norm.includes("openai")) return "codex";
  return norm.includes("cursor") ? "cursor" : norm;
}

export function isPlatformMatchingHost(platformId: string, host: string): boolean {
  const normP = normalizeCanonicalHost(platformId);
  const normH = normalizeCanonicalHost(host);
  if (normP === normH) return true;
  const p = platformId.toLowerCase().trim();
  const h = host.toLowerCase().trim();
  return p === h || normP.includes(h) || normH.includes(p);
}

export function detectActiveHost(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): string | undefined {
  if (
    env["ANTIGRAVITY_CLI"] ||
    env["GEMINI_CLI"] ||
    env["ANTIGRAVITY_VERSION"] ||
    env["ANTIGRAVITY_AGENT_ID"]
  )
    return "antigravity";
  if (env["CURSOR_VERSION"] || env["CURSOR_IS_ACTIVE"]) return "cursor";
  if (env["CLAUDE_CODE_VERSION"] || env["CLAUDE_IS_ACTIVE"]) return "claude_code";
  if (
    env["CODEX_VERSION"] ||
    env["CODEX_CLI"] ||
    env["CODEX"] ||
    (env["OPENAI_API_KEY"] && env["CODEX_VERSION"])
  )
    return "codex";
  return undefined;
}

function resolveNowMs(now?: number | Date | string): number {
  if (now instanceof Date) return now.getTime();
  if (typeof now === "string") return new Date(now).getTime();
  if (typeof now === "number") return now;
  return Date.now();
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
  const recoveryThreshold = options?.recoveryThresholdPercentage ?? DEFAULT_RECOVERY_THRESHOLD;
  const cooldownSec = options?.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
  const nowMs = resolveNowMs(options?.now);

  const isPreviouslyTripped =
    options?.previousStatus === "QUOTA_EXHAUSTED_CIRCUIT_BROKEN" ||
    options?.previousStatus === "QUOTA_UNKNOWN_CIRCUIT_BROKEN" ||
    options?.previousStatus === "TRIPPED";

  const effectiveThreshold = isPreviouslyTripped ? recoveryThreshold : threshold;

  let inCooldown = false;
  if (isPreviouslyTripped && options?.lastTrippedAt !== undefined) {
    const lastTrippedMs = resolveNowMs(options.lastTrippedAt);
    if (nowMs - lastTrippedMs < cooldownSec * 1000) inCooldown = true;
  }

  const explicitActiveHost = options?.activeHost?.trim();
  const summaryActiveHost =
    typeof report.summary?.activeHost === "string" ? report.summary.activeHost.trim() : undefined;
  const detectedHost = detectActiveHost(
    options?.env ?? (typeof process !== "undefined" ? process.env : {}),
  );
  const targetHost = explicitActiveHost ?? summaryActiveHost ?? detectedHost;

  let candidateResults = report.results;
  let activeHost: string | undefined = undefined;
  let isFilteredByHost = false;

  if (targetHost) {
    const matching = report.results.filter((res) =>
      isPlatformMatchingHost(res.platformId, targetHost),
    );
    if (matching.length > 0) {
      candidateResults = matching;
      activeHost = targetHost;
      isFilteredByHost = true;
    } else if (explicitActiveHost) {
      candidateResults = [];
      activeHost = explicitActiveHost;
      isFilteredByHost = true;
    }
  }

  const constrainedModels: ConstrainedModelInfo[] = [];
  let lowestRemainingQuota: number | null = null;
  let measuredObservationCount = 0;
  let hasUnmeasuredObservation = candidateResults.length === 0;

  for (const res of candidateResults) {
    if (!res.isDetected) {
      hasUnmeasuredObservation = true;
      continue;
    }
    if (res.errors.length > 0 || res.metrics.length === 0) hasUnmeasuredObservation = true;
    for (const metric of res.metrics) {
      const remaining = metric.remainingPercentage;
      if (typeof remaining !== "number" || !Number.isFinite(remaining)) {
        hasUnmeasuredObservation = true;
        continue;
      }
      measuredObservationCount += 1;
      if (lowestRemainingQuota === null || remaining < lowestRemainingQuota)
        lowestRemainingQuota = remaining;
      if (remaining <= effectiveThreshold) {
        constrainedModels.push({
          platformId: res.platformId,
          modelName: metric.rawMetricName,
          remainingPercentage: remaining,
          resetTime: extractResetTime(metric),
          sourceTier: metric.sourceTier,
          confidence: metric.confidence,
        });
      }
    }
  }

  const summaryRemaining = report.summary
    ? (report.summary["lowestRemainingQuota"] as number | undefined)
    : undefined;
  const summaryShowsExhaustion =
    !isFilteredByHost &&
    typeof summaryRemaining === "number" &&
    Number.isFinite(summaryRemaining) &&
    summaryRemaining <= effectiveThreshold;
  if (
    summaryShowsExhaustion &&
    (lowestRemainingQuota === null || summaryRemaining < lowestRemainingQuota)
  ) {
    lowestRemainingQuota = summaryRemaining;
  }

  const isExhausted = constrainedModels.length > 0 || summaryShowsExhaustion;
  const isUnknown = !isExhausted && (measuredObservationCount === 0 || hasUnmeasuredObservation);
  const isTriggered = isExhausted || isUnknown || inCooldown;
  const activeHostVal = activeHost !== undefined ? activeHost : null;

  if (!isTriggered) {
    const summary =
      lowestRemainingQuota !== null
        ? `Quota healthy at ${lowestRemainingQuota.toFixed(2)}% (threshold: ${threshold.toFixed(2)}%). Circuit breaker inactive.`
        : "No quota metrics detected; execution running normally.";
    return {
      status: "OK",
      isTriggered: false,
      thresholdPercentage: threshold,
      recoveryThresholdPercentage: recoveryThreshold,
      lowestRemainingQuota,
      constrainedModels: [],
      wrapUpDirectives: [],
      autoWakeSchedule: null,
      summary,
      evaluatedAt: new Date(nowMs).toISOString(),
      activeHost: activeHostVal,
      inCooldown: false,
    };
  }

  const wrapUpMessage = isUnknown ? UNMEASURED_QUOTA_WRAP_UP_MESSAGE : CRITICAL_WRAP_UP_MESSAGE;
  const wrapUpReason = isUnknown
    ? "Quota availability is unavailable or unmeasured; fail closed."
    : `Quota threshold breached (<=${effectiveThreshold}%).`;
  const recipients =
    options?.activeAgentIds && options.activeAgentIds.length > 0
      ? options.activeAgentIds
      : ["all_active_agents"];
  const wrapUpDirectives: WrapUpDirective[] = recipients.map((recipient) => ({
    recipient,
    message: wrapUpMessage,
    action: "idle",
    forbidKill: true,
    reason: wrapUpReason,
  }));

  const autoWakeSchedule = computeAutoWakeSchedule(
    constrainedModels,
    nowMs,
    options?.bufferSeconds ?? defaults.buffer,
    options?.defaultSafeWindowSeconds ?? defaults.safeWindow,
    options,
  );

  const summary = isUnknown
    ? `⚠️ Quota availability is unavailable or unmeasured. ${lowestRemainingQuota !== null ? `Lowest measured quota: ${lowestRemainingQuota.toFixed(2)}%. ` : "No trustworthy quota percentage was observed. "}Auto-wake in ${autoWakeSchedule.durationSeconds}s at ${autoWakeSchedule.targetWakeupIso}.`
    : `🚨 CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (${isPreviouslyTripped ? `hysteresis <=${recoveryThreshold}%` : `<${threshold}%`}${inCooldown ? " [in cooldown]" : ""}). Lowest quota: ${lowestRemainingQuota !== null ? `${lowestRemainingQuota.toFixed(2)}%` : "unknown"}. ${constrainedModels.length} constrained models. Auto-wake in ${autoWakeSchedule.durationSeconds}s at ${autoWakeSchedule.targetWakeupIso}.`;

  return {
    status: isUnknown ? "QUOTA_UNKNOWN_CIRCUIT_BROKEN" : "QUOTA_EXHAUSTED_CIRCUIT_BROKEN",
    isTriggered: true,
    thresholdPercentage: threshold,
    recoveryThresholdPercentage: recoveryThreshold,
    lowestRemainingQuota,
    constrainedModels,
    wrapUpDirectives,
    autoWakeSchedule,
    summary,
    evaluatedAt: new Date(nowMs).toISOString(),
    activeHost: activeHostVal,
    inCooldown,
  };
}
