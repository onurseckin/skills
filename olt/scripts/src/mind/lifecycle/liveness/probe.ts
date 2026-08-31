import { DEFAULT_LIVENESS_THRESHOLD_MS } from "./types.ts";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type {
  LivenessOptions,
  LivenessStatus,
  StalePulseReclaimReadiness,
  LivenessTrendSummary,
  PulseMetrics,
} from "./types.ts";
import {
  DEFAULT_LIVENESS_INTERVAL_MS,
  DEFAULT_LIVENESS_GRACE_MS,
  EXIT_CODE_CHECK_FAILURE,
  EXIT_CODE_HEALTHY,
  EXIT_CODE_STALE,
} from "./types.ts";
import { resolvePulseFilePath, evaluateLivenessFromRecord } from "./types.ts";
export function evaluateMindLiveness(
  capsuleDir: string,
  options: LivenessOptions = {},
): LivenessStatus {
  const pulseFile = resolvePulseFilePath(capsuleDir);
  const intervalMs = options.intervalMs ?? DEFAULT_LIVENESS_INTERVAL_MS;
  const graceMs = options.graceMs ?? DEFAULT_LIVENESS_GRACE_MS;
  const maxAllowedAgeMs = options.maxAllowedAgeMs ?? intervalMs + graceMs;

  const emptyMetrics: PulseMetrics = {
    pulseId: null,
    outcome: null,
    pulseTimestamp: null,
    pulseTimeMs: null,
    nextWakeAt: null,
    ageMs: null,
    maxAllowedAgeMs,
    intervalMs,
    graceMs,
  };

  if (!existsSync(pulseFile)) {
    return {
      status: "missing_record",
      healthy: false,
      exitCode: EXIT_CODE_CHECK_FAILURE,
      reason: `Pulse record does not exist at '${pulseFile}'`,
      capsuleDir,
      pulseFile,
      metrics: emptyMetrics,
    };
  }

  let rawContent: string;
  try {
    rawContent = readFileSync(pulseFile, "utf-8");
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      status: "corrupted_record",
      healthy: false,
      exitCode: EXIT_CODE_CHECK_FAILURE,
      reason: `Cannot read pulse file '${pulseFile}': ${errorMsg}`,
      capsuleDir,
      pulseFile,
      metrics: emptyMetrics,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const decoded = JSON.parse(rawContent) as unknown;
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      return {
        status: "corrupted_record",
        healthy: false,
        exitCode: EXIT_CODE_CHECK_FAILURE,
        reason: `Pulse record at '${pulseFile}' is not a valid JSON object`,
        capsuleDir,
        pulseFile,
        metrics: emptyMetrics,
      };
    }
    parsed = decoded as Record<string, unknown>;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      status: "corrupted_record",
      healthy: false,
      exitCode: EXIT_CODE_CHECK_FAILURE,
      reason: `Failed to parse pulse record JSON at '${pulseFile}': ${errorMsg}`,
      capsuleDir,
      pulseFile,
      metrics: emptyMetrics,
    };
  }

  return evaluateLivenessFromRecord(parsed, {
    ...options,
    capsuleDir,
    pulseFile,
  });
}

/**
 * Calculates milliseconds remaining until pulse timestamp becomes stale.
 */
export function calculateTimeToStaleMs(
  pulseTimestamp: string | number | Date,
  maxAllowedAgeMs: number = DEFAULT_LIVENESS_THRESHOLD_MS,
  nowMs: number = Date.now(),
): { readonly remainingMs: number; readonly isStale: boolean; readonly staleByMs: number } {
  const tsMs =
    typeof pulseTimestamp === "number"
      ? pulseTimestamp
      : pulseTimestamp instanceof Date
        ? pulseTimestamp.getTime()
        : Date.parse(pulseTimestamp);

  if (!Number.isFinite(tsMs)) {
    return { remainingMs: 0, isStale: true, staleByMs: maxAllowedAgeMs };
  }

  const elapsedMs = nowMs - tsMs;
  const remainingMs = maxAllowedAgeMs - elapsedMs;

  if (remainingMs < 0) {
    return { remainingMs: 0, isStale: true, staleByMs: Math.abs(remainingMs) };
  }

  return { remainingMs, isStale: false, staleByMs: 0 };
}

/**
 * Evaluates whether an open pulse record is overdue beyond deadline + grace and ready for reclaim.
 */
