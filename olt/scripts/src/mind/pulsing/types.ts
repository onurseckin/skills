import type {
  AutoWakeSchedulePayload,
  CircuitBreakerEvaluation,
} from "../../telemetry/circuit-breaker-evaluator.ts";
import type { NormalizedQuotaMetric, UnifiedTelemetryReport } from "../../telemetry/types.ts";

export type QuotaHealthStatus = "nominal" | "warning" | "critical" | "unknown";

export interface PulseQuotaMetricDetail {
  readonly modelName: string;
  readonly platformId: string;
  readonly remainingPercentage: number | null;
  readonly windowType?: string | undefined;
  readonly resetTime?: string | undefined;
  readonly isConstrained: boolean;
}

export interface PulseQuotaEvaluation {
  readonly activeHost: string;
  readonly status: QuotaHealthStatus;
  readonly isCircuitBreakerTripped: boolean;
  readonly lowestRemainingQuota: number | null;
  readonly thresholdPercentage: number;
  readonly constrainedModels: readonly string[];
  readonly autoWakeSchedule?: AutoWakeSchedulePayload | undefined;
  readonly metrics: readonly PulseQuotaMetricDetail[];
  readonly telemetryReport?: UnifiedTelemetryReport | undefined;
  readonly circuitBreakerEvaluation?: CircuitBreakerEvaluation | undefined;
  readonly checkedAt: string;
  readonly warningMessages: readonly string[];
}

export interface PulseQuotaBadgeOptions {
  readonly includeHost?: boolean | undefined;
  readonly includeProgressBar?: boolean | undefined;
  readonly includeStatus?: boolean | undefined;
  readonly includeResetTime?: boolean | undefined;
  readonly compact?: boolean | undefined;
}

export interface MindPulseQuotaOptions {
  readonly runRoot?: string | undefined;
  readonly actor?: string | undefined;
  readonly host?: string | undefined;
  readonly thresholdPercentage?: number | undefined;
  readonly forceProbe?: boolean | undefined;
  readonly cachedReport?: UnifiedTelemetryReport | undefined;
}

export interface PulseSupervisoryCadenceOptions {
  readonly runRoot: string;
  readonly repoRoot?: string | undefined;
  readonly baseIntervalMs: number;
  readonly actor?: string | undefined;
  readonly host?: string | undefined;
  readonly forceProbe?: boolean | undefined;
  readonly captureSnapshotOnFreeze?: boolean | undefined;
  readonly thresholdPercentage?: number | undefined;
  readonly cachedReport?: UnifiedTelemetryReport | undefined;
}

export interface SupervisoryCadenceResult {
  readonly shouldFreeze: boolean;
  readonly nextScheduledIntervalMs: number;
  readonly nextWakeAt: string;
  readonly quotaEvaluation: PulseQuotaEvaluation;
  readonly badges: readonly string[];
  readonly bannerMarkdown: string;
  readonly wrapUpDirectives: readonly string[];
  readonly snapshotCaptured: boolean;
  readonly snapshotPath?: string | undefined;
}
