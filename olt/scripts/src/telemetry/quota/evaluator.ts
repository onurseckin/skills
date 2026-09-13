/**
 * Quota Evaluator: pure evaluator for quota telemetry and circuit-breaking decisions.
 * Invariants: 0 any, 0 suppressions, <= 400 lines.
 */

import {
  CRITICAL_WRAP_UP_MESSAGE,
  DEFAULT_FREEZE_THRESHOLD,
  DEFAULT_RECOVERY_THRESHOLD,
  DEFAULT_WARNING_THRESHOLD,
  type ConstrainedModelInfo,
  type QuotaEvaluationVerdict,
  type QuotaMetric,
  type QuotaStatus,
  type QuotaThresholdConfig,
} from "./types.ts";

export interface EvaluatorContext {
  readonly isCurrentlyFrozen?: boolean | undefined;
  readonly failClosed?: boolean | undefined;
}

export function normalizePercentage(val: number): number {
  if (!Number.isFinite(val) || Number.isNaN(val)) return 0;
  return Math.round(Math.max(0, Math.min(100, val)) * 100) / 100;
}

export function parseRawPercentage(val: unknown): number | undefined {
  if (typeof val !== "number" || Number.isNaN(val) || !Number.isFinite(val)) return undefined;
  return normalizePercentage(val > 0 && val <= 1.0 ? val * 100 : val);
}

function extractMetricPercentage(record: Record<string, unknown>): number | undefined {
  const fields = [
    "remainingPercentage",
    "remainingPercent",
    "quotaPercentage",
    "quota_percentage",
    "remaining_percentage",
    "lowestRemainingQuota",
  ];
  for (const f of fields) {
    const p = parseRawPercentage(record[f]);
    if (p !== undefined) return p;
  }
  const frac = record["remainingFraction"];
  if (typeof frac === "number" && Number.isFinite(frac)) return normalizePercentage(frac * 100);

  const rem = record["remaining"];
  const tot = record["total"];
  if (typeof rem === "number" && typeof tot === "number" && tot > 0) {
    return normalizePercentage((rem / tot) * 100);
  }
  const used = record["used"];
  if (typeof used === "number" && typeof tot === "number" && tot > 0) {
    return normalizePercentage(Math.max(0, ((tot - used) / tot) * 100));
  }
  return undefined;
}

export function extractResetTime(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const r = input as Record<string, unknown>;

  const check = (v: unknown): string | undefined => {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return new Date(v > 1e11 ? v : v * 1000).toISOString();
    }
    return undefined;
  };

  const direct =
    check(r["resetTime"]) ??
    check(r["reset_time"]) ??
    check(r["retry-after"]) ??
    check(r["retryAfter"]) ??
    check(r["x-ratelimit-reset"]);
  if (direct) return direct;

  for (const key of ["rawPayload", "quotaInfo", "userStatus"]) {
    const nested = r[key];
    if (nested && typeof nested === "object") {
      const res = extractResetTime(nested);
      if (res) return res;
    }
  }
  return undefined;
}

export function evaluateQuotaState(
  input: unknown,
  thresholds?: Partial<QuotaThresholdConfig>,
  context?: EvaluatorContext,
): QuotaEvaluationVerdict {
  const freezeThresh = normalizePercentage(
    thresholds?.freezeThresholdPercentage ?? DEFAULT_FREEZE_THRESHOLD,
  );
  const warnThresh = normalizePercentage(
    thresholds?.warningThresholdPercentage ?? DEFAULT_WARNING_THRESHOLD,
  );
  const recovThresh = normalizePercentage(
    thresholds?.recoveryThresholdPercentage ?? DEFAULT_RECOVERY_THRESHOLD,
  );
  const failClosed = thresholds?.failClosed ?? context?.failClosed ?? true;
  const isFrozen = context?.isCurrentlyFrozen ?? false;
  const checkedAt = new Date().toISOString();

  if (typeof input === "number") {
    const remaining = parseRawPercentage(input);
    if (remaining === undefined) {
      return buildVerdict({
        shouldFreeze: failClosed,
        status: failClosed ? "CRITICAL_FREEZE" : "WARNING",
        remaining: 0,
        freezeThresh,
        recovThresh,
        checkedAt,
        reason: "Invalid non-finite number provided as quota",
      });
    }
    return resolveSingleVerdict(
      remaining,
      freezeThresh,
      warnThresh,
      recovThresh,
      isFrozen,
      checkedAt,
    );
  }

  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    const directPercentage = extractMetricPercentage(record);
    const directResetTime = extractResetTime(record);

    const metrics: QuotaMetric[] = [];
    if (Array.isArray(record["metrics"])) {
      for (const m of record["metrics"] as readonly unknown[]) {
        if (typeof m === "object" && m !== null) metrics.push(m as QuotaMetric);
      }
    }
    if (Array.isArray(record["results"])) {
      for (const res of record["results"] as readonly unknown[]) {
        if (typeof res === "object" && res !== null) {
          const sub = (res as Record<string, unknown>)["metrics"];
          if (Array.isArray(sub)) {
            for (const m of sub as readonly unknown[]) {
              if (typeof m === "object" && m !== null) metrics.push(m as QuotaMetric);
            }
          }
        }
      }
    }

    if (metrics.length === 0 && directPercentage !== undefined) {
      const modelName = typeof record["modelName"] === "string" ? record["modelName"] : undefined;
      const platformId =
        typeof record["platformId"] === "string" ? record["platformId"] : undefined;
      const constrained: ConstrainedModelInfo | undefined =
        modelName || platformId
          ? {
              modelName: modelName ?? "default",
              platformId: platformId ?? "host",
              remainingPercentage: directPercentage,
              resetTime: directResetTime,
            }
          : undefined;

      return resolveSingleVerdict(
        directPercentage,
        freezeThresh,
        warnThresh,
        recovThresh,
        isFrozen,
        checkedAt,
        directResetTime,
        constrained,
      );
    }

    if (metrics.length > 0) {
      return evaluateMultiModelMetrics(
        metrics,
        freezeThresh,
        warnThresh,
        recovThresh,
        isFrozen,
        checkedAt,
        failClosed,
      );
    }
  }

  return buildVerdict({
    shouldFreeze: failClosed,
    status: failClosed ? "CRITICAL_FREEZE" : "WARNING",
    remaining: 0,
    freezeThresh,
    recovThresh,
    checkedAt,
    reason: `Quota unmeasured or missing telemetry (${failClosed ? "fail-closed" : "fail-open"})`,
  });
}

