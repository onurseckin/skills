import type { NormalizedQuotaMetric, TierType, UnifiedTelemetryReport } from "./types.ts";
import type { HostDetectionSignal } from "./collectors/index.ts";

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
  if (typeof rawPayload.quotaInfo === "object" && rawPayload.quotaInfo !== null) {
    quotaInfo = rawPayload.quotaInfo as Record<string, unknown>;
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

function renderTableRows(report: UnifiedTelemetryReport, lines: string[]): void {
  for (let rIdx = 0; rIdx < report.results.length; rIdx++) {
    const res = report.results[rIdx]!;
    const platformPad = res.platformId.padEnd(12).slice(0, 12);
    const tierShort = formatTierShort(res.primaryTierUsed);

    if (res.metrics.length === 0) {
      if (!res.isDetected) {
        const modelPad = "(not detected)".padEnd(30).slice(0, 30);
        const winPad = "-".padEnd(10).slice(0, 10);
        const barPad = "[░░░░░░] Not Detected".padEnd(17).slice(0, 17);
        const resetPad = (res.reason !== undefined ? res.reason : "None").padEnd(16).slice(0, 16);
        const confPad = "None (none)".padEnd(12).slice(0, 12);
        lines.push(
          `│ ${platformPad} │ ${modelPad} │ ${winPad} │ ${barPad} │ ${resetPad} │ ${confPad} │`,
        );
      } else {
        const modelPad = "None".padEnd(30).slice(0, 30);
        const winPad = "-".padEnd(10).slice(0, 10);
        const barPad = "Detected (No Quota)".padEnd(17).slice(0, 17);
        const resetPad = (res.reason !== undefined ? res.reason : "None").padEnd(16).slice(0, 16);
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
        const winPad = (metric.windowType !== undefined ? metric.windowType : "-")
          .padEnd(10)
          .slice(0, 10);
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
}

export function formatAsciiReport(report: UnifiedTelemetryReport, detailed = false): string {
  const lines: string[] = [
    "┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐",
    "│                                   CROSS-PLATFORM QUOTA & USAGE TELEMETRY                                         │",
    "├──────────────┬────────────────────────────────┬────────────┬───────────────────┬──────────────────┬──────────────┤",
    "│ Platform     │ Model / Resource               │ Window     │ Quota Remaining   │ Reset / Status   │ Tier (Conf)  │",
    "├──────────────┼────────────────────────────────┼────────────┼───────────────────┼──────────────────┼──────────────┤",
  ];

  renderTableRows(report, lines);
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
  if (typeof activeHost === "string") {
    const mechanism = activeHostSignal ? ` (${activeHostSignal.mechanism})` : "";
    lines.push(`- **Active Host**: \`${activeHost}\`${mechanism}`);
  }

  const activeModel = report.summary.activeModel;
  if (typeof activeModel === "string") {
    lines.push(`- **Active Model**: \`${activeModel}\``);
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

  const accountBadges = extractAccountBadges(report);
  if (accountBadges.length > 0) {
    lines.push(`- **Account Badges**:`);
    for (const badge of accountBadges) lines.push(`  - ${badge}`);
  }

  const warnings = Array.isArray(report.summary.activeWarnings)
    ? (report.summary.activeWarnings as string[])
    : [];
  if (warnings.length > 0) {
    lines.push(`- **Active Warnings**:`);
    for (const w of warnings) lines.push(`  - ⚠️  ${w}`);
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
    for (const err of allErrors) lines.push(`  - \`[${err.platformId}]\` ${err.message}`);
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

function extractAccountBadges(report: UnifiedTelemetryReport): string[] {
  const accountBadges: string[] = [];
  for (const res of report.results) {
    if (res.platformId === "antigravity" && res.rawObservations.userTier) {
      const userTier = res.rawObservations.userTier as Record<string, unknown>;
      const tierName = typeof userTier.name === "string" ? userTier.name : "unknown";
      let credits = "";
      if (Array.isArray(userTier.availableCredits) && userTier.availableCredits[0]) {
        const firstCredit = userTier.availableCredits[0] as Record<string, unknown>;
        credits = `${firstCredit.creditAmount !== undefined ? firstCredit.creditAmount : 0} Credits`;
      }
      const plan = res.rawObservations.plan ? `Plan: ${res.rawObservations.plan}` : "";
      const parts = [tierName, credits, plan].filter(Boolean);
      accountBadges.push(`\`[antigravity]\` ${parts.join(" · ")}`);
    }

    if (res.platformId === "codex" || res.platformId === "openai") {
      let plan =
        res.rawObservations.planType ?? res.rawObservations.plan_type ?? res.rawObservations.plan;
      if (plan !== undefined) {
        accountBadges.push(`\`[${res.platformId}]\` Plan: ${plan}`);
      }
    }
  }
  return accountBadges;
}
