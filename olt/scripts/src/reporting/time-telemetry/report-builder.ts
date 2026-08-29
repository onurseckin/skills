/**
 * Time Telemetry Report Builder
 */
import { getDualTime } from "../../core/dual-time/index.ts";
import { validateTimeTelemetryHealth } from "./health.ts";
import { computeLatencyPercentiles } from "./span.ts";
import {
  HARNESS_ACTION_CATEGORIES,
  type ActorTelemetrySummary,
  type CategoryTelemetrySummary,
  type HarnessActionCategory,
  type HarnessActionTimeRecord,
  type TelemetryFilter,
  type TimeTelemetryReport,
} from "./types.ts";

export function buildTimeTelemetryReport(
  records: readonly HarnessActionTimeRecord[],
  activeSpansCount: number,
  options?: {
    runId?: string | undefined;
    filter?: TelemetryFilter | undefined;
    timezone?: string | undefined;
    defaultTimezone?: string | undefined;
    maxRecent?: number | undefined;
  },
): TimeTelemetryReport {
  const tz = options?.timezone ?? options?.defaultTimezone ?? "UTC";
  const generatedAt = getDualTime(new Date(), tz);
  const completedCount = records.length;

  const durations = records
    .map((r) => r.durationMs)
    .filter((d): d is number => typeof d === "number");

  const totalDurationMs = durations.reduce((sum, d) => sum + d, 0);
  const overallPercentiles = computeLatencyPercentiles(durations);

  const catMap = new Map<HarnessActionCategory, HarnessActionTimeRecord[]>();
  for (const rec of records) {
    const list = catMap.get(rec.category) ?? [];
    list.push(rec);
    catMap.set(rec.category, list);
  }

  const categoryBreakdown: CategoryTelemetrySummary[] = [];
  for (const cat of HARNESS_ACTION_CATEGORIES) {
    const catRecords = catMap.get(cat);
    if (!catRecords || catRecords.length === 0) continue;

    const catDurations = catRecords
      .map((r) => r.durationMs)
      .filter((d): d is number => typeof d === "number");
    const catTotalDur = catDurations.reduce((sum, d) => sum + d, 0);
    const catCount = catRecords.length;
    const successCount = catRecords.filter(
      (r) => r.status === "success" || r.status === "pending",
    ).length;
    const failureCount = catRecords.filter(
      (r) => r.status === "failure" || r.status === "error" || r.status === "timed_out",
    ).length;
    const errorRate = catCount > 0 ? Math.round((failureCount / catCount) * 10000) / 100 : 0;
    const maxDur = catDurations.length > 0 ? Math.max(...catDurations) : 0;
    const meanDur =
      catDurations.length > 0 ? Math.round((catTotalDur / catDurations.length) * 100) / 100 : 0;

    categoryBreakdown.push({
      category: cat,
      count: catCount,
      successCount,
      failureCount,
      errorRate,
      totalDurationMs: catTotalDur,
      meanDurationMs: meanDur,
      maxDurationMs: maxDur,
      percentiles: computeLatencyPercentiles(catDurations),
    });
  }

  const actorMap = new Map<string, HarnessActionTimeRecord[]>();
  for (const rec of records) {
    const list = actorMap.get(rec.actor) ?? [];
    list.push(rec);
    actorMap.set(rec.actor, list);
  }

  const actorBreakdown: ActorTelemetrySummary[] = [];
  for (const [actor, actRecords] of actorMap.entries()) {
    const actDurations = actRecords
      .map((r) => r.durationMs)
      .filter((d): d is number => typeof d === "number");
    const actTotalDur = actDurations.reduce((sum, d) => sum + d, 0);
    const actCount = actRecords.length;
    const actMean =
      actDurations.length > 0 ? Math.round((actTotalDur / actDurations.length) * 100) / 100 : 0;
    const errCount = actRecords.filter(
      (r) => r.status === "failure" || r.status === "error" || r.status === "timed_out",
    ).length;
    const tier = actRecords[0]?.tier ?? 3;

    actorBreakdown.push({
      actor,
      tier,
      count: actCount,
      totalDurationMs: actTotalDur,
      meanDurationMs: actMean,
      errorCount: errCount,
    });
  }

  categoryBreakdown.sort((a, b) => b.totalDurationMs - a.totalDurationMs);
  actorBreakdown.sort((a, b) => b.count - a.count);

  const maxRecent = options?.maxRecent ?? 50;
  const recentActions = [...records].reverse().slice(0, maxRecent);
  const health = validateTimeTelemetryHealth(records);

  return {
    generatedAt,
    runId: options?.runId,
    totalActions: completedCount + activeSpansCount,
    activeActions: activeSpansCount,
    completedActions: completedCount,
    totalDurationMs,
    overallPercentiles,
    categoryBreakdown,
    actorBreakdown,
    recentActions,
    anomalies: health.anomalies,
    timezone: tz,
  };
}
