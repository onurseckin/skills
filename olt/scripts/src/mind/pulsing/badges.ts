import type { PulseQuotaBadgeOptions, PulseQuotaEvaluation, QuotaHealthStatus } from "./types.ts";

export function renderPulseQuotaProgressBar(percentage: number | null, width = 6): string {
  if (percentage === null) {
    return `[${"░".repeat(width)}] N/A`;
  }
  if (isNaN(percentage)) {
    return `[${"░".repeat(width)}] N/A`;
  }
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const formattedPct = clamped % 1 === 0 ? `${clamped}%` : `${clamped.toFixed(2)}%`;
  return `[${bar}] ${formattedPct}`;
}

export function renderPulseQuotaBadge(
  quota: number | null,
  host: string,
  status: QuotaHealthStatus = "nominal",
): string {
  const hostLabel =
    typeof host === "string" && host.length > 0 && host !== "unknown" ? `[HOST: ${host}] ` : "";
  if (quota === null) {
    return `${hostLabel}[QUOTA: unmeasured · unknown]`;
  }
  if (isNaN(quota)) {
    return `${hostLabel}[QUOTA: unmeasured · unknown]`;
  }

  const bar = renderPulseQuotaProgressBar(quota, 6);
  if (status === "critical") {
    return `${hostLabel}[QUOTA: ${quota.toFixed(2)}% 🚨 CRITICAL BREAKER]`;
  }
  if (quota <= 10) {
    return `${hostLabel}[QUOTA: ${quota.toFixed(2)}% 🚨 CRITICAL BREAKER]`;
  }
  if (status === "warning") {
    return `${hostLabel}[QUOTA: ${bar} ⚠️ WARNING]`;
  }
  if (quota < 20) {
    return `${hostLabel}[QUOTA: ${bar} ⚠️ WARNING]`;
  }
  return `${hostLabel}[QUOTA: ${bar} nominal]`;
}

export function renderPulseTelemetryBadges(
  evaluation: PulseQuotaEvaluation,
  options: PulseQuotaBadgeOptions = {},
): readonly string[] {
  const badges: string[] = [];

  if (options.includeHost !== false) {
    if (
      typeof evaluation.activeHost === "string" &&
      evaluation.activeHost.length > 0 &&
      evaluation.activeHost !== "unknown"
    ) {
      badges.push(`[HOST: ${evaluation.activeHost}]`);
    }
  }

  const quota = evaluation.lowestRemainingQuota;
  if (quota === null) {
    badges.push("[QUOTA: unmeasured]");
  } else {
    const bar =
      options.includeProgressBar === false
        ? `${quota.toFixed(2)}%`
        : renderPulseQuotaProgressBar(quota, options.compact ? 4 : 6);
    if (evaluation.status === "critical") {
      badges.push(`[QUOTA: ${quota.toFixed(2)}% 🚨 CRITICAL]`);
    } else if (evaluation.status === "warning") {
      badges.push(`[QUOTA: ${bar} ⚠️ LOW]`);
    } else {
      badges.push(`[QUOTA: ${bar} nominal]`);
    }
  }

  if (evaluation.isCircuitBreakerTripped) {
    badges.push("[BREAKER: 🚨 TRIPPED]");
  } else {
    badges.push("[BREAKER: NOMINAL]");
  }

  if (evaluation.autoWakeSchedule) {
    badges.push(`[AUTOWAKE: +${evaluation.autoWakeSchedule.durationSeconds}s]`);
  }

  if (evaluation.constrainedModels.length > 0) {
    badges.push(`[CONSTRAINED: ${evaluation.constrainedModels.length} models]`);
  }

  return badges;
}

export function formatPulseQuotaHeader(evaluation: PulseQuotaEvaluation): string {
  const lines: string[] = [];
  const statusStr = evaluation.status.toUpperCase();
  const quotaStr =
    evaluation.lowestRemainingQuota !== null
      ? `${evaluation.lowestRemainingQuota.toFixed(2)}%`
      : "Unavailable";
  const breakerStr = evaluation.isCircuitBreakerTripped ? "🚨 TRIPPED (<10%)" : "NOMINAL";
  const displayHost =
    typeof evaluation.activeHost === "string" && evaluation.activeHost.length > 0
      ? evaluation.activeHost
      : "unknown";

  lines.push(
    "┌──────────────────────────────────────────────────────────────────────────────────────────────────┐",
  );
  lines.push(
    `│ HOST: ${displayHost.padEnd(16).slice(0, 16)} │ QUOTA: ${quotaStr.padEnd(12).slice(0, 12)} │ STATUS: ${statusStr.padEnd(12).slice(0, 12)} │ BREAKER: ${breakerStr.padEnd(18).slice(0, 18)} │`,
  );
  lines.push(
    "└──────────────────────────────────────────────────────────────────────────────────────────────────┘",
  );
  return lines.join("\n");
}

export function renderAsciiDagTelemetryBadge(
  nodeCount: number,
  waveCount: number,
  lowestQuota: number | null,
): string {
  const quotaStr = lowestQuota !== null ? `${Math.round(lowestQuota)}%` : "N/A";
  return `[DAG: ${nodeCount}N/${waveCount}W | Q: ${quotaStr}]`;
}
