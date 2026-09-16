import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot, resolveOltDir } from "../../core/shared/index.ts";
import { detectHostApp } from "../../authority/thread/context.ts";
import {
  DEFAULT_QUOTA_THRESHOLD,
  QuotaCircuitBreaker,
  type CircuitBreakerEvaluation,
  type CircuitBreakerStatus,
} from "../../telemetry/circuit-breaker.ts";
import {
  createDefaultCollectors,
  isPlatformMatchingHost,
  type CollectorEnvironment,
} from "../../telemetry/collectors/index.ts";
import { formatPreciseProgressBar, TelemetryNormalizationEngine } from "../../telemetry/engine.ts";
import type { PlatformProbeResult, UnifiedTelemetryReport } from "../../telemetry/types.ts";
import {
  bootstrapTelemetryQuota,
  readCurrentQuota,
  updateCachedTelemetryQuota,
} from "../../orchestrator/lifecycle/index.ts";

export interface ProbeLifecycleQuotaOptions {
  readonly host?: string | undefined;
  readonly activeAgentsCount?: number | undefined;
  readonly thresholdPercentage?: number | undefined;
  readonly env?: CollectorEnvironment | undefined;
  readonly detailed?: boolean | undefined;
  readonly repoRoot?: string | undefined;
  readonly runRoot?: string | undefined;
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

function readTelemetryJsonlQuota(repoRoot: string): number | null {
  try {
    const oltDir = resolveOltDir(repoRoot);
    const candidates = [join(oltDir, "telemetry.jsonl"), join(repoRoot, ".olt", "telemetry.jsonl")];
    for (const filePath of candidates) {
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]?.trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (
            typeof parsed.quotaRemainingPercentage === "number" &&
            Number.isFinite(parsed.quotaRemainingPercentage)
          ) {
            return parsed.quotaRemainingPercentage;
          }
          if (
            typeof parsed.remainingPercentage === "number" &&
            Number.isFinite(parsed.remainingPercentage)
          ) {
            return parsed.remainingPercentage;
          }
        } catch {
          // Skip corrupted line
        }
      }
    }
  } catch {
    // Non-fatal
  }
  return null;
}

function readSnapshotQuota(runRoot?: string, repoRoot?: string): number | null {
  try {
    const candidates: string[] = [];
    if (runRoot) {
      candidates.push(join(runRoot, ".olt", "quota-dag-snapshot.json"));
      candidates.push(join(runRoot, "quota-dag-snapshot.json"));
    }
    if (repoRoot) {
      candidates.push(join(resolveOltDir(repoRoot), "quota-dag-snapshot.json"));
    }
    for (const filePath of candidates) {
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (
        typeof parsed.lowestQuotaObserved === "number" &&
        Number.isFinite(parsed.lowestQuotaObserved)
      ) {
        return parsed.lowestQuotaObserved;
      }
    }
  } catch {
    // Non-fatal
  }
  return null;
}

function resolveInternalStoresQuota(repoRoot?: string, runRoot?: string): number | null {
  const current = readCurrentQuota();
  if (typeof current === "number" && Number.isFinite(current)) {
    return current;
  }
  if (repoRoot) {
    const fromJsonl = readTelemetryJsonlQuota(repoRoot);
    if (fromJsonl !== null) {
      return fromJsonl;
    }
  }
  const fromSnapshot = readSnapshotQuota(runRoot, repoRoot);
  if (fromSnapshot !== null) {
    return fromSnapshot;
  }
  return null;
}

function applyInternalQuotaFallback(
  report: UnifiedTelemetryReport,
  breaker: QuotaCircuitBreaker,
  detectedHost: string,
  internalQuota: number,
  thresholdPercentage: number,
  activeAgentsCount: number,
): LifecycleQuotaTelemetry {
  updateCachedTelemetryQuota(internalQuota);
  bootstrapTelemetryQuota();

  const synthResult: PlatformProbeResult = {
    platformId: detectedHost,
    isDetected: true,
    primaryTierUsed: "tier2_local_storage",
    rawObservations: {},
    metrics: [
      {
        rawMetricName: "quota",
        canonicalProvider: detectedHost,
        windowType: "session",
        remainingPercentage: internalQuota,
        confidence: "heuristic",
        sourceTier: "tier2_local_storage",
        rawPayload: {},
      },
    ],
    errors: [],
  };

  const updatedReport: UnifiedTelemetryReport = {
    ...report,
    results: [
      ...report.results.filter((r) => !isPlatformMatchingHost(r.platformId, detectedHost)),
      synthResult,
    ],
    summary: {
      ...report.summary,
      lowestRemainingQuota: internalQuota,
      activeHost: detectedHost,
    },
  };

  const evaluation = breaker.evaluate(updatedReport, {
    thresholdPercentage,
    activeAgentsCount,
    activeHost: detectedHost,
  });

  const badge = formatQuotaBadge(internalQuota);
  const warning = evaluation.isTriggered
    ? `Quota circuit breaker triggered (${internalQuota.toFixed(1)}% <= ${thresholdPercentage}%)`
    : undefined;

  return {
    report: updatedReport,
    evaluation,
    activeHost: detectedHost,
    quotaBadge: badge,
    lowestQuotaPercentage: internalQuota,
    isTriggered: evaluation.isTriggered,
    status: evaluation.status,
    ...(warning !== undefined ? { warning } : {}),
  };
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
  const activeAgentsCount = options.activeAgentsCount !== undefined ? options.activeAgentsCount : 0;

  let repoRoot = options.repoRoot;
  if (!repoRoot) {
    try {
      repoRoot = findRepoRoot(options.runRoot ?? process.cwd());
    } catch {
      // Non-fatal
    }
  }

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
    if (lowestQuota === null) {
      const internalQuota = resolveInternalStoresQuota(repoRoot, options.runRoot);
      if (internalQuota !== null) {
        return applyInternalQuotaFallback(
          report,
          breaker,
          detectedHost,
          internalQuota,
          thresholdPercentage,
          activeAgentsCount,
        );
      }
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
        report,
        evaluation: fallbackEvaluation,
        activeHost: detectedHost,
        quotaBadge: "[░░░░░░] Unmeasured",
        lowestQuotaPercentage: null,
        isTriggered: false,
        status: "OK",
      };
    }

    updateCachedTelemetryQuota(lowestQuota);
    bootstrapTelemetryQuota();
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
    const internalQuota = resolveInternalStoresQuota(repoRoot, options.runRoot);
    if (internalQuota !== null) {
      const breaker = new QuotaCircuitBreaker({ thresholdPercentage });
      const fallbackReport: UnifiedTelemetryReport = {
        timestamp: new Date().toISOString(),
        results: [],
        summary: { fallback: true },
      };
      return applyInternalQuotaFallback(
        fallbackReport,
        breaker,
        detectedHost,
        internalQuota,
        thresholdPercentage,
        activeAgentsCount,
      );
    }

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
