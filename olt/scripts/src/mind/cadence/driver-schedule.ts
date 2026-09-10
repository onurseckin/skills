import type { PulseScheduleDecision, PulseScheduleInput } from "./types.ts";

export const CLOSING_FORBIDDEN_FOR_MIND = "CLOSING_FORBIDDEN_FOR_MIND" as const;
export const DEFAULT_MIN_PULSE_INTERVAL_MS = 60000;
export const DEFAULT_MAX_WAIT_SLICE_MS = 60000;

function clampSlice(waitMs: number, maxSliceMs: number): number {
  if (waitMs <= 0) return 0;
  return waitMs > maxSliceMs ? maxSliceMs : waitMs;
}

export function enforceInfiniteCadence(decision: PulseScheduleDecision): PulseScheduleDecision {
  if (!decision.due && decision.waitMs <= 0) {
    return {
      ...decision,
      due: true,
      waitMs: 0,
    };
  }
  return decision;
}

function isBlankTimestamp(ts: string | null): boolean {
  if (ts === null) return true;
  return ts.trim() === "";
}

export function decideNextPulse(input: PulseScheduleInput): PulseScheduleDecision {
  const minIntervalMs = input.minIntervalMs > 0 ? input.minIntervalMs : 0;
  const maxSliceMs = input.maxSliceMs > 0 ? input.maxSliceMs : DEFAULT_MAX_WAIT_SLICE_MS;

  const cooldownRemainingMs =
    input.lastAttemptAtMs === null ? 0 : input.lastAttemptAtMs + minIntervalMs - input.nowMs;

  const isBlank = isBlankTimestamp(input.nextWakeAt);
  const deadlineMs = isBlank
    ? null
    : input.nextWakeAt !== null
      ? Date.parse(input.nextWakeAt)
      : null;
  const deadlineParsed = deadlineMs !== null && Number.isFinite(deadlineMs);

  if (cooldownRemainingMs > 0) {
    return enforceInfiniteCadence({
      due: false,
      waitMs: clampSlice(cooldownRemainingMs, maxSliceMs),
      reason: "cooldown",
      deadlineMs: deadlineParsed ? deadlineMs : null,
    });
  }

  if (isBlank) {
    // Under CLOSING_FORBIDDEN_FOR_MIND, clear queues or absence of deadline triggers autonomous pulse immediately
    return { due: true, waitMs: 0, reason: "no_prior_pulse", deadlineMs: null };
  }

  if (!deadlineParsed) {
    return { due: true, waitMs: 0, reason: "deadline_unparsable", deadlineMs: null };
  }

  const remainingMs = deadlineMs - input.nowMs;
  if (remainingMs <= 0) {
    return { due: true, waitMs: 0, reason: "deadline_passed", deadlineMs };
  }

  return enforceInfiniteCadence({
    due: false,
    waitMs: clampSlice(remainingMs, maxSliceMs),
    reason: remainingMs > maxSliceMs ? "slice_clamped" : "deadline_pending",
    deadlineMs,
  });
}
