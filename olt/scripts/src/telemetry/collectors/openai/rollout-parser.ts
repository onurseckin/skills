import type { TierResult } from "../../base-collector.ts";
import type { NormalizedQuotaMetric, WindowType } from "../../types.ts";

export function parseCodexRolloutUsage(codexUsage: unknown): TierResult | null {
  if (!codexUsage) return null;
  if (typeof codexUsage !== "object") return null;
  const root = codexUsage as Record<string, unknown>;
  const payload = (
    typeof root.payload === "object" && root.payload !== null ? root.payload : root
  ) as Record<string, unknown>;
  const rateLimits = (
    typeof payload.rate_limits === "object" && payload.rate_limits !== null
      ? payload.rate_limits
      : typeof root.rate_limits === "object" && root.rate_limits !== null
        ? root.rate_limits
        : payload
  ) as Record<string, unknown>;
  const info = (
    typeof payload.info === "object" && payload.info !== null
      ? payload.info
      : typeof root.info === "object" && root.info !== null
        ? root.info
        : undefined
  ) as Record<string, unknown> | undefined;

  const totalTokenUsage = info?.total_token_usage;
  const modelContextWindow = info?.model_context_window;
  const planType =
    typeof rateLimits?.plan_type === "string"
      ? rateLimits.plan_type
      : typeof payload.plan_type === "string"
        ? payload.plan_type
        : typeof root.plan_type === "string"
          ? root.plan_type
          : "unknown";

  const primary = (
    typeof rateLimits?.primary === "object" && rateLimits.primary !== null
      ? rateLimits.primary
      : rateLimits
  ) as Record<string, unknown> | undefined;

  const usedPercent =
    typeof primary?.used_percent === "number"
      ? primary.used_percent
      : typeof primary?.usedPercent === "number"
        ? primary.usedPercent
        : typeof primary?.utilization === "number"
          ? primary.utilization
          : undefined;

  const windowMinutes =
    typeof primary?.window_minutes === "number"
      ? primary.window_minutes
      : typeof primary?.windowMinutes === "number"
        ? primary.windowMinutes
        : undefined;

  let resetsAtRaw: unknown = primary?.resets_at;
  if (resetsAtRaw === undefined) resetsAtRaw = primary?.resetsAt;
  if (resetsAtRaw === undefined) resetsAtRaw = primary?.resetTime;

  const resetsAtSec =
    typeof resetsAtRaw === "number"
      ? resetsAtRaw
      : typeof resetsAtRaw === "string"
        ? isNaN(Number(resetsAtRaw))
          ? Math.floor(new Date(resetsAtRaw).getTime() / 1000)
          : Number(resetsAtRaw)
        : undefined;

  const resetTimeIso =
    resetsAtSec !== undefined
      ? new Date(resetsAtSec * 1000).toISOString()
      : typeof resetsAtRaw === "string"
        ? resetsAtRaw
        : undefined;

  if (usedPercent === undefined) {
    return null;
  }

  const nowSec = Date.now() / 1000;
  let remainingPercentage: number;
  if (resetsAtSec !== undefined && nowSec >= resetsAtSec) {
    remainingPercentage = 100.0;
  } else {
    remainingPercentage = Math.max(0, Math.min(100, Math.round((100 - usedPercent) * 100) / 100));
  }

  const windowType: WindowType =
    windowMinutes === 300 ? "5_hour" : windowMinutes === 10080 ? "weekly" : "session";

  const rawMetricName =
    windowMinutes === 10080 ? "Codex (7-Day Limit)" : `OpenAI Codex (${windowType})`;

  const primaryObj = primary !== undefined ? primary : {};

  const metrics: NormalizedQuotaMetric[] = [
    {
      rawMetricName,
      canonicalProvider: "openai",
      windowType,
      remainingPercentage,
      sourceTier: "tier1_cli_command",
      confidence: "verified_exact",
      rawPayload: {
        ...primaryObj,
        used_percent: usedPercent,
        window_minutes: windowMinutes,
        resets_at: resetsAtSec,
        resetTime: resetTimeIso,
        plan_type: planType,
        planType,
        total_token_usage: totalTokenUsage,
        model_context_window: modelContextWindow,
      },
    },
  ];

  return {
    sourceTier: "tier1_cli_command",
    metrics,
    rawObservations: {
      plan_type: planType,
      planType,
      total_token_usage: totalTokenUsage,
      resets_at: resetsAtSec,
      resetTime: resetTimeIso,
      model_context_window: modelContextWindow,
      rate_limits: rateLimits,
      info,
      rawPayload: root,
    },
  };
}
