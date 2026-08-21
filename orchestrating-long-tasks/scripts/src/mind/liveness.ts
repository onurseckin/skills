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
      reason: `Pulse record at '${pulseFile}' contains no valid timestamp ('closed_at', 'at', or 'started_at')`,
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
      reason: `Pulse record at '${pulseFile}' contains unparseable timestamp: '${candidateTimestamp}'`,
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
