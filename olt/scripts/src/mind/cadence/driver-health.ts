import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { didPulseAdvanceCadence, isPulseLockMechanism } from "./pulse-outcome.ts";
import {
  PULSE_DRIVER_HEALTH_SCHEMA,
  PULSE_OUTCOMES,
  type PulseDriverCounters,
  type PulseDriverHealthRecord,
  type PulseDriverObservedState,
  type PulseOutcome,
} from "./types.ts";

export const DEFAULT_HEARTBEAT_STALE_AFTER_MS = 180000;
export const DEFAULT_FAILING_THRESHOLD = 3;
export const MAX_RECENT_ERRORS = 5;

export interface DriverStateProbe {
  readonly isProcessAlive: (pid: number) => boolean;
  readonly staleAfterMs?: number;
  readonly failingThreshold?: number;
}

export function pulseDriverHealthPath(runRoot: string): string {
  return join(runRoot, "runtime", "pulse-driver-health.json");
}

export function emptyDriverCounters(): PulseDriverCounters {
  return {
    pulses_ran: 0,
    pulses_skipped_locked: 0,
    pulses_failed: 0,
    consecutive_failures: 0,
    last_attempt_at_ms: null,
    last_outcome: null,
    last_exit_code: null,
    lock_mechanism: null,
    recent_errors: [],
  };
}

export function applyPulseOutcome(
  counters: PulseDriverCounters,
  outcome: PulseOutcome,
  exitCode: number | null,
  attemptAtMs: number,
  lockMechanism: PulseDriverCounters["lock_mechanism"],
  errorText: string,
): PulseDriverCounters {
  const failed = outcome === "failed" || outcome === "unknown";
  const trimmed = errorText.trim();
  const recent =
    failed && trimmed !== ""
      ? [...counters.recent_errors, trimmed].slice(-MAX_RECENT_ERRORS)
      : counters.recent_errors;
  return {
    pulses_ran: didPulseAdvanceCadence(outcome) ? counters.pulses_ran + 1 : counters.pulses_ran,
    pulses_skipped_locked:
      outcome === "skipped_locked"
        ? counters.pulses_skipped_locked + 1
        : counters.pulses_skipped_locked,
    pulses_failed: failed ? counters.pulses_failed + 1 : counters.pulses_failed,
    consecutive_failures: failed ? counters.consecutive_failures + 1 : 0,
    last_attempt_at_ms: attemptAtMs,
    last_outcome: outcome,
    last_exit_code: exitCode,
    lock_mechanism: lockMechanism ?? counters.lock_mechanism,
    recent_errors: recent,
  };
}

export function buildLiveHealthRecord(input: {
  readonly runRoot: string;
  readonly pid: number;
  readonly currentPid: number;
  readonly startedAtMs: number;
  readonly nowMs: number;
  readonly nextWakeAt: string | null;
  readonly counters: PulseDriverCounters;
}): PulseDriverHealthRecord {
  if (input.pid !== input.currentPid) {
    throw new HarnessError(
      "INVALID_STATE",
      `pulse driver health record for pid ${input.pid} may not be written by pid ${input.currentPid}; a liveness record is only true when the live process itself writes it`,
    );
  }
  return {
    schema: PULSE_DRIVER_HEALTH_SCHEMA,
    run_root: input.runRoot,
    pid: input.pid,
    started_at: new Date(input.startedAtMs).toISOString(),
    last_heartbeat_at: new Date(input.nowMs).toISOString(),
    last_attempt_at:
      input.counters.last_attempt_at_ms === null
        ? null
        : new Date(input.counters.last_attempt_at_ms).toISOString(),
    last_outcome: input.counters.last_outcome,
    last_exit_code: input.counters.last_exit_code,
    lock_mechanism: input.counters.lock_mechanism,
    next_wake_at: input.nextWakeAt,
    pulses_ran: input.counters.pulses_ran,
    pulses_skipped_locked: input.counters.pulses_skipped_locked,
    pulses_failed: input.counters.pulses_failed,
    consecutive_failures: input.counters.consecutive_failures,
    recent_errors: input.counters.recent_errors,
  };
}

export function observeDriverState(
  record: PulseDriverHealthRecord,
  nowMs: number,
  probe: DriverStateProbe,
): PulseDriverObservedState {
  if (!probe.isProcessAlive(record.pid)) return "DEAD";
  const heartbeatMs = Date.parse(record.last_heartbeat_at);
  const staleAfterMs = probe.staleAfterMs ?? DEFAULT_HEARTBEAT_STALE_AFTER_MS;
  if (!Number.isFinite(heartbeatMs) || nowMs - heartbeatMs > staleAfterMs) return "STALE";
  const failingThreshold = probe.failingThreshold ?? DEFAULT_FAILING_THRESHOLD;
  if (record.consecutive_failures >= failingThreshold) return "FAILING";
  if (record.last_outcome === "ran_unlocked" || record.last_outcome === "ran_undispatched") {
    return "DEGRADED";
  }
  if (record.lock_mechanism === "none") return "DEGRADED";
  return "LIVE";
}

function isPulseOutcomeValue(value: unknown): value is PulseOutcome {
  return typeof value === "string" && (PULSE_OUTCOMES as readonly string[]).includes(value);
}

export function isPulseDriverHealthRecord(value: unknown): value is PulseDriverHealthRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate["schema"] !== PULSE_DRIVER_HEALTH_SCHEMA) return false;
  if (typeof candidate["pid"] !== "number") return false;
  if (typeof candidate["last_heartbeat_at"] !== "string") return false;
  if (typeof candidate["consecutive_failures"] !== "number") return false;
  const outcome = candidate["last_outcome"];
  if (outcome !== null && !isPulseOutcomeValue(outcome)) return false;
  const mechanism = candidate["lock_mechanism"];
  if (mechanism !== null && !isPulseLockMechanism(mechanism)) return false;
  return true;
}

export function writeDriverHealth(runRoot: string, record: PulseDriverHealthRecord): string {
  const path = pulseDriverHealthPath(runRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", "utf8");
  return path;
}

export function readDriverHealth(runRoot: string): PulseDriverHealthRecord | null {
  const path = pulseDriverHealthPath(runRoot);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isPulseDriverHealthRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
