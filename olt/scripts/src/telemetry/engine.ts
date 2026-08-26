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
  const quotaInfo =
    typeof rawPayload?.quotaInfo === "object" && rawPayload?.quotaInfo !== null
      ? (rawPayload.quotaInfo as Record<string, unknown>)
      : rawPayload;
  const resetTimeStr = typeof quotaInfo?.resetTime === "string" ? quotaInfo.resetTime : undefined;

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
      if (res.isDetected === false || res.metrics.length === 0) {
        continue;
      }
      for (const m of res.metrics) {
        if (m.remainingPercentage === null) {
          continue;
        }
        if (lowestRemainingQuota === null || m.remainingPercentage < lowestRemainingQuota) {
          lowestRemainingQuota = m.remainingPercentage;
          lowestMetric = m;
        }
      }
    }

    const activeWarnings: string[] = [];
    if (lowestRemainingQuota !== null && lowestRemainingQuota < 20) {
      activeWarnings.push(
        `Low quota warning: ${lowestMetric?.canonicalProvider ?? "unknown"} (${lowestMetric?.rawMetricName ?? "unknown"}) at ${lowestRemainingQuota}%`,
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
          const resetPad = (res.reason ?? "None").padEnd(16).slice(0, 16);
          const confPad = "None (none)".padEnd(12).slice(0, 12);
          lines.push(
            `│ ${platformPad} │ ${modelPad} │ ${winPad} │ ${barPad} │ ${resetPad} │ ${confPad} │`,
          );
        } else {
          const modelPad = "None".padEnd(30).slice(0, 30);
          const winPad = "-".padEnd(10).slice(0, 10);
          const barPad = "Detected (No Quota)".padEnd(17).slice(0, 17);
          const resetPad = (res.reason ?? "None").padEnd(16).slice(0, 16);
          const confPad = `${tierShort} (heur)`.padEnd(12).slice(0, 12);
          lines.push(
            `│ ${platformPad} │ ${modelPad} │ ${winPad} │ ${barPad} │ ${resetPad} │ ${confPad} │`,
          );
        }
      } else {
        for (let mIdx = 0; mIdx < res.metrics.length; mIdx++) {
          const metric = res.metrics[mIdx]!;
          const modelName = (metric.rawMetricName || "unknown").padEnd(30).slice(0, 30);
          const winPad = (metric.windowType || "-").padEnd(10).slice(0, 10);
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

    const detected = report.summary.detectedPlatforms ?? 0;
    const total = report.summary.totalCollectors ?? report.results.length;
    lines.push(`- **Summary**: ${detected}/${total} platforms discovered.`);

    const lowest = report.summary.lowestRemainingQuota;
    if (typeof lowest === "number") {
      lines.push(`- **Lowest Remaining Quota**: ${lowest}%`);
    }

    const accountBadges: string[] = [];
    for (const res of report.results) {
      if (res.platformId === "antigravity" && res.rawObservations.userTier) {
        const userTier = res.rawObservations.userTier as Record<string, unknown>;
        const tierName = userTier.name || "unknown";
        const credits =
          Array.isArray(userTier.availableCredits) && userTier.availableCredits[0]
            ? `${(userTier.availableCredits[0] as Record<string, unknown>).creditAmount ?? 0} Credits`
            : "";
        const plan = res.rawObservations.plan ? `Plan: ${res.rawObservations.plan}` : "";
        const parts = [tierName, credits, plan].filter(Boolean);
        accountBadges.push(`\`[antigravity]\` ${parts.join(" · ")}`);
      }

      if (
        (res.platformId === "codex" || res.platformId === "openai") &&
        (res.rawObservations.planType || res.rawObservations.plan_type || res.rawObservations.plan)
      ) {
        const plan =
          res.rawObservations.planType ?? res.rawObservations.plan_type ?? res.rawObservations.plan;
        accountBadges.push(`\`[${res.platformId}]\` Plan: ${plan}`);
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
