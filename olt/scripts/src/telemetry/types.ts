export interface NormalizedQuotaMetric {
  rawMetricName: string;
  canonicalProvider: string;
  windowType: "burst" | "daily" | "monthly" | "lifetime" | string;
  remainingPercentage: number;
  sourceTier: "tier1_cli_command" | "tier2_local_storage" | "tier3_runtime_env" | string;
  confidence: "verified_exact" | "inferred_metric" | "low_confidence";
  rawPayload: Record<string, unknown>;
}

export interface TierResult {
  sourceTier: "tier1_cli_command" | "tier2_local_storage" | "tier3_runtime_env" | string;
  metrics: NormalizedQuotaMetric[];
  rawObservations: Record<string, unknown>;
}

export interface PlatformProbeResult {
  platformId: string;
  isDetected: boolean;
  primaryTierUsed:
    | "tier1_cli_command"
    | "tier2_local_storage"
    | "tier3_runtime_env"
    | string
    | null;
  metrics: NormalizedQuotaMetric[];
  rawObservations: Record<string, unknown>;
  errors: Error[];
}

export interface UnifiedTelemetryReport {
  timestamp: string;
  results: PlatformProbeResult[];
  summary: {
    totalPlatformsDetected: number;
    metricsExtracted: number;
  };
}

export interface TelemetryCollector {
  readonly platformId: string;
  probe(): Promise<PlatformProbeResult>;
}
