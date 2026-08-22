import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type LivenessStatusKind = "healthy" | "stale" | "missing_record" | "corrupted_record";

export const DEFAULT_LIVENESS_INTERVAL_MS = 900_000; // 15 minutes
export const DEFAULT_LIVENESS_GRACE_MS = 300_000; // 5 minutes
export const DEFAULT_LIVENESS_THRESHOLD_MS =
  DEFAULT_LIVENESS_INTERVAL_MS + DEFAULT_LIVENESS_GRACE_MS; // 20 minutes (1,200,000 ms)

export const EXIT_CODE_HEALTHY = 0;
export const EXIT_CODE_STALE = 2;
export const EXIT_CODE_CHECK_FAILURE = 3;

export interface LivenessOptions {
  readonly intervalMs?: number | undefined;
  readonly graceMs?: number | undefined;
  readonly nowMs?: number | undefined;
  readonly maxAllowedAgeMs?: number | undefined;
}

export interface PulseMetrics {
  readonly pulseId: string | null;
  readonly outcome: string | null;
  readonly pulseTimestamp: string | null;
  readonly pulseTimeMs: number | null;
  readonly nextWakeAt: string | null;
  readonly ageMs: number | null;
  readonly maxAllowedAgeMs: number;
  readonly intervalMs: number;
  readonly graceMs: number;
}

export interface LivenessStatus {
  readonly status: LivenessStatusKind;
  readonly healthy: boolean;
  readonly exitCode: number;
  readonly reason: string;
  readonly capsuleDir: string;
  readonly pulseFile: string;
  readonly metrics: PulseMetrics;
}

export interface StalePulseReclaimReadiness {
  readonly isReadyForReclaim: boolean;
  readonly deadlinePassedByMs: number;
  readonly reason: string;
  readonly openPulseId: string | null;
}

export interface LivenessTrendSummary {
  readonly totalPulses: number;
  readonly healthyCount: number;
  readonly staleCount: number;
  readonly healthPercentage: number;
  readonly meanAgeMs: number;
  readonly maxAgeMs: number;
  readonly consecutiveHealthyStreak: number;
  readonly latestStatus: LivenessStatusKind;
}

/**
 * Resolves the path to last_pulse.json given either a capsule directory or a direct file path.
 */
export function resolvePulseFilePath(capsuleDirOrFile: string): string {
  if (existsSync(capsuleDirOrFile)) {
    try {
      const stats = statSync(capsuleDirOrFile);
      if (stats.isFile()) {
        return capsuleDirOrFile;
      }
    } catch {
      // Fall through to joining last_pulse.json
    }
  }

  if (capsuleDirOrFile.endsWith(".json")) {
    return capsuleDirOrFile;
  }

  return join(capsuleDirOrFile, "last_pulse.json");
}

/**
 * Maps LivenessStatusKind to the corresponding CLI exit code.
 * - 0: Healthy heartbeat
 * - 2: Stale heartbeat (pages owner)
 * - 3: External check failure / missing or unreadable record
 */
export function getExitCodeForStatus(kind: LivenessStatusKind): number {
  switch (kind) {
    case "healthy":
      return EXIT_CODE_HEALTHY;
    case "stale":
      return EXIT_CODE_STALE;
    case "missing_record":
    case "corrupted_record":
      return EXIT_CODE_CHECK_FAILURE;
  }
}

/**
 * Evaluates liveness from an in-memory pulse record object without requiring disk I/O.
 */
