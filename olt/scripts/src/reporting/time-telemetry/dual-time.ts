/**
 * Dual-Time Formatting, Enrichment, and Markdown Rendering
 */
import { randomUUID } from "node:crypto";
import type { HarnessEvent, JsonObject, JsonValue } from "../../core/contracts/index.ts";
import {
  formatDualTimeDisplay,
  formatDuration,
  getDualTime,
  isDualTimeRecord,
  type DualTimeRecord,
} from "../../core/dual-time/index.ts";
import type {
  HarnessActionTimeRecord,
  TimeTelemetryReport,
} from "./types.ts";

/**
 * Injects dual-time stamp and telemetry metadata into any arbitrary JSON payload.
 */
export function enrichWithDualTime<T extends JsonObject>(
  payload: T,
  timezone?: string,
): T & { readonly _dual_time: DualTimeRecord; readonly _telemetry_id: string } {
  const timeRecord = getDualTime(undefined, timezone);
  const telemetryId = randomUUID();

  return {
    ...payload,
    _dual_time: timeRecord,
    _telemetry_id: telemetryId,
  };
}

/**
 * Enriches a HarnessEvent with standard dual-time record.
 */
export function enrichHarnessEvent(
  event: HarnessEvent,
  timezone?: string,
): HarnessEvent & { readonly dual_time: DualTimeRecord } {
  const eventTime = getDualTime(event.timestamp, timezone);
  return {
    ...event,
    dual_time: eventTime as unknown as JsonValue,
  } as unknown as HarnessEvent & { readonly dual_time: DualTimeRecord };
}

/**
 * Extracts and verifies a DualTimeRecord from any candidate object.
 */
