import type { TelemetryCollector } from "./probe-interface.ts";
import type {
  NormalizedQuotaMetric,
  PlatformProbeResult,
  TierType,
  UnifiedTelemetryReport,
} from "./types.ts";
import { createDefaultCollectors } from "./collectors/index.ts";

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

export class TelemetryNormalizationEngine {
  private readonly collectors: Map<string, TelemetryCollector> = new Map();

  constructor(collectors: TelemetryCollector[] = []) {
    if (collectors.length === 0) {
      for (const collector of createDefaultCollectors()) {
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

  public async probeAll(): Promise<UnifiedTelemetryReport> {
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

    const detectedCount = results.filter((r) => r.isDetected).length;
    let lowestRemainingQuota: number | null = null;
    let lowestMetric: NormalizedQuotaMetric | null = null;

    for (const res of results) {
      for (const m of res.metrics) {
        if (lowestRemainingQuota === null || m.remainingPercentage < lowestRemainingQuota) {
          lowestRemainingQuota = m.remainingPercentage;
          lowestMetric = m;
        }
      }
    }

    const activeWarnings: string[] = [];
    if (lowestRemainingQuota !== null && lowestRemainingQuota < 20) {
      activeWarnings.push(
        `Low quota warning: ${lowestMetric?.canonicalProvider ?? "platform"} (${lowestMetric?.rawMetricName ?? "metric"}) at ${lowestRemainingQuota}%`,
      );
    }

    const summary: Record<string, unknown> = {
      totalCollectors: collectorList.length,
      detectedPlatforms: detectedCount,
      lowestRemainingQuota,
      activeWarnings,
    };

    return {
      timestamp: new Date().toISOString(),
      results,
      summary,
    };
  }

  public formatAsciiReport(report: UnifiedTelemetryReport, detailed = false): string {
    const lines: string[] = [];

    lines.push("┌─────────────────────────────────────────────────────────────────────────────┐");
    lines.push("│                 CROSS-PLATFORM QUOTA & USAGE TELEMETRY                      │");
    lines.push("├──────────────┬────────────┬──────────────────┬─────────────────┬────────────┤");
    lines.push("│ Platform     │ Detected   │ Active Tier      │ Quota / Metric  │ Confidence │");
    lines.push("├──────────────┼────────────┼──────────────────┼─────────────────┼────────────┤");

    for (const res of report.results) {
      const platformPad = res.platformId.padEnd(12).slice(0, 12);
      const detectedPad = (res.isDetected ? "YES (✓)" : "NO  (·)").padEnd(10).slice(0, 10);
      const tierPad = formatTierBadge(res.primaryTierUsed).padEnd(16).slice(0, 16);

      if (res.metrics.length === 0) {
        const metricPad = "None".padEnd(15).slice(0, 15);
        const confPad = (res.isDetected ? "heuristic" : "none").padEnd(10).slice(0, 10);
        lines.push(`│ ${platformPad} │ ${detectedPad} │ ${tierPad} │ ${metricPad} │ ${confPad} │`);
      } else {
        for (let mIdx = 0; mIdx < res.metrics.length; mIdx++) {
          const metric = res.metrics[mIdx]!;
          const bar = renderProgressBar(metric.remainingPercentage, 6);
          const barPad = bar.padEnd(15).slice(0, 15);
          const confPad = metric.confidence.padEnd(10).slice(0, 10);

          if (mIdx === 0) {
            lines.push(`│ ${platformPad} │ ${detectedPad} │ ${tierPad} │ ${barPad} │ ${confPad} │`);
          } else {
            lines.push(
              `│ ${" ".repeat(12)} │ ${" ".repeat(10)} │ ${" ".repeat(16)} │ ${barPad} │ ${confPad} │`,
            );
          }
        }
      }
    }

    lines.push("└──────────────┴────────────┴──────────────────┴─────────────────┴────────────┘");
    lines.push("");

    const detected = report.summary.detectedPlatforms ?? 0;
    const total = report.summary.totalCollectors ?? report.results.length;
    lines.push(`- **Summary**: ${detected}/${total} platforms discovered.`);

    const lowest = report.summary.lowestRemainingQuota;
    if (typeof lowest === "number") {
      lines.push(`- **Lowest Remaining Quota**: ${lowest}%`);
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
