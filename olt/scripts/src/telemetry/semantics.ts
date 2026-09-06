import { HarnessError } from "../core/errors/index.ts";
import type { NormalizedQuotaMetric } from "./types.ts";

export function isRemainingQuotaSemanticsValid(metric: NormalizedQuotaMetric): boolean {
  return (
    typeof metric.remainingPercentage === "number" &&
    Number.isFinite(metric.remainingPercentage) &&
    metric.remainingPercentage >= 0 &&
    metric.remainingPercentage <= 100
  );
}

export function assertRemainingQuotaSemantics(metric: NormalizedQuotaMetric): void {
  if (metric.remainingPercentage === null) {
    return;
  }
  if (!isRemainingQuotaSemanticsValid(metric)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid remaining quota semantics for metric '${metric.rawMetricName}' (${metric.canonicalProvider}): quota remaining percentage (${metric.remainingPercentage}) must be between 0% (exhausted) and 100% (full headroom).`,
    );
  }
}

export function usageToRemainingHeadroom(usedPercentage: number): number {
  return Math.max(0, Math.min(100, 100 - usedPercentage));
}

export function normalizeRemainingQuota(quota: number): number {
  return Math.max(0, Math.min(100, quota));
}