export function checkStalePulseReclaimReadiness(
  pulseRecord: Record<string, unknown>,
  options: { readonly nowMs?: number | undefined; readonly graceMs?: number | undefined } = {},
): StalePulseReclaimReadiness {
  const nowMs = options.nowMs ?? Date.now();
  const graceMs = options.graceMs ?? 0;

  const open =
    typeof pulseRecord.open === "object" && pulseRecord.open !== null
      ? (pulseRecord.open as Record<string, unknown>)
      : pulseRecord;

  const openPulseId = typeof open.pulse_id === "string" ? open.pulse_id : null;
  const deadlineStr = typeof open.deadline_at === "string" ? open.deadline_at : null;

  if (!openPulseId || !deadlineStr) {
    return {
      isReadyForReclaim: false,
      deadlinePassedByMs: 0,
      reason: "No active pulse open with valid deadline",
      openPulseId: null,
    };
  }

  const deadlineMs = Date.parse(deadlineStr);
  if (!Number.isFinite(deadlineMs)) {
    return {
      isReadyForReclaim: false,
      deadlinePassedByMs: 0,
      reason: `Invalid deadline timestamp: ${deadlineStr}`,
      openPulseId,
    };
  }

  const effectiveDeadlineMs = deadlineMs + graceMs;
  if (nowMs > effectiveDeadlineMs) {
    const deadlinePassedByMs = Math.max(0, nowMs - deadlineMs);
    return {
      isReadyForReclaim: true,
      deadlinePassedByMs,
      reason: `Pulse ${openPulseId} is past deadline by ${Math.round(deadlinePassedByMs / 1000)}s`,
      openPulseId,
    };
  }

  return {
    isReadyForReclaim: false,
    deadlinePassedByMs: 0,
    reason: `Pulse ${openPulseId} is within deadline (expires in ${Math.round((effectiveDeadlineMs - nowMs) / 1000)}s)`,
    openPulseId,
  };
}

/**
 * Creates a pulse heartbeat payload suitable for writing to last_pulse.json.
 */
export function createPulseHeartbeat(
  pulseId: string,
  options: {
    readonly outcome?: string | undefined;
    readonly nextWakeAt?: string | null | undefined;
    readonly timestamp?: string | undefined;
  } = {},
): Record<string, unknown> {
  const nowIso = options.timestamp ?? new Date().toISOString();
  return {
    pulse_id: pulseId,
    at: nowIso,
    closed_at: nowIso,
    outcome: options.outcome ?? "active",
    next_wake_at: options.nextWakeAt ?? null,
  };
}

/**
 * Analyzes multi-pulse history to calculate liveness trends and statistics.
 */
export function analyzeLivenessTrends(
  pulseHistory: readonly Record<string, unknown>[],
  options: {
    readonly intervalMs?: number | undefined;
    readonly graceMs?: number | undefined;
    readonly nowMs?: number | undefined;
  } = {},
): LivenessTrendSummary {
  const intervalMs = options.intervalMs ?? DEFAULT_LIVENESS_INTERVAL_MS;
  const graceMs = options.graceMs ?? DEFAULT_LIVENESS_GRACE_MS;
  const maxAllowedAgeMs = intervalMs + graceMs;
  const nowMs = options.nowMs ?? Date.now();

  if (pulseHistory.length === 0) {
    return {
      totalPulses: 0,
      healthyCount: 0,
      staleCount: 0,
      healthPercentage: 100,
      meanAgeMs: 0,
      maxAgeMs: 0,
      consecutiveHealthyStreak: 0,
      latestStatus: "missing_record",
    };
  }

  let healthyCount = 0;
  let staleCount = 0;
  let totalAge = 0;
  let maxAgeMs = 0;
  let consecutiveHealthyStreak = 0;
  let currentStreak = 0;

  for (let i = 0; i < pulseHistory.length; i++) {
    const item = pulseHistory[i];
    if (!item) continue;
    const liveness = evaluateLivenessFromRecord(item, {
      intervalMs,
      graceMs,
      nowMs,
      maxAllowedAgeMs,
    });

    if (liveness.healthy) {
      healthyCount++;
      currentStreak++;
      if (currentStreak > consecutiveHealthyStreak) {
        consecutiveHealthyStreak = currentStreak;
      }
    } else {
      staleCount++;
      currentStreak = 0;
    }

    const age = liveness.metrics.ageMs ?? 0;
    if (age > 0) {
      totalAge += age;
      if (age > maxAgeMs) {
        maxAgeMs = age;
      }
    }
  }

  const lastItem = pulseHistory[pulseHistory.length - 1]!;
  const latestLiveness = evaluateLivenessFromRecord(lastItem, {
    intervalMs,
    graceMs,
    nowMs,
    maxAllowedAgeMs,
  });

  const validCount = healthyCount + staleCount;
  const healthPercentage =
    validCount > 0 ? Number(((healthyCount / validCount) * 100).toFixed(1)) : 100;
  const meanAgeMs = validCount > 0 ? Math.round(totalAge / validCount) : 0;

  return {
    totalPulses: pulseHistory.length,
    healthyCount,
    staleCount,
    healthPercentage,
    meanAgeMs,
    maxAgeMs,
    consecutiveHealthyStreak,
    latestStatus: latestLiveness.status,
  };
}
