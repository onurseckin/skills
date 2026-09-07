import { describe, expect, it } from "bun:test";
import {
  PULSE_EXIT_FAILED,
  PULSE_EXIT_RAN,
  PULSE_EXIT_RAN_UNDISPATCHED,
  PULSE_EXIT_RAN_UNLOCKED,
  PULSE_EXIT_SKIPPED_LOCKED,
  classifyPulseExit,
  decideNextPulse,
  describePulseOutcome,
  didPulseAdvanceCadence,
  isPulseLockMechanism,
  isPulseOutcomeDegraded,
  isPulseOutcomePageworthy,
  parsePulseLockMechanism,
  pulseOutcomeExitCode,
} from "../../../olt/scripts/src/mind/cadence/index.ts";

describe("pulse outcome classification", () => {
  it("maps every pulse exit code to a distinct outcome", () => {
    expect(classifyPulseExit(PULSE_EXIT_RAN)).toBe("ran");
    expect(classifyPulseExit(PULSE_EXIT_RAN_UNLOCKED)).toBe("ran_unlocked");
    expect(classifyPulseExit(PULSE_EXIT_RAN_UNDISPATCHED)).toBe("ran_undispatched");
    expect(classifyPulseExit(PULSE_EXIT_SKIPPED_LOCKED)).toBe("skipped_locked");
    expect(classifyPulseExit(PULSE_EXIT_FAILED)).toBe("failed");
    expect(classifyPulseExit(null)).toBe("unknown");
    const outcomes = new Set([
      classifyPulseExit(PULSE_EXIT_RAN),
      classifyPulseExit(PULSE_EXIT_RAN_UNLOCKED),
      classifyPulseExit(PULSE_EXIT_RAN_UNDISPATCHED),
      classifyPulseExit(PULSE_EXIT_SKIPPED_LOCKED),
      classifyPulseExit(PULSE_EXIT_FAILED),
      classifyPulseExit(null),
    ]);
    expect(outcomes.size).toBe(6);
  });

  it("does not collapse contention onto success, which is the defect being fixed", () => {
    expect(classifyPulseExit(PULSE_EXIT_SKIPPED_LOCKED)).not.toBe(
      classifyPulseExit(PULSE_EXIT_RAN),
    );
    expect(PULSE_EXIT_SKIPPED_LOCKED).not.toBe(PULSE_EXIT_RAN);
  });

  it("treats an unmapped nonzero code as a failure rather than a success", () => {
    expect(classifyPulseExit(1)).toBe("failed");
    expect(classifyPulseExit(137)).toBe("failed");
  });

  it("round-trips outcomes back to their exit codes", () => {
    expect(pulseOutcomeExitCode("ran")).toBe(PULSE_EXIT_RAN);
    expect(pulseOutcomeExitCode("ran_unlocked")).toBe(PULSE_EXIT_RAN_UNLOCKED);
    expect(pulseOutcomeExitCode("ran_undispatched")).toBe(PULSE_EXIT_RAN_UNDISPATCHED);
    expect(pulseOutcomeExitCode("skipped_locked")).toBe(PULSE_EXIT_SKIPPED_LOCKED);
    expect(pulseOutcomeExitCode("failed")).toBe(PULSE_EXIT_FAILED);
    expect(pulseOutcomeExitCode("unknown")).toBeNull();
  });

  it("pages on a genuine failure and stays silent on a genuine peer skip", () => {
    expect(isPulseOutcomePageworthy("failed")).toBe(true);
    expect(isPulseOutcomePageworthy("unknown")).toBe(true);
    expect(isPulseOutcomePageworthy("skipped_locked")).toBe(false);
    expect(isPulseOutcomePageworthy("ran")).toBe(false);
    expect(isPulseOutcomePageworthy("ran_unlocked")).toBe(false);
    expect(isPulseOutcomePageworthy("ran_undispatched")).toBe(false);
  });

  it("never lets an inert pulse read as plain success", () => {
    expect(classifyPulseExit(PULSE_EXIT_RAN_UNDISPATCHED)).not.toBe("ran");
    expect(isPulseOutcomeDegraded("ran_undispatched")).toBe(true);
    expect(isPulseOutcomeDegraded("ran")).toBe(false);
    expect(describePulseOutcome("ran_undispatched")).toContain("reached NO host");
    expect(describePulseOutcome("ran_undispatched")).toContain("accomplished nothing");
    expect(describePulseOutcome("ran")).not.toContain("reached NO host");
  });

  it("counts only a real pulse as cadence advancement", () => {
    expect(didPulseAdvanceCadence("ran")).toBe(true);
    expect(didPulseAdvanceCadence("ran_unlocked")).toBe(true);
    expect(didPulseAdvanceCadence("ran_undispatched")).toBe(true);
    expect(didPulseAdvanceCadence("skipped_locked")).toBe(false);
    expect(didPulseAdvanceCadence("failed")).toBe(false);
    expect(didPulseAdvanceCadence("unknown")).toBe(false);
  });

  it("marks a lockless pulse degraded and says so in plain words", () => {
    expect(isPulseOutcomeDegraded("ran_unlocked")).toBe(true);
    expect(isPulseOutcomeDegraded("ran")).toBe(false);
    expect(describePulseOutcome("ran_unlocked")).toContain("NO lock primitive");
    expect(describePulseOutcome("ran")).not.toContain("NO lock primitive");
    expect(describePulseOutcome("skipped_locked")).toContain("peer");
  });

  it("parses the lock mechanism the pulse reports and rejects anything else", () => {
    expect(parsePulseLockMechanism("pulse_status=ran pulse_lock_mechanism=perl x")).toBe("perl");
    expect(parsePulseLockMechanism("pulse_lock_mechanism=none")).toBe("none");
    expect(parsePulseLockMechanism("pulse_lock_mechanism=flock")).toBe("flock");
    expect(parsePulseLockMechanism("pulse_lock_mechanism=wishful")).toBeNull();
    expect(parsePulseLockMechanism("nothing here")).toBeNull();
    expect(isPulseLockMechanism("python3")).toBe(true);
    expect(isPulseLockMechanism("sqlite")).toBe(false);
  });
});

