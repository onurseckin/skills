import type { HarnessEvent } from "../core/contracts/capsule.ts";
import type { JsonObject } from "../core/contracts/json.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { loadRun } from "../engine/store/load.ts";
import { transact } from "../engine/store/transaction.ts";
import type { Clock } from "../workflow/types.ts";
import { writeLastPulse } from "./last-pulse.ts";

/**
 * Default consecutive-crash halt threshold. Shared so the classifier here, the rescue lane's
 * duplicate Rung 4 accounting (mind/lanes/rescue.ts), and the lane selector's halted precondition
 * (mind/lane.ts) cannot drift out of sync with each other.
 */
export const DEFAULT_CONSECUTIVE_CRASH_THRESHOLD = 3;

/**
 * Determines whether a pulse produced observable activity while it was open, derived strictly
 * from the capsule's own event log (never from wall-clock elapsed time).
 *
 * CLOSING_FORBIDDEN_FOR_MIND (mind/cadence.ts) means the Mind can never close a pulse itself, so
 * every pulse that reaches its deadline is, by construction, "unclosed" -- that alone cannot be
 * evidence of a crash. What distinguishes a genuine crash from a Mind that was working exactly as
 * its own invariant requires is whether anything was recorded in the hash chain after the pulse
 * opened.
 *
 * Anchor resolution, in order:
 * 1. The most recent "mind-pulse-opened" event whose payload.pulse_id matches this pulse. This is
 *    the precise anchor for the real mind:pulse-open flow.
 * 2. Fallback: the most recent "mind-initialized" event. Some capsules (including this module's
 *    own long-standing test fixtures) seed an already-open pulse directly into the founding state
 *    mutation rather than emitting a separate "mind-pulse-opened" event; treating that founding
 *    event as the anchor preserves those capsules' existing "no activity recorded" semantics.
 *
 * If neither anchor exists, no activity can be attributed to this pulse and it is not classified
 * as having produced activity.
 */
export function pulseProducedActivity(events: readonly HarnessEvent[], pulseId: string): boolean {
  let anchorSequence = 0;
  for (const event of events) {
    const matchesThisPulseOpen =
      event.kind === "mind-pulse-opened" &&
      typeof event.payload.pulse_id === "string" &&
      event.payload.pulse_id === pulseId;
    if (matchesThisPulseOpen || event.kind === "mind-initialized") {
      anchorSequence = event.sequence;
    }
  }
  if (anchorSequence === 0) return false;
  return events.some((event) => event.sequence > anchorSequence);
}

export interface PulseReclaimOptions {
  readonly actor?: string | undefined;
  readonly now?: number | Date | string | undefined;
  readonly clock?: Clock | undefined;
  readonly graceSeconds?: number | undefined;
  readonly pulseId?: string | undefined;
  readonly expectedPulseId?: string | undefined;
  readonly deterministicCrashThreshold?: number | undefined;
}

export interface PulseReclaimResult {
  readonly reclaimed: boolean;
  readonly pulseId?: string | undefined;
  readonly consecutiveCrashes: number;
  readonly halted: boolean;
  readonly haltReason?: string | undefined;
  readonly deadlinePassedByMs?: number | undefined;
  readonly evidence?: string | undefined;
  readonly reason?: string | undefined;
  /** Present only when reclaimed is true: the classification actually persisted to pulse.last.outcome. */
  readonly outcome?: "crashed" | "completed" | undefined;
}

