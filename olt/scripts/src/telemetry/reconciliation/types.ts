export type QuotaBindingConstraint = "sliding_rate_window" | "account_level_exhaustion" | "none";

export type QuotaMetricCategory = "sliding_rate_window" | "account_level_exhaustion" | "unknown";

export interface NormalizedQuotaMetric {
  readonly rawMetricName: string;
  readonly canonicalProvider?: string | undefined;
  readonly windowType?: string | undefined;
  readonly remainingPercentage: number | null;
  readonly sourceTier?: string | undefined;
  readonly confidence?: string | undefined;
  readonly rawPayload?: Record<string, unknown> | undefined;
}

export interface QuotaReconciliationResult {
  readonly bindingConstraint: QuotaBindingConstraint;
  readonly effectiveQuota: number;
  readonly lowestQuota: number;
  readonly slidingWindowQuota?: number | undefined;
  readonly accountLevelQuota?: number | undefined;
  readonly reconciledMetrics: readonly NormalizedQuotaMetric[];
}

export interface MetricSourceClassification {
  readonly slidingWindow: readonly NormalizedQuotaMetric[];
  readonly accountLevel: readonly NormalizedQuotaMetric[];
  readonly unknown: readonly NormalizedQuotaMetric[];
}
