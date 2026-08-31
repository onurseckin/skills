import { resolveHostProviderLoose } from "../../core/config/host-canon.ts";
import { DEFAULT_QUOTA_THRESHOLD } from "../../telemetry/circuit-breaker-evaluator.ts";
import { TelemetryNormalizationEngine } from "../../telemetry/engine.ts";
import type { UnifiedTelemetryReport } from "../../telemetry/types.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface QuotaHealthCheckOptions {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly repoRoot?: string | undefined;
  readonly host?: string | undefined;
  readonly thresholdPercentage?: number | undefined;
  readonly report?: UnifiedTelemetryReport | undefined;
  readonly quota?: number | null | undefined;
}

function canonicalHostMatch(platformId: string, activeHost: string): boolean {
  if (activeHost === "unknown") return true;
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

export async function checkQuotaHealth(
  options: QuotaHealthCheckOptions = {},
): Promise<DoctorCheckEngineResult> {
  const threshold =
    typeof options.thresholdPercentage === "number"
      ? options.thresholdPercentage
      : DEFAULT_QUOTA_THRESHOLD;

  const resolvedHost = resolveHostProviderLoose(options.host);
  const host =
    typeof resolvedHost === "string" && resolvedHost.length > 0
      ? resolvedHost
      : "unknown";

  const findings: DoctorDiagnosticFinding[] = [];

  let report = options.report;
  if (!report && options.quota === undefined) {
    try {
      const engine = new TelemetryNormalizationEngine();
      report = await engine.probeAll();
    } catch {
      // Non-fatal probe failure
    }
  }

  let lowestQuota = typeof options.quota === "number" ? options.quota : null;
  let activeModel: string | undefined;

  if (report) {
    for (const res of report.results) {
      const isMatch = canonicalHostMatch(res.platformId, host);
      if (!isMatch) continue;
      if (!res.isDetected) continue;
      for (const m of res.metrics) {
        if (m.remainingPercentage !== null) {
          if (lowestQuota === null) {
            lowestQuota = m.remainingPercentage;
            activeModel = m.rawMetricName;
          } else if (m.remainingPercentage < lowestQuota) {
            lowestQuota = m.remainingPercentage;
            activeModel = m.rawMetricName;
          }
        }
      }
    }
  }

  if (lowestQuota !== null) {
    if (lowestQuota <= threshold) {
      findings.push({
        code: "QUOTA_CRITICAL_BREAKER_TRIPPED",
        severity: "ERROR",
        engine: "checkQuotaHealth",
        message: `Active host '${host}' quota critically depleted (${lowestQuota.toFixed(2)}% remaining <= ${threshold}% threshold). Circuit breaker tripped.`,
        details: { host, lowestQuota, threshold, activeModel },
      });
    } else if (lowestQuota < 20.0) {
      findings.push({
        code: "QUOTA_LOW_WARNING",
        severity: "WARN",
        engine: "checkQuotaHealth",
        message: `Active host '${host}' quota running low (${lowestQuota.toFixed(2)}% remaining). Recommend conservative dispatch.`,
        details: { host, lowestQuota, threshold, activeModel },
      });
    } else {
      findings.push({
        code: "QUOTA_NOMINAL_HEALTHY",
        severity: "INFO",
        engine: "checkQuotaHealth",
        message: `Active host '${host}' quota is nominal (${lowestQuota.toFixed(2)}% remaining).`,
        details: { host, lowestQuota, threshold, activeModel },
      });
    }
  } else {
    findings.push({
      code: "QUOTA_UNKNOWN_UNMEASURED",
      severity: "INFO",
      engine: "checkQuotaHealth",
      message: `Active host '${host}' quota is unmeasured or telemetry probe returned no quota data.`,
      details: { host, threshold },
    });
  }

  const passed = !findings.some((f) => f.severity === "ERROR");

  return {
    engine: "checkQuotaHealth",
    passed,
    findings,
  };
}
