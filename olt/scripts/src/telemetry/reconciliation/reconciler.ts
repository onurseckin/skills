import type {
  MetricSourceClassification,
  NormalizedQuotaMetric,
  QuotaBindingConstraint,
  QuotaMetricCategory,
  QuotaReconciliationResult,
} from "./types.ts";

export function classifyMetricCategory(metric: NormalizedQuotaMetric): QuotaMetricCategory {
  const name = metric.rawMetricName.toLowerCase();
  const windowType = (metric.windowType ?? "").toLowerCase();

  if (
    name.includes("window") ||
    name.includes("sliding") ||
    name.includes("rate_limit") ||
    name.includes("rolling") ||
    windowType.includes("hour") ||
    windowType.includes("session")
  ) {
    return "sliding_rate_window";
  }

  if (
    name.includes("account") ||
    name.includes("credit") ||
    name.includes("monthly") ||
    name.includes("exhaustion") ||
    name.includes("balance") ||
    name.includes("plan") ||
    windowType.includes("weekly") ||
    windowType.includes("monthly")
  ) {
    return "account_level_exhaustion";
  }

  return "unknown";
}

export function classifyMetricSources(
  metrics: readonly NormalizedQuotaMetric[],
): MetricSourceClassification {
  const slidingWindow: NormalizedQuotaMetric[] = [];
  const accountLevel: NormalizedQuotaMetric[] = [];
  const unknown: NormalizedQuotaMetric[] = [];

  for (const metric of metrics) {
    const category = classifyMetricCategory(metric);
    if (category === "sliding_rate_window") {
      slidingWindow.push(metric);
    } else if (category === "account_level_exhaustion") {
      accountLevel.push(metric);
    } else {
      unknown.push(metric);
    }
  }

  return { slidingWindow, accountLevel, unknown };
}

export function reconcileQuotaSources(
  slidingWindowQuota?: number | undefined,
  accountLevelQuota?: number | undefined,
): {
  effectiveQuota: number;
  lowestQuota: number;
  bindingConstraint: QuotaBindingConstraint;
} {
  const hasSliding = typeof slidingWindowQuota === "number" && Number.isFinite(slidingWindowQuota);
  const hasAccount = typeof accountLevelQuota === "number" && Number.isFinite(accountLevelQuota);

  if (hasSliding && hasAccount) {
    const effectiveQuota = Math.min(slidingWindowQuota, accountLevelQuota);
    let bindingConstraint: QuotaBindingConstraint = "sliding_rate_window";
    if (accountLevelQuota < slidingWindowQuota) {
      bindingConstraint = "account_level_exhaustion";
    }
    return {
      effectiveQuota,
      lowestQuota: effectiveQuota,
      bindingConstraint,
    };
  }

  if (hasSliding) {
    return {
      effectiveQuota: slidingWindowQuota,
      lowestQuota: slidingWindowQuota,
      bindingConstraint: "sliding_rate_window",
    };
  }

  if (hasAccount) {
    return {
      effectiveQuota: accountLevelQuota,
      lowestQuota: accountLevelQuota,
      bindingConstraint: "account_level_exhaustion",
    };
  }

  return {
    effectiveQuota: 100,
    lowestQuota: 100,
    bindingConstraint: "none",
  };
}

export function reconcileNormalizedMetrics(
  metrics: readonly NormalizedQuotaMetric[],
): QuotaReconciliationResult {
  const classification = classifyMetricSources(metrics);

  const getLowest = (list: readonly NormalizedQuotaMetric[]): number | undefined => {
    let lowest: number | undefined;
    for (const m of list) {
      if (typeof m.remainingPercentage === "number" && Number.isFinite(m.remainingPercentage)) {
        if (lowest === undefined || m.remainingPercentage < lowest) {
          lowest = m.remainingPercentage;
        }
      }
    }
    return lowest;
  };

  const slidingWindowQuota = getLowest(classification.slidingWindow);
  const accountLevelQuota = getLowest(classification.accountLevel);
  const unknownQuota = getLowest(classification.unknown);

  const primary = reconcileQuotaSources(slidingWindowQuota, accountLevelQuota);

  let finalEffective = primary.effectiveQuota;
  let finalLowest = primary.lowestQuota;
  let finalConstraint = primary.bindingConstraint;

  if (unknownQuota !== undefined && unknownQuota < finalEffective) {
    finalEffective = unknownQuota;
    finalLowest = unknownQuota;
    if (finalConstraint === "none") {
      finalConstraint = "sliding_rate_window";
    }
  }

  return {
    bindingConstraint: finalConstraint,
    effectiveQuota: finalEffective,
    lowestQuota: finalLowest,
    slidingWindowQuota,
    accountLevelQuota,
    reconciledMetrics: metrics,
  };
}