function parseNowMs(nowInput?: number | Date | string | undefined): number {
  if (typeof nowInput === "number") return nowInput;
  if (nowInput instanceof Date) return nowInput.getTime();
  if (typeof nowInput === "string") {
    const parsed = Date.parse(nowInput);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/**
 * Reclaims a dead pulse open past its deadline (plus grace period) per PLAN.md §9.2/§9.3 and PHASE-2.md §3.5.
 *
 * Enforces:
 * 1. Pulse ID verification when an expected ID is specified.
 * 2. Configurable grace period bounds check (0 to 86,400 seconds).
 * 3. Crash counting across consecutive dead pulses.
 * 4. HALT escalation when 3 consecutive crashes are reached (poisoned capsule).
 * 5. Durably recording evidence ("no close within deadline") in events and last_pulse.json.
 */
export function reclaimDeadPulse(
  runRoot: string,
  options: PulseReclaimOptions = {},
): PulseReclaimResult {
  const nowMs = options.clock ? options.clock.now().getTime() : parseNowMs(options.now);
  const nowIso = new Date(nowMs).toISOString();

  const graceSeconds = options.graceSeconds ?? 0;
  if (!Number.isSafeInteger(graceSeconds) || graceSeconds < 0 || graceSeconds > 86_400) {
    throw new TypeError("grace_seconds must be an integer from 0 to 86400");
  }
  const graceMs = graceSeconds * 1000;

  const loaded = loadRun(runRoot, false);
  const state = loaded.state;
  const pulse = (state.pulse ?? {}) as Record<string, unknown>;
  const open = pulse.open as Record<string, unknown> | null | undefined;
  const lastPulse = (pulse.last ?? {}) as Record<string, unknown>;
  const mindState = (state.mind ?? {}) as Record<string, unknown>;

  const currentCrashes =
    lastPulse.outcome === "crashed" && typeof lastPulse.consecutive_crashes === "number"
      ? lastPulse.consecutive_crashes
      : 0;
  const currentlyHalted = mindState.halted === true;

  const targetPulseId = options.pulseId ?? options.expectedPulseId;

  // 1. Check if any pulse is open
  if (
    open === null ||
    open === undefined ||
    typeof open !== "object" ||
    typeof open.pulse_id !== "string"
  ) {
    if (targetPulseId !== undefined) {
      throw new HarnessError(
        "INVALID_STATE",
        `no active pulse is currently open to reclaim (expected pulse: '${targetPulseId}')`,
      );
    }
    return {
      reclaimed: false,
      consecutiveCrashes: currentCrashes,
      halted: currentlyHalted,
      ...(typeof mindState.halt_reason === "string" ? { haltReason: mindState.halt_reason } : {}),
      reason: "no open pulse",
    };
  }

  // 2. Pulse ID verification
  if (targetPulseId !== undefined && open.pulse_id !== targetPulseId) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `pulse id '${targetPulseId}' does not match open pulse id '${open.pulse_id}'`,
    );
  }

  // 3. Deadline + grace verification
  const deadlineStr = typeof open.deadline_at === "string" ? open.deadline_at : "";
  const deadlineMs = Date.parse(deadlineStr);
  if (!Number.isFinite(deadlineMs)) {
    throw new HarnessError(
      "INVALID_STATE",
      `invalid or missing deadline_at timestamp in open pulse: '${deadlineStr}'`,
    );
  }

  const effectiveDeadlineMs = deadlineMs + graceMs;
  if (nowMs <= effectiveDeadlineMs) {
    return {
      reclaimed: false,
      pulseId: open.pulse_id,
      consecutiveCrashes: currentCrashes,
      halted: currentlyHalted,
      ...(typeof mindState.halt_reason === "string" ? { haltReason: mindState.halt_reason } : {}),
      reason: "pulse is still within deadline and grace period",
    };
  }

  // 4. Deadline expired beyond grace: classify and execute reclaim.
  //
  // An unclosed pulse alone is never evidence of a crash (CLOSING_FORBIDDEN_FOR_MIND makes every
  // pulse unclosed by design). Whether this pulse actually crashed is decided by pulseId's
  // activity in the event log: a pulse that produced observable activity is classified
  // "completed", never "crashed", and does not extend or start a crash streak.
  const deadlinePassedByMs = Math.max(0, nowMs - deadlineMs);
  const pulseId = open.pulse_id;
  const producedActivity = pulseProducedActivity(loaded.events, pulseId);

  const threshold = options.deterministicCrashThreshold ?? DEFAULT_CONSECUTIVE_CRASH_THRESHOLD;
  const outcome: "crashed" | "completed" = producedActivity ? "completed" : "crashed";
  const consecutiveCrashCount = producedActivity ? 0 : currentCrashes + 1;
  const shouldHalt = !producedActivity && consecutiveCrashCount >= threshold;
  const haltReason = shouldHalt ? "consecutive pulse crashes threshold exceeded" : undefined;
  const evidence = producedActivity
    ? "no close within deadline, but activity recorded in the event log after the pulse opened; classified completed, not crashed"
    : "no close within deadline";
  const armMechanism = shouldHalt
    ? null
    : producedActivity
      ? "activity-recovery"
      : "crash-recovery";

  const reclaimActor = options.actor ?? (typeof open.actor === "string" ? open.actor : "mind");

  transact(
    runRoot,
    reclaimActor,
    "mind-pulse-reclaimed",
    {
      pulse_id: pulseId,
      deadline_passed_by_ms: deadlinePassedByMs,
      consecutive_crash_count: consecutiveCrashCount,
      evidence,
      grace_seconds: graceSeconds,
      halted: shouldHalt,
      outcome,
      produced_activity: producedActivity,
    },
    (working) => {
      const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
      const workingLast = (workingPulse.last ?? {}) as Record<string, unknown>;
      workingPulse.open = null;

      workingPulse.last = {
        ...workingLast,
        pulse_id: pulseId,
        opened_at: typeof open.opened_at === "string" ? open.opened_at : nowIso,
        closed_at: nowIso,
        outcome,
        value: 0,
        armed_interval_ms: shouldHalt
          ? null
          : ((workingLast.armed_interval_ms as number) ?? 900_000),
        armed_at: shouldHalt ? null : nowIso,
        arm_mechanism: armMechanism,
        next_wake_at: null,
        zero_value_streak: producedActivity
          ? 0
          : ((workingLast.zero_value_streak as number) ?? 0) + 1,
        consecutive_crashes: consecutiveCrashCount,
        terminal_reason: shouldHalt ? haltReason : null,
      };
      working.pulse = workingPulse as unknown as JsonObject;

      if (shouldHalt) {
        const workingMind = (working.mind ?? {}) as Record<string, unknown>;
        workingMind.halted = true;
        workingMind.halt_reason = haltReason;
        working.mind = workingMind as unknown as JsonObject;

        const workingEscalations = Array.isArray(working.escalations)
          ? [...working.escalations]
          : [];
        workingEscalations.push({
          id: `esc-crash-${nowMs}`,
          reason: "consecutive_pulse_crashes",
          detail: haltReason!,
          escalated_at: nowIso,
          resolved_at: null,
        });
        working.escalations = workingEscalations as unknown as JsonObject[];
      }
    },
  );

  try {
    writeLastPulse(runRoot, {
      at: nowIso,
      pulse_id: pulseId,
      outcome,
      next_wake_at: null,
    });
  } catch {
    // Best-effort write for external liveness reader
  }

  return {
    reclaimed: true,
    pulseId,
    consecutiveCrashes: consecutiveCrashCount,
    halted: shouldHalt,
    ...(haltReason !== undefined ? { haltReason } : {}),
    deadlinePassedByMs,
    evidence,
    outcome,
  };
}
