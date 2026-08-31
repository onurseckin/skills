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

const KNOWN_PROVIDER_STEMS: readonly string[] = [
  "claude",
  "anthropic",
  "cursor",
  "codex",
  "openai",
  "chatgpt",
  "gemini",
  "antigravity",
  "deepseek",
  "ollama",
  "bedrock",
  "amazon",
  "groq",
  "mistral",
  "openrouter",
  "azure",
  "together",
  "fireworks",
  "cohere",
  "vertex",
];

function normalizeHostStem(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function canonicalHostMatch(platformId: string, activeHost: string): boolean {
  if (!activeHost || activeHost === "unknown" || !platformId) return false;
  if (platformId === activeHost) return true;

  const pNorm = normalizeHostStem(platformId);
  const hNorm = normalizeHostStem(activeHost);
  if (pNorm === hNorm) return true;
  if (pNorm.includes(hNorm) || hNorm.includes(pNorm)) return true;

  for (const stem of KNOWN_PROVIDER_STEMS) {
    if (pNorm.includes(stem) && hNorm.includes(stem)) return true;
  }

  const isCodexOrOpenAi = (s: string) =>
    s.includes("codex") || s.includes("openai") || s.includes("chatgpt");
  if (isCodexOrOpenAi(pNorm) && isCodexOrOpenAi(hNorm)) return true;

  const isGeminiOrAntigravity = (s: string) => s.includes("gemini") || s.includes("antigravity");
  if (isGeminiOrAntigravity(pNorm) && isGeminiOrAntigravity(hNorm)) return true;

  const isBedrockOrAmazon = (s: string) => s.includes("bedrock") || s.includes("amazon");
  if (isBedrockOrAmazon(pNorm) && isBedrockOrAmazon(hNorm)) return true;

  return false;
}

export async function checkQuotaHealth(
  options: QuotaHealthCheckOptions = {},
): Promise<DoctorCheckEngineResult> {
  const threshold =
    typeof options.thresholdPercentage === "number"
      ? options.thresholdPercentage
      : DEFAULT_QUOTA_THRESHOLD;

  const rawHost = typeof options.host === "string" ? options.host.trim() : "";
  const resolvedHost = rawHost.length > 0 ? resolveHostProviderLoose(rawHost) : "unknown";
  const host = resolvedHost !== "unknown" ? resolvedHost : rawHost.length > 0 ? rawHost : "unknown";

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
