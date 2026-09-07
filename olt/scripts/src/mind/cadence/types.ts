export const PULSE_EXIT_RAN = 0;
export const PULSE_EXIT_FAILED = 70;
export const PULSE_EXIT_RAN_UNLOCKED = 71;
export const PULSE_EXIT_RAN_UNDISPATCHED = 72;
export const PULSE_EXIT_SKIPPED_LOCKED = 75;

export const PULSE_OUTCOMES = [
  "ran",
  "ran_unlocked",
  "ran_undispatched",
  "skipped_locked",
  "failed",
  "unknown",
] as const;

export type PulseOutcome = (typeof PULSE_OUTCOMES)[number];

export const PULSE_LOCK_MECHANISMS = ["flock", "perl", "python3", "none"] as const;

export type PulseLockMechanism = (typeof PULSE_LOCK_MECHANISMS)[number];

export const PULSE_WAIT_REASONS = [
  "no_prior_pulse",
  "deadline_passed",
  "deadline_unparsable",
  "deadline_pending",
  "slice_clamped",
  "cooldown",
] as const;

export type PulseWaitReason = (typeof PULSE_WAIT_REASONS)[number];

export interface PulseScheduleInput {
  readonly nowMs: number;
  readonly nextWakeAt: string | null;
  readonly lastAttemptAtMs: number | null;
  readonly minIntervalMs: number;
  readonly maxSliceMs: number;
}

export interface PulseScheduleDecision {
  readonly due: boolean;
  readonly waitMs: number;
  readonly reason: PulseWaitReason;
  readonly deadlineMs: number | null;
}

export const PULSE_DRIVER_HEALTH_SCHEMA = "olt.pulse-driver.health/1";

export interface PulseDriverHealthRecord {
  readonly schema: typeof PULSE_DRIVER_HEALTH_SCHEMA;
  readonly run_root: string;
  readonly pid: number;
  readonly started_at: string;
  readonly last_heartbeat_at: string;
  readonly last_attempt_at: string | null;
  readonly last_outcome: PulseOutcome | null;
  readonly last_exit_code: number | null;
  readonly lock_mechanism: PulseLockMechanism | null;
  readonly next_wake_at: string | null;
  readonly pulses_ran: number;
  readonly pulses_skipped_locked: number;
  readonly pulses_failed: number;
  readonly consecutive_failures: number;
  readonly recent_errors: readonly string[];
}

export const PULSE_DRIVER_STATES = ["LIVE", "DEGRADED", "FAILING", "STALE", "DEAD"] as const;

export type PulseDriverObservedState = (typeof PULSE_DRIVER_STATES)[number];

export interface PulseDriverCounters {
  readonly pulses_ran: number;
  readonly pulses_skipped_locked: number;
  readonly pulses_failed: number;
  readonly consecutive_failures: number;
  readonly last_attempt_at_ms: number | null;
  readonly last_outcome: PulseOutcome | null;
  readonly last_exit_code: number | null;
  readonly lock_mechanism: PulseLockMechanism | null;
  readonly recent_errors: readonly string[];
}

export interface PulseInvocationResult {
  readonly exitCode: number | null;
  readonly lockMechanism: PulseLockMechanism | null;
  readonly stderr: string;
}
