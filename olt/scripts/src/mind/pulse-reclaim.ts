import type { JsonObject } from "../core/contracts/json.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { loadRun } from "../engine/store/load.ts";
import { transact } from "../engine/store/transaction.ts";
import type { Clock } from "../workflow/types.ts";
import { writeLastPulse } from "./last-pulse.ts";

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

  // 4. Deadline expired beyond grace: execute reclaim
  const deadlinePassedByMs = Math.max(0, nowMs - deadlineMs);
  const consecutiveCrashCount = currentCrashes + 1;
  const threshold = options.deterministicCrashThreshold ?? 3;
  const shouldHalt = consecutiveCrashCount >= threshold;
  const haltReason = shouldHalt ? "consecutive pulse crashes threshold exceeded" : undefined;
  const evidence = "no close within deadline";

  const reclaimActor = options.actor ?? (typeof open.actor === "string" ? open.actor : "mind");

  transact(
    runRoot,
    reclaimActor,
    "mind-pulse-reclaimed",
    {
      pulse_id: open.pulse_id,
      deadline_passed_by_ms: deadlinePassedByMs,
      consecutive_crash_count: consecutiveCrashCount,
      evidence,
      grace_seconds: graceSeconds,
      halted: shouldHalt,
    },
    (working) => {
      const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
      const workingLast = (workingPulse.last ?? {}) as Record<string, unknown>;
      workingPulse.open = null;

      workingPulse.last = {
        ...workingLast,
        pulse_id: open.pulse_id,
        opened_at: typeof open.opened_at === "string" ? open.opened_at : nowIso,
        closed_at: nowIso,
        outcome: "crashed",
        value: 0,
        armed_interval_ms: shouldHalt
          ? null
          : ((workingLast.armed_interval_ms as number) ?? 900_000),
        armed_at: shouldHalt ? null : nowIso,
        arm_mechanism: shouldHalt ? null : "crash-recovery",
        next_wake_at: null,
        zero_value_streak: ((workingLast.zero_value_streak as number) ?? 0) + 1,
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
      pulse_id: open.pulse_id,
      outcome: "crashed",
      next_wake_at: null,
    });
  } catch {
    // Best-effort write for external liveness reader
  }

  return {
    reclaimed: true,
    pulseId: open.pulse_id,
    consecutiveCrashes: consecutiveCrashCount,
    halted: shouldHalt,
    ...(haltReason !== undefined ? { haltReason } : {}),
    deadlinePassedByMs,
    evidence,
  };
}
