export type TierType = "tier1_cli_command" | "tier2_local_storage" | "tier3_runtime";

export type WindowType = "5_hour" | "weekly" | "session" | string;

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
  windowType: WindowType;
  remainingPercentage: number | null;
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

export type CircuitBreakerStatus =
  | "OK"
  | "QUOTA_EXHAUSTED_CIRCUIT_BROKEN"
  | "QUOTA_UNKNOWN_CIRCUIT_BROKEN";

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
