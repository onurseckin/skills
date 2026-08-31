import { detectHostApp } from "../../authority/thread/context.ts";
import {
  DEFAULT_QUOTA_THRESHOLD,
  QuotaCircuitBreaker,
  type CircuitBreakerEvaluation,
  type CircuitBreakerStatus,
} from "../../telemetry/circuit-breaker.ts";
import {
  createDefaultCollectors,
  type CollectorEnvironment,
} from "../../telemetry/collectors/index.ts";
import { formatPreciseProgressBar, TelemetryNormalizationEngine } from "../../telemetry/engine.ts";
import type { UnifiedTelemetryReport } from "../../telemetry/types.ts";

export interface ProbeLifecycleQuotaOptions {
  readonly host?: string | undefined;
  readonly activeAgentsCount?: number | undefined;
  readonly thresholdPercentage?: number | undefined;
  readonly env?: CollectorEnvironment | undefined;
  readonly detailed?: boolean | undefined;
}

export interface LifecycleQuotaTelemetry {
  readonly report: UnifiedTelemetryReport;
  readonly evaluation: CircuitBreakerEvaluation;
  readonly activeHost: string;
  readonly quotaBadge: string;
  readonly lowestQuotaPercentage: number | null;
  readonly isTriggered: boolean;
  readonly status: CircuitBreakerStatus;
  readonly warning?: string | undefined;
}

export function formatQuotaBadge(remainingPercentage: number | null, width = 6): string {
  if (remainingPercentage === null) {
    return "[░░░░░░] Unmeasured";
  }
  return formatPreciseProgressBar(remainingPercentage, width);
}

export function formatQuotaTelemetryLine(telemetry: LifecycleQuotaTelemetry): string {
  return `- **Quota Telemetry**: ${telemetry.quotaBadge} (${telemetry.activeHost}) · Status: ${telemetry.status}`;
}

export async function probeLiveQuotaTelemetry(
  options: ProbeLifecycleQuotaOptions = {},
): Promise<LifecycleQuotaTelemetry> {
  const env = options.env;
  const processEnvironment =
    env !== undefined && env.env !== undefined
      ? env.env
      : typeof process !== "undefined"
        ? process.env
        : {};
  const detectedHost =
    options.host !== undefined ? options.host : detectHostApp(processEnvironment);
  const thresholdPercentage =
    options.thresholdPercentage !== undefined
      ? options.thresholdPercentage
      : DEFAULT_QUOTA_THRESHOLD;
  const activeAgentsCount =
    options.activeAgentsCount !== undefined ? options.activeAgentsCount : 0;

  try {
    const collectors = createDefaultCollectors(env);
    const engine = new TelemetryNormalizationEngine(collectors);
    const report = await engine.probeAll();

    const breaker = new QuotaCircuitBreaker({ thresholdPercentage });
    const evaluation = breaker.evaluate(report, {
      thresholdPercentage,
      activeAgentsCount,
    });

    const lowestQuota = evaluation.lowestRemainingQuota;
    const badge = formatQuotaBadge(lowestQuota);
    const warning = evaluation.isTriggered
      ? `Quota circuit breaker triggered (${lowestQuota !== null ? `${lowestQuota.toFixed(1)}%` : "unknown"} <= ${thresholdPercentage}%)`
      : undefined;

    return {
      report,
      evaluation,
      activeHost: detectedHost,
      quotaBadge: badge,
      lowestQuotaPercentage: lowestQuota,
      isTriggered: evaluation.isTriggered,
      status: evaluation.status,
      ...(warning !== undefined ? { warning } : {}),
    };
  } catch {
    const fallbackReport: UnifiedTelemetryReport = {
      timestamp: new Date().toISOString(),
      results: [],
      summary: { fallback: true },
    };
    const fallbackEvaluation: CircuitBreakerEvaluation = {
      status: "OK",
      isTriggered: false,
      thresholdPercentage,
      lowestRemainingQuota: null,
      constrainedModels: [],
      wrapUpDirectives: [],
      autoWakeSchedule: null,
      summary: "Quota telemetry unmeasured (fallback)",
      evaluatedAt: new Date().toISOString(),
    };

    return {
      report: fallbackReport,
      evaluation: fallbackEvaluation,
      activeHost: detectedHost,
      quotaBadge: "[░░░░░░] Unmeasured",
      lowestQuotaPercentage: null,
      isTriggered: false,
      status: "OK",
    };
  }
}
