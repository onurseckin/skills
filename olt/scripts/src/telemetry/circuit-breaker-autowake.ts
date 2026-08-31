import type { NormalizedQuotaMetric } from "./types.ts";
import type {
  AutoWakeSchedulePayload,
  ConstrainedModelInfo,
  QuotaCircuitBreakerOptions,
} from "./circuit-breaker-evaluator.ts";

export const AUTO_WAKE_PROMPT =
  "Quota limit refreshed (+1m buffer). Resuming autonomous execution from idle state.";

export function extractResetTime(metric: NormalizedQuotaMetric): string | undefined {
  const p = metric.rawPayload as Record<string, unknown>;
  if (!p || typeof p !== "object") return undefined;
  const f = (o?: unknown): string | undefined => {
    if (typeof o !== "object" || !o) return undefined;
    const r = o as Record<string, unknown>;
    if (typeof r["resetTime"] === "string") return r["resetTime"] as string;
    if (typeof r["reset_time"] === "string") return r["reset_time"] as string;
    if (typeof r["retry-after"] === "string" || typeof r["retry-after"] === "number")
      return String(r["retry-after"]);
    if (typeof r["x-ratelimit-reset"] === "string" || typeof r["x-ratelimit-reset"] === "number") {
      const val = Number(r["x-ratelimit-reset"]);
      if (Number.isFinite(val)) return new Date(val > 1e11 ? val : val * 1000).toISOString();
    }
    return undefined;
  };
  return (
    f(p) ||
    f(p["quotaInfo"]) ||
    f((p["userStatus"] as Record<string, unknown> | undefined)?.["quotaInfo"]) ||
    f(p["userStatus"])
  );
}

export function computeAutoWakeSchedule(
  constrainedModels: ConstrainedModelInfo[],
  nowMs: number,
  bufferSec: number,
  defaultSafeWindow: number,
  options?: QuotaCircuitBreakerOptions,
): AutoWakeSchedulePayload {
  const activeAgentsCount = options?.activeAgentsCount ?? options?.activeAgentIds?.length ?? 0;
  const validResetDates: Date[] = [];
  for (const model of constrainedModels) {
    if (model.resetTime) {
      const parsed = isNaN(Number(model.resetTime))
        ? new Date(model.resetTime)
        : new Date(nowMs + Number(model.resetTime) * 1000);
      if (!isNaN(parsed.getTime())) validResetDates.push(parsed);
    }
  }

  let baseDurationSec: number;
  if (validResetDates.length > 0) {
    validResetDates.sort((a, b) => a.getTime() - b.getTime());
    const earliestResetDate = validResetDates[0]!;
    const diffSeconds = Math.ceil((earliestResetDate.getTime() + bufferSec * 1000 - nowMs) / 1000);
    baseDurationSec = Math.max(bufferSec, diffSeconds);
  } else {
    baseDurationSec = defaultSafeWindow + bufferSec;
  }

  let jitterSeconds = 0;
  const shouldApplyJitter =
    options?.enableJitter === true ||
    options?.jitter === true ||
    options?.jitterFactor !== undefined ||
    options?.jitterSeed !== undefined ||
    options?.jitterSeconds !== undefined;

  if (shouldApplyJitter && options?.disableJitter !== true) {
    if (options?.jitterSeconds !== undefined) {
      jitterSeconds = options.jitterSeconds;
    } else {
      const jitterFactor = options?.jitterFactor ?? 0.15;
      const randomVal =
        options?.jitterSeed !== undefined ? (Math.sin(options.jitterSeed) + 1) / 2 : Math.random();
      const rawJitter = Math.floor(randomVal * (baseDurationSec * jitterFactor + 5));
      const agentOffset =
        options?.agentIndex !== undefined
          ? (options.agentIndex % Math.max(1, activeAgentsCount)) * 5
          : 0;
      jitterSeconds = rawJitter + agentOffset;
    }
  }

  const finalDurationSec = baseDurationSec + jitterSeconds;
  const targetWakeupMs = nowMs + finalDurationSec * 1000;

  return {
    type: "one_shot_timer",
    durationSeconds: finalDurationSec,
    targetWakeupIso: new Date(targetWakeupMs).toISOString(),
    prompt: AUTO_WAKE_PROMPT,
    timerCondition: "never",
    activeAgentsCount,
    jitterSeconds: jitterSeconds > 0 ? jitterSeconds : undefined,
  };
}
