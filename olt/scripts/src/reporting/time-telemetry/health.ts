/**
 * Time Telemetry Health Validator
 */
import type {
  HarnessActionTimeRecord,
  TimeAnomaly,
  TimeTelemetryHealthResult,
} from "./types.ts";

/**
 * Validates the behavioral health and temporal consistency of telemetry records.
 */
export function validateTimeTelemetryHealth(
  records: readonly HarnessActionTimeRecord[],
  thresholds?: {
    readonly maxDurationMs?: number | undefined;
    readonly maxDriftMs?: number | undefined;
  },
): TimeTelemetryHealthResult {
  const anomalies: TimeAnomaly[] = [];
  const maxDurationThreshold = thresholds?.maxDurationMs ?? 600_000;
  const maxDriftThreshold = thresholds?.maxDriftMs ?? 15_000;

  for (const rec of records) {
    if (typeof rec.durationMs === "number") {
      if (rec.durationMs < 0) {
        anomalies.push({
          type: "negative_duration",
          severity: "critical",
          actionId: rec.actionId,
          actionName: rec.actionName,
          actor: rec.actor,
          message: `Action recorded negative duration: ${rec.durationMs}ms`,
          actualMs: rec.durationMs,
        });
      } else if (rec.durationMs > maxDurationThreshold) {
        anomalies.push({
          type: "excessive_duration",
          severity: "medium",
          actionId: rec.actionId,
          actionName: rec.actionName,
          actor: rec.actor,
          message: `Action execution exceeded duration threshold: ${rec.durationFormatted ?? `${rec.durationMs}ms`}`,
          thresholdMs: maxDurationThreshold,
          actualMs: rec.durationMs,
        });
      }
    }

    if (typeof rec.driftMs === "number" && Math.abs(rec.driftMs) > maxDriftThreshold) {
      anomalies.push({
        type: "clock_drift",
        severity: "high",
        actionId: rec.actionId,
        actionName: rec.actionName,
        actor: rec.actor,
        message: `Watchdog heartbeat drift exceeded threshold: ${rec.driftMs}ms`,
        thresholdMs: maxDriftThreshold,
        actualMs: rec.driftMs,
      });
    }

    if (rec.subSteps) {
      for (const sub of rec.subSteps) {
        if (!sub.finishedAt) {
          anomalies.push({
            type: "unclosed_substep",
            severity: "low",
            actionId: rec.actionId,
            actionName: `${rec.actionName} > ${sub.name}`,
            actor: rec.actor,
            message: `Sub-step '${sub.name}' was not properly closed.`,
          });
        }
      }
    }
  }

  const healthy =
    anomalies.filter((a) => a.severity === "high" || a.severity === "critical").length === 0;
  const recommendation = healthy
    ? "Time telemetry healthy: all actions adhere to dual-time temporal invariants."
    : `Temporal health degraded: detected ${anomalies.length} timing anomalies requiring inspection.`;

  return {
    healthy,
    totalChecked: records.length,
    anomalyCount: anomalies.length,
    anomalies,
    recommendation,
  };
}
