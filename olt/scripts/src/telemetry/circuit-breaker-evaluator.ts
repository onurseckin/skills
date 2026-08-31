import type { NormalizedQuotaMetric, UnifiedTelemetryReport } from "./types.ts";

export type CircuitBreakerStatus = "OK" | "QUOTA_EXHAUSTED_CIRCUIT_BROKEN" | "QUOTA_UNKNOWN_CIRCUIT_BROKEN";

export const DEFAULT_QUOTA_THRESHOLD: number = 10.0;
export const DEFAULT_SAFE_WINDOW_SECONDS: number = 18000;
export const DEFAULT_AUTO_WAKE_BUFFER_SECONDS: number = 60;

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
  readonly activeHost?: string | null | undefined;
}

export interface QuotaCircuitBreakerOptions {
  readonly thresholdPercentage?: number | undefined;
  readonly activeAgentsCount?: number | undefined;
  readonly activeAgentIds?: readonly string[] | undefined;
  readonly activeHost?: string | undefined;
  readonly now?: number | Date | string | undefined;
  readonly defaultSafeWindowSeconds?: number | undefined;
  readonly bufferSeconds?: number | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
}

export function normalizeCanonicalHost(host: string): string {
  const norm = host.toLowerCase().trim().replace(/[-_ ]+/g, "_");
  if (norm.includes("antigravity") || norm.includes("gemini")) return "antigravity";
  if (norm.includes("claude")) return "claude_code";
  if (norm.includes("codex") || norm.includes("openai")) return "codex";
  if (norm.includes("cursor")) return "cursor";
  return norm;
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
  if (env["ANTIGRAVITY_CLI"] || env["GEMINI_CLI"] || env["ANTIGRAVITY_VERSION"] || env["ANTIGRAVITY_AGENT_ID"]) return "antigravity";
  if (env["CLAUDE_CODE_VERSION"] || env["CLAUDE_CLI"] || env["CLAUDE_CODE_SESSION_ID"] || env["CLAUDE_CODE_ENTRYPOINT"]) return "claude_code";
  const termProgram = env["TERM_PROGRAM"] ? env["TERM_PROGRAM"].toLowerCase() : "";
  if (termProgram === "cursor" || env["CURSOR_VERSION"] || env["CURSOR_MODEL"]) return "cursor";
  if (env["CODEX_VERSION"] || env["CODEX_CLI"] || env["CODEX"]) return "codex";
  return undefined;
}