export function extractDualTime(source: unknown): DualTimeRecord | null {
  if (!source || typeof source !== "object") return null;

  const obj = source as Record<string, unknown>;

  if (isDualTimeRecord(obj)) {
    return obj;
  }

  if (isDualTimeRecord(obj._dual_time)) {
    return obj._dual_time;
  }

  if (isDualTimeRecord(obj.dual_time)) {
    return obj.dual_time;
  }

  if (isDualTimeRecord(obj.timestamp)) {
    return obj.timestamp;
  }

  if (typeof obj.timestamp === "string" || typeof obj.created_at === "string") {
    try {
      const str = (typeof obj.timestamp === "string" ? obj.timestamp : obj.created_at) as string;
      return getDualTime(str);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Renders a Markdown header banner with dual-time timestamp.
 */
export function renderDualTimeHeader(title: string, record?: DualTimeRecord): string {
  const dual = record ?? getDualTime();
  const display = formatDualTimeDisplay(dual);
  return `# ${title}\n> **Generated At**: \`${display}\` (UTC: \`${dual.utc}\`)\n`;
}

/**
 * Formats a collection of action records as an omnipresent Markdown table.
 */
export function formatDualTimeTable(
  records: readonly HarnessActionTimeRecord[],
  options?: { timezone?: string; maxRows?: number },
): string {
  if (records.length === 0) {
    return "_No time telemetry records found._\n";
  }

  const maxRows = options?.maxRows ?? 50;
  const slice = records.slice(0, maxRows);

  const lines: string[] = [
    "| Action | Category | Actor | Tier | Status | Started (Local) | Duration | Drift |",
    "| :--- | :--- | :--- | :---: | :---: | :--- | :---: | :---: |",
  ];

  for (const rec of slice) {
    const startedDisplay = rec.startedAt.local.replace("T", " ");
    const duration =
      rec.durationFormatted ?? (rec.durationMs !== undefined ? `${rec.durationMs}ms` : "-");
    const drift = rec.driftMs !== undefined ? `${rec.driftMs > 0 ? "+" : ""}${rec.driftMs}ms` : "-";
    const statusIcon =
      rec.status === "success"
        ? "✅ success"
        : rec.status === "running"
          ? "🏃 running"
          : rec.status === "failure"
            ? "❌ failure"
            : rec.status === "error"
              ? "💥 error"
              : rec.status === "timed_out"
                ? "⏰ timed_out"
                : "⏳ pending";

    lines.push(
      `| \`${rec.actionName}\` | \`${rec.category}\` | \`${rec.actor}\` | ${rec.tier} | ${statusIcon} | \`${startedDisplay}\` | ${duration} | ${drift} |`,
    );
  }

  if (records.length > maxRows) {
    lines.push(`\n_... showing ${maxRows} of ${records.length} records._\n`);
  }

  return lines.join("\n");
}

/**
 * Renders a full markdown brief from a TimeTelemetryReport.
 */
export function renderOmnipresentTelemetryMarkdown(report: TimeTelemetryReport): string {
  const lines: string[] = [];

  lines.push(
    renderDualTimeHeader("Omnipresent Time Telemetry & Dual-Time Report", report.generatedAt),
  );

  lines.push("## Overview & Statistical Profile");
  lines.push(`- **Timezone**: \`${report.timezone}\``);
  lines.push(
    `- **Total Actions**: \`${report.totalActions}\` (Active: \`${report.activeActions}\`, Completed: \`${report.completedActions}\`)`,
  );
  lines.push(`- **Total Aggregate Duration**: \`${formatDuration(report.totalDurationMs)}\``);
  lines.push(`- **Mean Action Duration**: \`${formatDuration(report.overallPercentiles.meanMs)}\``);
  lines.push(
    `- **Latency Percentiles**: \`p50=${report.overallPercentiles.p50Ms}ms\`, \`p90=${report.overallPercentiles.p90Ms}ms\`, \`p95=${report.overallPercentiles.p95Ms}ms\`, \`p99=${report.overallPercentiles.p99Ms}ms\`, \`max=${report.overallPercentiles.maxMs}ms\``,
  );
  lines.push("");

  if (report.categoryBreakdown.length > 0) {
    lines.push("## Domain Category Breakdown");
    lines.push(
      "| Category | Count | Success | Failure | Error Rate | Total Time | Mean Time | p95 Latency |",
    );
    lines.push("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");
    for (const cat of report.categoryBreakdown) {
      lines.push(
        `| \`${cat.category}\` | ${cat.count} | ${cat.successCount} | ${cat.failureCount} | ${cat.errorRate}% | ${formatDuration(cat.totalDurationMs)} | ${formatDuration(cat.meanDurationMs)} | ${cat.percentiles.p95Ms}ms |`,
      );
    }
    lines.push("");
  }

  if (report.actorBreakdown.length > 0) {
    lines.push("## Agent & Authority Tier Breakdown");
    lines.push("| Actor | Tier | Actions | Total Time | Mean Time | Errors |");
    lines.push("| :--- | :---: | :---: | :---: | :---: | :---: |");
    for (const act of report.actorBreakdown) {
      lines.push(
        `| \`${act.actor}\` | Tier ${act.tier} | ${act.count} | ${formatDuration(act.totalDurationMs)} | ${formatDuration(act.meanDurationMs)} | ${act.errorCount} |`,
      );
    }
    lines.push("");
  }

  if (report.anomalies.length > 0) {
    lines.push("## Temporal Invariant & Health Anomalies");
    for (const anom of report.anomalies) {
      const badge =
        anom.severity === "critical"
          ? "🚨 CRITICAL"
          : anom.severity === "high"
            ? "⚠️ HIGH"
            : anom.severity === "medium"
              ? "⚡ MEDIUM"
              : "ℹ️ LOW";
      lines.push(`- **[${badge}]** \`${anom.actionName}\` (\`${anom.actor}\`): ${anom.message}`);
    }
    lines.push("");
  }

  if (report.recentActions.length > 0) {
    lines.push("## Recent Telemetry Activity Stream");
    lines.push(
      formatDualTimeTable(report.recentActions, { timezone: report.timezone, maxRows: 15 }),
    );
  }

  return lines.join("\n");
}
