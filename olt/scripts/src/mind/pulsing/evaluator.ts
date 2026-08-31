import { resolveHostProviderLoose } from "../../core/config/host-canon.ts";
import {
  DEFAULT_QUOTA_THRESHOLD,
  evaluateCircuitBreaker,
  extractResetTime,
} from "../../telemetry/circuit-breaker-evaluator.ts";
import { TelemetryNormalizationEngine } from "../../telemetry/engine.ts";
import type { PlatformProbeResult, UnifiedTelemetryReport } from "../../telemetry/types.ts";
import type {
  MindPulseQuotaOptions,
  PulseQuotaEvaluation,
  PulseQuotaMetricDetail,
  QuotaHealthStatus,
} from "./types.ts";

function canonicalHostMatch(platformId: string, activeHost: string): boolean {
  if (platformId === activeHost) return true;
  const pLower = platformId.toLowerCase().replace(/[-_]/g, "");
  const hLower = activeHost.toLowerCase().replace(/[-_]/g, "");
  if (pLower === hLower) return true;
  if (hLower.includes("claude") && pLower.includes("claude")) return true;
  if (hLower.includes("cursor") && pLower.includes("cursor")) return true;
  if (hLower.includes("codex")) {
    if (pLower.includes("codex")) return true;
    if (pLower.includes("openai")) return true;
  }
  if (hLower.includes("antigravity") && pLower.includes("antigravity")) return true;
  return false;
}

export async function evaluateMindPulseQuota(
  options: MindPulseQuotaOptions = {},
): Promise<PulseQuotaEvaluation> {
  const thresholdPercentage =
    typeof options.thresholdPercentage === "number"
      ? options.thresholdPercentage
      : DEFAULT_QUOTA_THRESHOLD;

  const resolvedHost = resolveHostProviderLoose(options.host);
  const activeHost =
    typeof resolvedHost === "string" && resolvedHost.length > 0
      ? resolvedHost
      : "unknown";

  let report: UnifiedTelemetryReport;
  if (options.cachedReport) {
    report = options.cachedReport;
  } else {
    const engine = new TelemetryNormalizationEngine();
    report = await engine.probeAll();
  }

  const matchingResults: PlatformProbeResult[] = [];
  const otherResults: PlatformProbeResult[] = [];

  for (const res of report.results) {
    if (canonicalHostMatch(res.platformId, activeHost)) {
      matchingResults.push(res);
    } else {
      otherResults.push(res);
    }
  }

  let targetResults: PlatformProbeResult[];
  if (matchingResults.length > 0) {
    targetResults = matchingResults;
  } else if (activeHost === "unknown") {
    targetResults = report.results;
  } else {
    targetResults = [];
  }

  const metricsDetails: PulseQuotaMetricDetail[] = [];
  let lowestQuota: number | null = null;
  const constrainedModels: string[] = [];
  const warningMessages: string[] = [];
  let resetTimeForLowest: string | undefined;

  for (const probeRes of targetResults) {
    if (!probeRes.isDetected) continue;
    for (const m of probeRes.metrics) {
      const modelName = typeof m.rawMetricName === "string" ? m.rawMetricName : "unknown";
      const remaining = m.remainingPercentage;
      const isConstrained = remaining !== null && remaining <= thresholdPercentage;

      if (isConstrained) {
        constrainedModels.push(modelName);
      }

      if (remaining !== null) {
        if (lowestQuota === null) {
          lowestQuota = remaining;
          resetTimeForLowest = extractResetTime(m);
        } else if (remaining < lowestQuota) {
          lowestQuota = remaining;
          resetTimeForLowest = extractResetTime(m);
        }
      }

      metricsDetails.push({
        modelName,
        platformId: probeRes.platformId,
        remainingPercentage: remaining,
        windowType: m.windowType,
        resetTime: extractResetTime(m),
        isConstrained,
      });
    }
  }

  let status: QuotaHealthStatus = "unknown";
  let isCircuitBreakerTripped = false;

  if (lowestQuota !== null) {
    if (lowestQuota <= thresholdPercentage) {
      status = "critical";
      isCircuitBreakerTripped = true;
      warningMessages.push(
        `Critical active host quota breach: ${lowestQuota.toFixed(2)}% remaining (<= ${thresholdPercentage}% threshold)`,
      );
    } else if (lowestQuota < 20.0) {
      status = "warning";
      warningMessages.push(`Low quota warning on ${activeHost}: ${lowestQuota.toFixed(2)}% remaining`);
    } else {
      status = "nominal";
    }
  }

  const circuitBreakerEval = evaluateCircuitBreaker(report, {
    thresholdPercentage,
    activeHost,
  });

  const autoWake =
    circuitBreakerEval.autoWakeSchedule !== null &&
    typeof circuitBreakerEval.autoWakeSchedule !== "undefined"
      ? circuitBreakerEval.autoWakeSchedule
      : undefined;

  return {
    activeHost,
    status,
    isCircuitBreakerTripped,
    lowestRemainingQuota: lowestQuota,
    thresholdPercentage,
    constrainedModels,
    autoWakeSchedule: autoWake,
    metrics: metricsDetails,
    telemetryReport: report,
    circuitBreakerEvaluation: circuitBreakerEval,
    checkedAt: new Date().toISOString(),
    warningMessages,
  };
}

export function checkPulseQuotaFreeze(evaluation: PulseQuotaEvaluation): boolean {
  if (evaluation.isCircuitBreakerTripped) return true;
  if (evaluation.status === "critical") return true;
  return false;
}