function evaluateMultiModelMetrics(
  metrics: readonly QuotaMetric[],
  freezeThresh: number,
  warnThresh: number,
  recovThresh: number,
  isFrozen: boolean,
  checkedAt: string,
  failClosed: boolean,
): QuotaEvaluationVerdict {
  const measured: ConstrainedModelInfo[] = [];
  const unmeasured: string[] = [];

  for (const m of metrics) {
    const rec = m as Record<string, unknown>;
    const modelName =
      typeof rec["modelName"] === "string"
        ? rec["modelName"]
        : typeof rec["model"] === "string"
          ? rec["model"]
          : typeof rec["name"] === "string"
            ? rec["name"]
            : "unknown-model";
    const platformId =
      typeof rec["platformId"] === "string"
        ? rec["platformId"]
        : typeof rec["platform"] === "string"
          ? rec["platform"]
          : "host";
    const p = extractMetricPercentage(rec);
    const resetTime = extractResetTime(rec);

    if (p !== undefined) {
      measured.push({ modelName, platformId, remainingPercentage: p, resetTime });
    } else {
      unmeasured.push(modelName);
    }
  }

  if (measured.length === 0) {
    return buildVerdict({
      shouldFreeze: failClosed,
      status: failClosed ? "CRITICAL_FREEZE" : "WARNING",
      remaining: 0,
      freezeThresh,
      recovThresh,
      checkedAt,
      reason: `All ${metrics.length} models lack measurable quota metrics (${failClosed ? "fail-closed" : "fail-open"})`,
      unmeasuredModels: unmeasured.length > 0 ? unmeasured : undefined,
    });
  }

  let constrained = measured[0]!;
  for (let i = 1; i < measured.length; i++) {
    if (measured[i]!.remainingPercentage < constrained.remainingPercentage) {
      constrained = measured[i]!;
    }
  }

  return resolveSingleVerdict(
    constrained.remainingPercentage,
    freezeThresh,
    warnThresh,
    recovThresh,
    isFrozen,
    checkedAt,
    constrained.resetTime,
    constrained,
    unmeasured.length > 0 ? unmeasured : undefined,
  );
}

function resolveSingleVerdict(
  remaining: number,
  freezeThresh: number,
  warnThresh: number,
  recovThresh: number,
  isFrozen: boolean,
  checkedAt: string,
  resetTime?: string,
  constrainedModel?: ConstrainedModelInfo,
  unmeasuredModels?: readonly string[],
): QuotaEvaluationVerdict {
  let shouldFreeze: boolean;
  let status: QuotaStatus;
  let reason: string | undefined;

  if (isFrozen) {
    if (remaining >= recovThresh) {
      shouldFreeze = false;
      status = remaining <= warnThresh ? "WARNING" : "HEALTHY";
      reason = `Quota recovered to ${remaining.toFixed(2)}% (>= recovery threshold ${recovThresh.toFixed(2)}%)`;
    } else {
      shouldFreeze = true;
      status = "CRITICAL_FREEZE";
      reason = `Quota at ${remaining.toFixed(2)}% has not yet reached recovery threshold ${recovThresh.toFixed(2)}%`;
    }
  } else {
    if (remaining < freezeThresh) {
      shouldFreeze = true;
      status = "CRITICAL_FREEZE";
      reason = `Remaining quota ${remaining.toFixed(2)}% is strictly below freeze threshold ${freezeThresh.toFixed(2)}%`;
    } else if (remaining <= warnThresh) {
      shouldFreeze = false;
      status = "WARNING";
      reason = `Remaining quota ${remaining.toFixed(2)}% is in warning range (<= ${warnThresh.toFixed(2)}%)`;
    } else {
      shouldFreeze = false;
      status = "HEALTHY";
      reason = undefined;
    }
  }

  return buildVerdict({
    shouldFreeze,
    status,
    remaining,
    freezeThresh,
    recovThresh,
    checkedAt,
    resetTime,
    constrainedModel,
    unmeasuredModels,
    reason,
  });
}

function buildVerdict(params: {
  shouldFreeze: boolean;
  status: QuotaStatus;
  remaining: number;
  freezeThresh: number;
  recovThresh: number;
  checkedAt: string;
  resetTime?: string | undefined;
  constrainedModel?: ConstrainedModelInfo | undefined;
  unmeasuredModels?: readonly string[] | undefined;
  reason?: string | undefined;
}): QuotaEvaluationVerdict {
  return {
    tripped: params.shouldFreeze,
    shouldFreeze: params.shouldFreeze,
    status: params.status,
    remainingPercentage: params.remaining,
    thresholdPercentage: params.freezeThresh,
    recoveryThresholdPercentage: params.recovThresh,
    constrainedModel: params.constrainedModel,
    unmeasuredModels: params.unmeasuredModels,
    reason: params.reason,
    directive: params.shouldFreeze ? CRITICAL_WRAP_UP_MESSAGE : undefined,
    resetTime: params.resetTime,
    checkedAt: params.checkedAt,
  };
}