export function extractResetTime(metric: NormalizedQuotaMetric): string | undefined {
  const p = metric.rawPayload;
  if (!p || typeof p !== "object") return undefined;
  const findReset = (obj: unknown): string | undefined => {
    if (!obj || typeof obj !== "object") return undefined;
    const r = obj as Record<string, unknown>;
    if (typeof r["resetTime"] === "string" && r["resetTime"].trim()) return r["resetTime"].trim();
    if (typeof r["reset_time"] === "string" && r["reset_time"].trim()) return r["reset_time"].trim();
    return undefined;
  };
  const rec = p as Record<string, unknown>;
  const direct = findReset(rec);
  if (direct) return direct;
  const qInfo = findReset(rec["quotaInfo"]);
  if (qInfo) return qInfo;
  const userStatus = rec["userStatus"];
  if (userStatus && typeof userStatus === "object") {
    const uRec = userStatus as Record<string, unknown>;
    const uq = findReset(uRec["quotaInfo"]);
    if (uq) return uq;
    const ur = findReset(uRec);
    if (ur) return ur;
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
  const threshold = options && typeof options.thresholdPercentage === "number" ? options.thresholdPercentage : defaults.threshold;
  const defaultSafeWindow = options && typeof options.defaultSafeWindowSeconds === "number" ? options.defaultSafeWindowSeconds : defaults.safeWindow;
  const bufferSec = options && typeof options.bufferSeconds === "number" ? options.bufferSeconds : defaults.buffer;
  const activeAgentsCount = options && typeof options.activeAgentsCount === "number" ? options.activeAgentsCount : (options && options.activeAgentIds ? options.activeAgentIds.length : 0);
  const nowMs = options && options.now !== undefined
    ? (options.now instanceof Date ? options.now.getTime() : (typeof options.now === "string" ? new Date(options.now).getTime() : options.now))
    : Date.now();

  const explicitActiveHost = options && options.activeHost ? options.activeHost.trim() : undefined;
  const summaryActiveHost = report.summary && typeof report.summary["activeHost"] === "string"
    ? (report.summary["activeHost"] as string).trim()
    : (report.summary && typeof (report.summary as Record<string, unknown>)["active_host"] === "string" ? String((report.summary as Record<string, unknown>)["active_host"]).trim() : undefined);

  const env = options && options.env ? options.env : (typeof process !== "undefined" ? process.env : {});
  const detectedHost = detectActiveHost(env);
  let activeHost: string | undefined = undefined;
  let isFilteredByHost = false;
  let candidateResults = report.results;

  if (explicitActiveHost) {
    candidateResults = report.results.filter((res) => isPlatformMatchingHost(res.platformId, explicitActiveHost));
    activeHost = explicitActiveHost;
    isFilteredByHost = true;
  } else {
    const hostCandidate = summaryActiveHost || detectedHost;
    if (hostCandidate) {
      const matching = report.results.filter((res) => isPlatformMatchingHost(res.platformId, hostCandidate));
      if (matching.length > 0) {
        candidateResults = matching;
        activeHost = hostCandidate;
        isFilteredByHost = true;
      }
    }
  }

  const constrainedModels: ConstrainedModelInfo[] = [];
  let lowestRemainingQuota: number | null = null;
  let measuredObservationCount = 0;
  let hasUnmeasuredObservation = candidateResults.length === 0;

  for (const res of candidateResults) {
    if (res.isDetected !== true) {
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
      if (lowestRemainingQuota === null || remaining < lowestRemainingQuota) lowestRemainingQuota = remaining;
      if (remaining <= threshold) {
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

  const summaryRemainingQuota = report.summary ? report.summary["lowestRemainingQuota"] : undefined;
  const summaryShowsExhaustion =
    !isFilteredByHost &&
    typeof summaryRemainingQuota === "number" &&
    Number.isFinite(summaryRemainingQuota) &&
    summaryRemainingQuota <= threshold;
  if (
    summaryShowsExhaustion &&
    (lowestRemainingQuota === null || summaryRemainingQuota < lowestRemainingQuota)
  ) {
    lowestRemainingQuota = summaryRemainingQuota;
  }

  const isExhausted = constrainedModels.length > 0 || summaryShowsExhaustion;
  const isUnknown = !isExhausted && (measuredObservationCount === 0 || hasUnmeasuredObservation);
  const isTriggered = isExhausted || isUnknown;
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
      lowestRemainingQuota,
      constrainedModels: [],
      wrapUpDirectives: [],
      autoWakeSchedule: null,
      summary,
      evaluatedAt: new Date(nowMs).toISOString(),
      activeHost: activeHostVal,
    };
  }

  const wrapUpMessage = isUnknown ? UNMEASURED_QUOTA_WRAP_UP_MESSAGE : CRITICAL_WRAP_UP_MESSAGE;
  const wrapUpReason = isUnknown ? "Quota availability is unavailable or unmeasured; fail closed." : `Quota threshold breached (<=${threshold}%).`;
  const wrapUpDirectives: WrapUpDirective[] =
    options && options.activeAgentIds && options.activeAgentIds.length > 0
      ? options.activeAgentIds.map((agentId) => ({ recipient: agentId, message: wrapUpMessage, action: "idle" as const, forbidKill: true as const, reason: wrapUpReason }))
      : [{ recipient: "all_active_agents", message: wrapUpMessage, action: "idle" as const, forbidKill: true as const, reason: wrapUpReason }];

  const validResetDates: Date[] = [];
  for (const model of constrainedModels) {
    if (model.resetTime) {
      const parsed = new Date(model.resetTime);
      if (!isNaN(parsed.getTime())) validResetDates.push(parsed);
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
    ? `⚠️ Quota availability is unavailable or unmeasured. ${lowestRemainingQuota !== null ? `Lowest measured quota: ${lowestRemainingQuota.toFixed(2)}%. ` : "No trustworthy quota percentage was observed. "}Auto-wake in ${durationSeconds}s at ${autoWakeSchedule.targetWakeupIso}.`
    : `🚨 CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<10%). Lowest quota: ${lowestRemainingQuota !== null ? `${lowestRemainingQuota.toFixed(2)}%` : "unknown"}. ${constrainedModels.length} constrained models. Auto-wake in ${durationSeconds}s at ${autoWakeSchedule.targetWakeupIso}.`;

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
    activeHost: activeHostVal,
  };
}
