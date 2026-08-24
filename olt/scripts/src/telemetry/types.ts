export type TierType = "tier1_cli_command" | "tier2_local_storage" | "tier3_runtime";

export type ConfidenceLevel =
  | "verified_exact"
  | "cached"
  | "inferred_metric"
  | "inferred"
  | "heuristic"
  | "unknown";

export interface NormalizedQuotaMetric {
  rawMetricName: string;
  canonicalProvider: string;
  windowType: string;
  remainingPercentage: number;
  sourceTier: TierType;
  confidence: ConfidenceLevel;
  rawPayload: Record<string, unknown>;
}

export interface PlatformProbeResult {
  platformId: string;
  isDetected: boolean;
  primaryTierUsed: TierType | null;
  metrics: NormalizedQuotaMetric[];
  rawObservations: Record<string, unknown>;
  errors: Error[];
  reason?: string | undefined;
}

export interface UnifiedTelemetryReport {
  timestamp: string;
  results: PlatformProbeResult[];
  summary: Record<string, unknown>;
}
