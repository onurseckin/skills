// TelemetryNormalizationEngine - Host-aware live quota telemetry and cache isolation
import type { TelemetryCollector } from "./probe-interface.ts";
import type {
  NormalizedQuotaMetric,
  PlatformProbeResult,
  TierType,
  UnifiedTelemetryReport,
} from "./types.ts";
import {
  createDefaultCollectors,
  detectActiveHost,
  isPlatformMatchingHost,
  type CanonicalHost,
  type HostDetectionOptions,
  type HostDetectionResult,
  type HostDetectionSignal,
} from "./collectors/index.ts";

export function renderProgressBar(percentage: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${bar}] ${clamped}%`;
}

export function formatTierBadge(tier: TierType | null): string {
  switch (tier) {
    case "tier1_cli_command":
      return "Tier 1 (CLI)";
    case "tier2_local_storage":
      return "Tier 2 (Storage)";
    case "tier3_runtime":
      return "Tier 3 (Runtime)";
    default:
      return "None";
  }
}

export function formatPreciseProgressBar(percentage: number, width = 6): string {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const formattedPct = percentage % 1 === 0 ? `${percentage}%` : `${percentage.toFixed(2)}%`;
  return `[${bar}] ${formattedPct}`;
}

export function formatResetTime(metric: NormalizedQuotaMetric): string {
  const rawPayload = metric.rawPayload;
  let quotaInfo: Record<string, unknown> = rawPayload;
  if (typeof rawPayload.quotaInfo === "object") {
    if (rawPayload.quotaInfo !== null) {
      quotaInfo = rawPayload.quotaInfo as Record<string, unknown>;
    }
  }
  const resetTimeStr = typeof quotaInfo.resetTime === "string" ? quotaInfo.resetTime : undefined;

  if (resetTimeStr) {
    const resetDate = new Date(resetTimeStr);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();
    if (diffMs > 0) {
      const diffMins = Math.floor(diffMs / 60000);
      const hours = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      if (hours > 0) {
        return `in ${hours}h ${mins}m`;
      }
      return `in ${mins}m`;
    }
    return "Refreshed";
  }

  if (metric.windowType === "session") return "Session Active";
  if (metric.windowType === "daily") return "Daily Cached";
  return "Available";
}

export function formatTierShort(tier: TierType | null): string {
  switch (tier) {
    case "tier1_cli_command":
      return "Tier 1";
    case "tier2_local_storage":
      return "Tier 2";
    case "tier3_runtime":
      return "Tier 3";
    default:
      return "None";
  }
}

export interface TelemetryNormalizationEngineOptions {
  activeHost?: CanonicalHost | string | undefined;
  activeModel?: string | undefined;
  processTree?: readonly string[] | string | undefined;
  isolateActiveHost?: boolean | undefined;
  env?: Record<string, string | undefined> | undefined;
}

export interface ProbeAllOptions {
  activeHost?: CanonicalHost | string | undefined;
  activeModel?: string | undefined;
  processTree?: readonly string[] | string | undefined;
  isolateActiveHost?: boolean | undefined;
  env?: Record<string, string | undefined> | undefined;
}

function resolveEnvOption(
  options?: ProbeAllOptions,
  defaultOptions?: TelemetryNormalizationEngineOptions,
): Record<string, string | undefined> {
  if (options?.env !== undefined) return options.env;
  if (defaultOptions?.env !== undefined) return defaultOptions.env;
  if (typeof process !== "undefined") return process.env;
  return {};
}

function resolveProcessTreeOption(
  options?: ProbeAllOptions,
  defaultOptions?: TelemetryNormalizationEngineOptions,
): readonly string[] | string | undefined {
  if (options?.processTree !== undefined) return options.processTree;
  if (defaultOptions?.processTree !== undefined) return defaultOptions.processTree;
  return undefined;
}

function resolveModelOption(
  options?: ProbeAllOptions,
  defaultOptions?: TelemetryNormalizationEngineOptions,
): string | undefined {
  if (options?.activeModel !== undefined) return options.activeModel;
  if (defaultOptions?.activeModel !== undefined) return defaultOptions.activeModel;
  return undefined;
}

function resolveHostOption(
  options?: ProbeAllOptions,
  defaultOptions?: TelemetryNormalizationEngineOptions,
): CanonicalHost | string | undefined {
  if (options?.activeHost !== undefined) return options.activeHost;
  if (defaultOptions?.activeHost !== undefined) return defaultOptions.activeHost;
  return undefined;
}

function resolveIsolateOption(
  options?: ProbeAllOptions,
  defaultOptions?: TelemetryNormalizationEngineOptions,
): boolean {
  if (options?.isolateActiveHost !== undefined) return options.isolateActiveHost;
  if (defaultOptions?.isolateActiveHost !== undefined) return defaultOptions.isolateActiveHost;
  return true;
}

export class TelemetryNormalizationEngine {
  private readonly collectors: Map<string, TelemetryCollector> = new Map();
  private readonly defaultOptions: TelemetryNormalizationEngineOptions;

  constructor(
    collectors: TelemetryCollector[] = [],
    options: TelemetryNormalizationEngineOptions = {},
  ) {
    this.defaultOptions = options;
    if (collectors.length === 0) {
      const defaultIsolate =
        options.isolateActiveHost !== undefined ? options.isolateActiveHost : true;
      for (const collector of createDefaultCollectors({
        env: resolveEnvOption(undefined, options),
        activeHost: options.activeHost,
        activeModel: options.activeModel,
        processTree: options.processTree,
        isolateExternalCaches: defaultIsolate,
      })) {
        this.registerCollector(collector);
      }
    } else {
      for (const collector of collectors) {
        this.registerCollector(collector);
      }
    }
  }

  public registerCollector(collector: TelemetryCollector): this {
    this.collectors.set(collector.platformId, collector);
    return this;
  }

  public getCollectors(): readonly TelemetryCollector[] {
    return Array.from(this.collectors.values());
  }

  public detectHost(options?: ProbeAllOptions): HostDetectionResult {
    const mergedEnv = resolveEnvOption(options, this.defaultOptions);
    const detectionOpts: HostDetectionOptions = {
      env: mergedEnv,
      processTree: resolveProcessTreeOption(options, this.defaultOptions),
      model: resolveModelOption(options, this.defaultOptions),
      explicitHost: resolveHostOption(options, this.defaultOptions),
    };
    return detectActiveHost(detectionOpts);
  }

  public async probeAll(options?: ProbeAllOptions): Promise<UnifiedTelemetryReport> {
    const collectorList = Array.from(this.collectors.values());
    const probePromises = collectorList.map((c) => c.probe());
    const settled = await Promise.allSettled(probePromises);

    const results: PlatformProbeResult[] = [];
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i]!;
      const collector = collectorList[i]!;
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        const error =
          outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason));
        results.push({
          platformId: collector.platformId,
          isDetected: false,
          primaryTierUsed: null,
          metrics: [],
          rawObservations: {},
          errors: [error],
        });
      }
    }

    const hostDetection = this.detectHost(options);
    const activeHost = hostDetection.activeHost;
    const isolateActiveHost = resolveIsolateOption(options, this.defaultOptions);

    for (const res of results) {
      const isActiveHost = isPlatformMatchingHost(res.platformId, activeHost);
      const isExternal = isActiveHost ? false : res.isDetected;
      res.rawObservations["isActiveHost"] = isActiveHost;
      res.rawObservations["isExternalProvider"] = isExternal;
      res.rawObservations["activeHostDetected"] = activeHost;
    }

    const detectedCount = results.filter((r) => r.isDetected).length;

    const activeHostResults = results.filter((r) =>
      isPlatformMatchingHost(r.platformId, activeHost),
    );

    let activeHostLowestQuota: number | null = null;
    let activeHostLowestMetric: NormalizedQuotaMetric | null = null;

    for (const aRes of activeHostResults) {
      if (!aRes.isDetected) continue;
      if (aRes.metrics.length === 0) continue;
      for (const m of aRes.metrics) {
        if (m.remainingPercentage === null) continue;
        let shouldUpdate = false;
        if (activeHostLowestQuota === null) {
          shouldUpdate = true;
        } else if (m.remainingPercentage < activeHostLowestQuota) {
          shouldUpdate = true;
        }
        if (shouldUpdate) {
          activeHostLowestQuota = m.remainingPercentage;
          activeHostLowestMetric = m;
        }
      }
    }

    let globalLowestQuota: number | null = null;
    let globalLowestMetric: NormalizedQuotaMetric | null = null;
    const externalDetectedPlatforms: string[] = [];
    const isolatedExternalCaches: { platformId: string; metricName: string; quota: number }[] = [];

    for (const res of results) {
      if (!res.isDetected) continue;
      if (res.metrics.length === 0) continue;
      const isHost = isPlatformMatchingHost(res.platformId, activeHost);
      if (!isHost) externalDetectedPlatforms.push(res.platformId);
      for (const m of res.metrics) {
        if (m.remainingPercentage === null) continue;
        let shouldUpdateGlobal = false;
        if (globalLowestQuota === null) {
          shouldUpdateGlobal = true;
        } else if (m.remainingPercentage < globalLowestQuota) {
          shouldUpdateGlobal = true;
        }
        if (shouldUpdateGlobal) {
          globalLowestQuota = m.remainingPercentage;
          globalLowestMetric = m;
        }
        if (!isHost) {
          if (m.remainingPercentage < 20) {
            isolatedExternalCaches.push({
              platformId: res.platformId,
              metricName: m.rawMetricName,
              quota: m.remainingPercentage,
            });
          }
        }
      }
    }

    let lowestRemainingQuota: number | null = null;
    let lowestMetric: NormalizedQuotaMetric | null = null;
    let externalCachesIsolated = false;
    if (isolateActiveHost) {
      if (activeHostLowestQuota !== null) {
        if (externalDetectedPlatforms.length > 0) {
          externalCachesIsolated = true;
        }
      }
    }

    if (isolateActiveHost) {
      if (activeHostLowestQuota !== null) {
        lowestRemainingQuota = activeHostLowestQuota;
        lowestMetric = activeHostLowestMetric;
      } else if (!hostDetection.isFallback) {
        const hasDetectedActive = activeHostResults.some((r) => r.isDetected);
        if (hasDetectedActive) {
          lowestRemainingQuota = null;
          lowestMetric = null;
        } else {
          lowestRemainingQuota = globalLowestQuota;
          lowestMetric = globalLowestMetric;
        }
      } else {
        lowestRemainingQuota = globalLowestQuota;
        lowestMetric = globalLowestMetric;
      }
    } else {
      lowestRemainingQuota = globalLowestQuota;
      lowestMetric = globalLowestMetric;
    }

    const activeWarnings: string[] = [];
    if (lowestRemainingQuota !== null) {
      if (lowestRemainingQuota < 20) {
        const providerName =
          lowestMetric?.canonicalProvider !== undefined
            ? lowestMetric.canonicalProvider
            : activeHost;
        const metricLabel =
          lowestMetric?.rawMetricName !== undefined ? lowestMetric.rawMetricName : "quota";
        activeWarnings.push(
          `Low quota warning: ${providerName} (${metricLabel}) at ${lowestRemainingQuota}%`,
        );
      }
    }

    const isolatedWarnings: string[] = [];
    if (isolateActiveHost) {
      if (isolatedExternalCaches.length > 0) {
        let isHealthyOrNull = false;
        if (lowestRemainingQuota === null) {
          isHealthyOrNull = true;
        } else if (lowestRemainingQuota >= 20) {
          isHealthyOrNull = true;
        }
        if (isHealthyOrNull) {
          for (const ext of isolatedExternalCaches) {
            isolatedWarnings.push(
              `[Isolated External Cache] Provider '${ext.platformId}' (${ext.metricName}) reports ${ext.quota}% (inactive host, isolated from active host '${activeHost}')`,
            );
          }
        }
      }
    }

    const activeModelVal = resolveModelOption(options, this.defaultOptions);

    const summary: Record<string, unknown> = {
      totalCollectors: collectorList.length,
      detectedPlatforms: detectedCount,
      lowestRemainingQuota,
      activeHost,
      activePlatformId: hostDetection.primaryPlatformId,
      activeHostSignal: hostDetection.signal,
      activeHostQuotaRemaining: activeHostLowestQuota,
      activeModel: activeModelVal !== undefined ? activeModelVal : null,
      isolateActiveHost,
      externalProviderCachesIsolated: externalCachesIsolated,
      isolatedExternalPlatforms: externalDetectedPlatforms,
      activeWarnings,
      isolatedWarnings,
    };

    return {
      timestamp: new Date().toISOString(),
      results,
      summary,
    };
  }

  public formatAsciiReport(report: UnifiedTelemetryReport, detailed = false): string {
    const lines: string[] = [];

    lines.push(
      "┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐",
    );
    lines.push(
      "│                                   CROSS-PLATFORM QUOTA & USAGE TELEMETRY                                         │",
    );
    lines.push(
      "├──────────────┬────────────────────────────────┬────────────┬───────────────────┬──────────────────┬──────────────┤",
    );
    lines.push(
      "│ Platform     │ Model / Resource               │ Window     │ Quota Remaining   │ Reset / Status   │ Tier (Conf)  │",
    );
    lines.push(
      "├──────────────┼────────────────────────────────┼────────────┼───────────────────┼──────────────────┼──────────────┤",
    );

    for (let rIdx = 0; rIdx < report.results.length; rIdx++) {
      const res = report.results[rIdx]!;
      const platformPad = res.platformId.padEnd(12).slice(0, 12);
      const tierShort = formatTierShort(res.primaryTierUsed);

      if (res.metrics.length === 0) {
        if (!res.isDetected) {
          const modelPad = "(not detected)".padEnd(30).slice(0, 30);
          const winPad = "-".padEnd(10).slice(0, 10);
          const barPad = "[░░░░░░] Not Detected".padEnd(17).slice(0, 17);
          const reasonStr = res.reason !== undefined ? res.reason : "None";
          const resetPad = reasonStr.padEnd(16).slice(0, 16);
          const confPad = "None (none)".padEnd(12).slice(0, 12);
          lines.push(
            `│ ${platformPad} │ ${modelPad} │ ${winPad} │ ${barPad} │ ${resetPad} │ ${confPad} │`,
          );
        } else {
          const modelPad = "None".padEnd(30).slice(0, 30);
          const winPad = "-".padEnd(10).slice(0, 10);
          const barPad = "Detected (No Quota)".padEnd(17).slice(0, 17);
          const reasonStr = res.reason !== undefined ? res.reason : "None";
          const resetPad = reasonStr.padEnd(16).slice(0, 16);
          const confPad = `${tierShort} (heur)`.padEnd(12).slice(0, 12);
          lines.push(
            `│ ${platformPad} │ ${modelPad} │ ${winPad} │ ${barPad} │ ${resetPad} │ ${confPad} │`,
          );
        }
      } else {
        for (let mIdx = 0; mIdx < res.metrics.length; mIdx++) {
          const metric = res.metrics[mIdx]!;
          const rawMetric = metric.rawMetricName !== undefined ? metric.rawMetricName : "unknown";
          const modelName = rawMetric.padEnd(30).slice(0, 30);
          const windowTypeStr = metric.windowType !== undefined ? metric.windowType : "-";
          const winPad = windowTypeStr.padEnd(10).slice(0, 10);
          const bar =
            metric.remainingPercentage === null
              ? "[??????] Unknown"
              : formatPreciseProgressBar(metric.remainingPercentage, 6);
          const barPad = bar.padEnd(17).slice(0, 17);
          const resetStr = (
            metric.remainingPercentage === null ? "Not Measured" : formatResetTime(metric)
          )
            .padEnd(16)
            .slice(0, 16);
          const confStr = `${tierShort} (${metric.confidence.slice(0, 4)})`.padEnd(12).slice(0, 12);

          if (mIdx === 0) {
            lines.push(
              `│ ${platformPad} │ ${modelName} │ ${winPad} │ ${barPad} │ ${resetStr} │ ${confStr} │`,
            );
          } else {
            lines.push(
              `│ ${" ".repeat(12)} │ ${modelName} │ ${winPad} │ ${barPad} │ ${resetStr} │ ${confStr} │`,
            );
          }
        }
      }

      if (rIdx < report.results.length - 1) {
        lines.push(
          "├──────────────┼────────────────────────────────┼────────────┼───────────────────┼──────────────────┼──────────────┤",
        );
      }
    }

    lines.push(
      "└──────────────┴────────────────────────────────┴────────────┴───────────────────┴──────────────────┴──────────────┘",
    );
    lines.push("");

    const detected =
      typeof report.summary.detectedPlatforms === "number" ? report.summary.detectedPlatforms : 0;
    const total =
      typeof report.summary.totalCollectors === "number"
        ? report.summary.totalCollectors
        : report.results.length;
    lines.push(`- **Summary**: ${detected}/${total} platforms discovered.`);

    const activeHost = report.summary.activeHost;
    const activeHostSignal = report.summary.activeHostSignal as HostDetectionSignal | undefined;
    if (activeHost) {
      if (typeof activeHost === "string") {
        const mechanism = activeHostSignal ? ` (${activeHostSignal.mechanism})` : "";
        lines.push(`- **Active Host**: \`${activeHost}\`${mechanism}`);
      }
    }

    const activeModel = report.summary.activeModel;
    if (activeModel) {
      if (typeof activeModel === "string") {
        lines.push(`- **Active Model**: \`${activeModel}\``);
      }
    }

    const activeQuota = report.summary.activeHostQuotaRemaining;
    if (typeof activeQuota === "number") {
      lines.push(`- **Active Host Quota**: ${activeQuota}%`);
    }

    const lowest = report.summary.lowestRemainingQuota;
    if (typeof lowest === "number") {
      const isolatedSuffix =
        report.summary.externalProviderCachesIsolated === true ? " (active host isolated)" : "";
      lines.push(`- **Lowest Remaining Quota**: ${lowest}%${isolatedSuffix}`);
    }

    const accountBadges: string[] = [];
    for (const res of report.results) {
      if (res.platformId === "antigravity") {
        if (res.rawObservations.userTier) {
          const userTier = res.rawObservations.userTier as Record<string, unknown>;
          const tierName = typeof userTier.name === "string" ? userTier.name : "unknown";
          let credits = "";
          if (Array.isArray(userTier.availableCredits)) {
            if (userTier.availableCredits[0]) {
              const firstCredit = userTier.availableCredits[0] as Record<string, unknown>;
              const creditVal =
                firstCredit.creditAmount !== undefined ? firstCredit.creditAmount : 0;
              credits = `${creditVal} Credits`;
            }
          }
          const plan = res.rawObservations.plan ? `Plan: ${res.rawObservations.plan}` : "";
          const parts = [tierName, credits, plan].filter(Boolean);
          accountBadges.push(`\`[antigravity]\` ${parts.join(" · ")}`);
        }
      }

      let isCodexOrOpenAI = false;
      if (res.platformId === "codex") isCodexOrOpenAI = true;
      if (res.platformId === "openai") isCodexOrOpenAI = true;

      if (isCodexOrOpenAI) {
        let plan: unknown = res.rawObservations.planType;
        if (plan === undefined) plan = res.rawObservations.plan_type;
        if (plan === undefined) plan = res.rawObservations.plan;
        if (plan !== undefined) {
          accountBadges.push(`\`[${res.platformId}]\` Plan: ${plan}`);
        }
      }
    }

    if (accountBadges.length > 0) {
      lines.push(`- **Account Badges**:`);
      for (const badge of accountBadges) {
        lines.push(`  - ${badge}`);
      }
    }

    const warnings = Array.isArray(report.summary.activeWarnings)
      ? (report.summary.activeWarnings as string[])
      : [];
    if (warnings.length > 0) {
      lines.push(`- **Active Warnings**:`);
      for (const w of warnings) {
        lines.push(`  - ⚠️  ${w}`);
      }
    }

    const allErrors: { platformId: string; message: string }[] = [];
    for (const res of report.results) {
      for (const err of res.errors) {
        allErrors.push({ platformId: res.platformId, message: err.message });
      }
    }

    if (allErrors.length > 0) {
      lines.push("");
      lines.push(`- **Non-Fatal Probe Errors** (${allErrors.length}):`);
      for (const err of allErrors) {
        lines.push(`  - \`[${err.platformId}]\` ${err.message}`);
      }
    }

    if (detailed) {
      lines.push("");
      lines.push("### Detailed Raw Observations");
      for (const res of report.results) {
        lines.push(`#### \`${res.platformId}\``);
        lines.push(`\`\`\`json\n${JSON.stringify(res.rawObservations, null, 2)}\n\`\`\``);
      }
    }

    return lines.join("\n");
  }
}