describe("pulse schedule decision", () => {
  const baseMs = Date.parse("2026-09-07T18:00:00.000Z");

  it("fires when the armed deadline has passed and waits when it has not", () => {
    const passed = decideNextPulse({
      nowMs: baseMs,
      nextWakeAt: "2026-09-07T17:45:00.000Z",
      lastAttemptAtMs: null,
      minIntervalMs: 60000,
      maxSliceMs: 60000,
    });
    expect(passed.due).toBe(true);
    expect(passed.reason).toBe("deadline_passed");

    const pending = decideNextPulse({
      nowMs: baseMs,
      nextWakeAt: "2026-09-07T18:00:30.000Z",
      lastAttemptAtMs: null,
      minIntervalMs: 60000,
      maxSliceMs: 60000,
    });
    expect(pending.due).toBe(false);
    expect(pending.reason).toBe("deadline_pending");
    expect(pending.waitMs).toBe(30000);
  });

  it("clamps a far deadline to one wait slice instead of sleeping through it", () => {
    const decision = decideNextPulse({
      nowMs: baseMs,
      nextWakeAt: "2026-09-07T19:00:00.000Z",
      lastAttemptAtMs: null,
      minIntervalMs: 60000,
      maxSliceMs: 60000,
    });
    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("slice_clamped");
    expect(decision.waitMs).toBe(60000);
  });

  it("fires immediately when no pulse was ever armed, and when the arm is unreadable", () => {
    expect(
      decideNextPulse({
        nowMs: baseMs,
        nextWakeAt: null,
        lastAttemptAtMs: null,
        minIntervalMs: 60000,
        maxSliceMs: 60000,
      }).reason,
    ).toBe("no_prior_pulse");
    expect(
      decideNextPulse({
        nowMs: baseMs,
        nextWakeAt: "not-a-timestamp",
        lastAttemptAtMs: null,
        minIntervalMs: 60000,
        maxSliceMs: 60000,
      }).reason,
    ).toBe("deadline_unparsable");
  });

  it("refuses to hammer a permanently overdue capsule until the cooldown elapses", () => {
    const overdue = "2026-09-06T20:46:43.287Z";
    const cooling = decideNextPulse({
      nowMs: baseMs,
      nextWakeAt: overdue,
      lastAttemptAtMs: baseMs - 10000,
      minIntervalMs: 60000,
      maxSliceMs: 60000,
    });
    expect(cooling.due).toBe(false);
    expect(cooling.reason).toBe("cooldown");
    expect(cooling.waitMs).toBe(50000);

    const elapsed = decideNextPulse({
      nowMs: baseMs,
      nextWakeAt: overdue,
      lastAttemptAtMs: baseMs - 60001,
      minIntervalMs: 60000,
      maxSliceMs: 60000,
    });
    expect(elapsed.due).toBe(true);
    expect(elapsed.reason).toBe("deadline_passed");
  });
});