export function evaluateLivenessFromRecord(
  parsed: Record<string, unknown>,
  options: LivenessOptions & { readonly capsuleDir?: string | undefined; readonly pulseFile?: string | undefined } = {},
): LivenessStatus {
  const capsuleDir = options.capsuleDir ?? ".";
  const pulseFile = options.pulseFile ?? "last_pulse.json";
  const nowMs = options.nowMs ?? Date.now();
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

  // Extract pulse timestamp: checked in priority order (closed_at, at, started_at, opened_at)
  const candidateTimestamp =
    (typeof parsed.closed_at === "string" && parsed.closed_at) ||
    (typeof parsed.at === "string" && parsed.at) ||
    (typeof parsed.started_at === "string" && parsed.started_at) ||
    (typeof parsed.opened_at === "string" && parsed.opened_at) ||
    null;

  if (!candidateTimestamp) {
    return {
      status: "corrupted_record",
      healthy: false,
      exitCode: EXIT_CODE_CHECK_FAILURE,
      reason: `Pulse record contains no valid timestamp ('closed_at', 'at', or 'started_at')`,
      capsuleDir,
      pulseFile,
      metrics: emptyMetrics,
    };
  }

  const pulseTimeMs = Date.parse(candidateTimestamp);
  if (!Number.isFinite(pulseTimeMs)) {
    return {
      status: "corrupted_record",
      healthy: false,
      exitCode: EXIT_CODE_CHECK_FAILURE,
      reason: `Pulse record contains unparseable timestamp: '${candidateTimestamp}'`,
      capsuleDir,
      pulseFile,
      metrics: emptyMetrics,
    };
  }

  const pulseId = typeof parsed.pulse_id === "string" ? parsed.pulse_id : null;
  const outcome = typeof parsed.outcome === "string" ? parsed.outcome : null;
  const nextWakeAt = typeof parsed.next_wake_at === "string" ? parsed.next_wake_at : null;
  const ageMs = nowMs - pulseTimeMs;

  const metrics: PulseMetrics = {
    pulseId,
    outcome,
    pulseTimestamp: candidateTimestamp,
    pulseTimeMs,
    nextWakeAt,
    ageMs,
    maxAllowedAgeMs,
    intervalMs,
    graceMs,
  };

  if (ageMs <= maxAllowedAgeMs) {
    const ageSeconds = Math.max(0, Math.round(ageMs / 1000));
    const thresholdSeconds = Math.round(maxAllowedAgeMs / 1000);
    return {
      status: "healthy",
      healthy: true,
      exitCode: EXIT_CODE_HEALTHY,
      reason: `Heartbeat is fresh (age: ${ageSeconds}s <= threshold: ${thresholdSeconds}s)`,
      capsuleDir,
      pulseFile,
      metrics,
    };
  }

  const ageSeconds = Math.round(ageMs / 1000);
  const thresholdSeconds = Math.round(maxAllowedAgeMs / 1000);
  return {
    status: "stale",
    healthy: false,
    exitCode: EXIT_CODE_STALE,
    reason: `Heartbeat is stale (age: ${ageSeconds}s > threshold: ${thresholdSeconds}s) - PAGING OWNER`,
    capsuleDir,
    pulseFile,
    metrics,
  };
}

/**
 * Evaluates the external liveness of an autonomous mind capsule per PHASE-6 §3.5.
 *
 * Reads last_pulse.json, calculates age against (interval + grace) threshold,
 * and distinguishes healthy, stale (requiring pager alert), and check failures.
 */
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
  const healthPercentage = validCount > 0 ? Number(((healthyCount / validCount) * 100).toFixed(1)) : 100;
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

/**
 * Formats a human-readable markdown brief of liveness status.
 */
export function formatLivenessBrief(status: LivenessStatus): string {
  const icon = status.healthy ? "🟢" : status.status === "stale" ? "🔴" : "⚠️";
  const lines = [
    `### Mind Liveness Status: ${icon} ${status.status.toUpperCase()}`,
    `- **Capsule**: \`${status.capsuleDir}\``,
    `- **Pulse File**: \`${status.pulseFile}\``,
    `- **Exit Code**: \`${status.exitCode}\``,
    `- **Reason**: ${status.reason}`,
  ];

  if (status.metrics.pulseId) {
    lines.push(`- **Pulse ID**: \`${status.metrics.pulseId}\``);
  }
  if (status.metrics.outcome) {
    lines.push(`- **Outcome**: \`${status.metrics.outcome}\``);
  }
  if (status.metrics.pulseTimestamp) {
    lines.push(`- **Pulse Timestamp**: \`${status.metrics.pulseTimestamp}\``);
  }
  if (status.metrics.ageMs !== null) {
    lines.push(
      `- **Age**: ${Math.round(status.metrics.ageMs / 1000)}s (threshold: ${Math.round(status.metrics.maxAllowedAgeMs / 1000)}s)`,
    );
  }
  if (status.metrics.nextWakeAt) {
    lines.push(`- **Next Wake At**: \`${status.metrics.nextWakeAt}\``);
  }

  return lines.join("\n");
}
