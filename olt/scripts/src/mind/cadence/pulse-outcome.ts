import {
  PULSE_EXIT_FAILED,
  PULSE_EXIT_RAN,
  PULSE_EXIT_RAN_UNDISPATCHED,
  PULSE_EXIT_RAN_UNLOCKED,
  PULSE_EXIT_SKIPPED_LOCKED,
  PULSE_LOCK_MECHANISMS,
  type PulseLockMechanism,
  type PulseOutcome,
} from "./types.ts";

export function classifyPulseExit(exitCode: number | null): PulseOutcome {
  if (exitCode === null) return "unknown";
  if (exitCode === PULSE_EXIT_RAN) return "ran";
  if (exitCode === PULSE_EXIT_RAN_UNLOCKED) return "ran_unlocked";
  if (exitCode === PULSE_EXIT_RAN_UNDISPATCHED) return "ran_undispatched";
  if (exitCode === PULSE_EXIT_SKIPPED_LOCKED) return "skipped_locked";
  if (exitCode === PULSE_EXIT_FAILED) return "failed";
  return "failed";
}

export function pulseOutcomeExitCode(outcome: PulseOutcome): number | null {
  switch (outcome) {
    case "ran":
      return PULSE_EXIT_RAN;
    case "ran_unlocked":
      return PULSE_EXIT_RAN_UNLOCKED;
    case "ran_undispatched":
      return PULSE_EXIT_RAN_UNDISPATCHED;
    case "skipped_locked":
      return PULSE_EXIT_SKIPPED_LOCKED;
    case "failed":
      return PULSE_EXIT_FAILED;
    case "unknown":
      return null;
  }
}

export function didPulseAdvanceCadence(outcome: PulseOutcome): boolean {
  return outcome === "ran" || outcome === "ran_unlocked" || outcome === "ran_undispatched";
}

export function isPulseOutcomePageworthy(outcome: PulseOutcome): boolean {
  return outcome === "failed" || outcome === "unknown";
}

export function isPulseOutcomeDegraded(outcome: PulseOutcome): boolean {
  return outcome === "ran_unlocked" || outcome === "ran_undispatched";
}

export function isPulseLockMechanism(value: unknown): value is PulseLockMechanism {
  return typeof value === "string" && (PULSE_LOCK_MECHANISMS as readonly string[]).includes(value);
}

export function parsePulseLockMechanism(stderr: string): PulseLockMechanism | null {
  const match = /pulse_lock_mechanism=([a-z0-9]+)/.exec(stderr);
  if (match === null) return null;
  const candidate = match[1];
  return isPulseLockMechanism(candidate) ? candidate : null;
}

export function describePulseOutcome(outcome: PulseOutcome): string {
  switch (outcome) {
    case "ran":
      return "pulse ran under an exclusive lock";
    case "ran_unlocked":
      return "pulse ran with NO lock primitive available (flock, perl and python3 all absent)";
    case "ran_undispatched":
      return "pulse ran but reached NO host: no PULSE_HOST_CMD is configured, so nothing consumed the brief and the pulse accomplished nothing";
    case "skipped_locked":
      return "pulse skipped because a peer holds the pulse lock";
    case "failed":
      return "pulse could not complete";
    case "unknown":
      return "pulse produced no exit status";
  }
}
