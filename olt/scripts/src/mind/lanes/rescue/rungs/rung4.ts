import { loadRun } from "../../../../engine/store/index.ts";
import type { JsonObject } from "../../../../core/contracts/index.ts";
import { transact } from "../../../../engine/store/index.ts";
import { writeLastPulse } from "../../../lifecycle/pulse/last-pulse.ts";
import {
  DEFAULT_CONSECUTIVE_CRASH_THRESHOLD,
  pulseProducedActivity,
} from "../../../lifecycle/pulse/pulse-reclaim.ts";
import type { Rung4Result } from "../types.ts";

export function executeRung4(params: {
  readonly mindRunRoot: string;
  readonly loadedMind: ReturnType<typeof loadRun>;
  readonly actor: string;
  readonly nowMs: number;
  readonly nowIso: string;
  readonly actionsTaken: string[];
  readonly escalations: string[];
}): Rung4Result {
  const { mindRunRoot, loadedMind, actor, nowMs, nowIso, actionsTaken, escalations } = params;

  let deadPulseReclaimed = false;
  let reclaimedPulseId: string | undefined;
  let rung4Halted = false;
  let rung4HaltReason: string | undefined;

  const pulseState = (loadedMind.state.pulse ?? {}) as Record<string, unknown>;
  const openPulse = pulseState.open as Record<string, unknown> | null | undefined;
  const lastPulse = pulseState.last as Record<string, unknown> | undefined;
  let consecutiveCrashes =
    typeof lastPulse?.consecutive_crashes === "number" ? lastPulse.consecutive_crashes : 0;

  if (
    openPulse !== null &&
    openPulse !== undefined &&
    typeof openPulse === "object" &&
    typeof openPulse.pulse_id === "string" &&
    typeof openPulse.deadline_at === "string"
  ) {
    const deadlineMs = Date.parse(openPulse.deadline_at);
    if (Number.isFinite(deadlineMs) && nowMs > deadlineMs) {
      deadPulseReclaimed = true;
      reclaimedPulseId = openPulse.pulse_id;
      const deadlinePassedByMs = Math.max(0, nowMs - deadlineMs);

      const producedActivity = pulseProducedActivity(loadedMind.events, openPulse.pulse_id);
      const outcome: "crashed" | "completed" = producedActivity ? "completed" : "crashed";
      consecutiveCrashes = producedActivity ? 0 : consecutiveCrashes + 1;

      actionsTaken.push(
        producedActivity
          ? `Rung 4: reclaimed pulse ${openPulse.pulse_id} (deadline passed by ${Math.round(deadlinePassedByMs / 1000)}s; activity recorded in event log -- classified completed, crash streak reset)`
          : `Rung 4: reclaimed dead pulse ${openPulse.pulse_id} (deadline passed by ${Math.round(deadlinePassedByMs / 1000)}s; consecutive crashes: ${consecutiveCrashes})`,
      );

      if (!producedActivity && consecutiveCrashes >= DEFAULT_CONSECUTIVE_CRASH_THRESHOLD) {
        rung4Halted = true;
        rung4HaltReason = "consecutive pulse crashes threshold exceeded";
        actionsTaken.push(`Rung 4: HALT triggered due to ${rung4HaltReason}`);
        escalations.push(rung4HaltReason);
      }

      transact(
        mindRunRoot,
        actor,
        "mind-pulse-reclaimed",
        {
          pulse_id: openPulse.pulse_id,
          deadline_passed_by_ms: deadlinePassedByMs,
          consecutive_crash_count: consecutiveCrashes,
          outcome,
          produced_activity: producedActivity,
        },
        (working) => {
          const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
          const workingLast = (workingPulse.last ?? {}) as Record<string, unknown>;
          workingPulse.open = null;

          workingPulse.last = {
            ...workingLast,
            pulse_id: openPulse.pulse_id,
            closed_at: nowIso,
            outcome,
            value: 0,
            armed_interval_ms: workingLast.armed_interval_ms ?? 900_000,
            armed_at: nowIso,
            arm_mechanism: producedActivity ? "activity-recovery" : "crash-recovery",
            zero_value_streak: producedActivity
              ? 0
              : ((workingLast.zero_value_streak as number) ?? 0) + 1,
            consecutive_crashes: consecutiveCrashes,
          };
          working.pulse = workingPulse as unknown as JsonObject;

          if (rung4Halted) {
            const workingMind = (working.mind ?? {}) as Record<string, unknown>;
            workingMind.halted = true;
            workingMind.halt_reason = rung4HaltReason;
            working.mind = workingMind as unknown as JsonObject;

            const workingEscalations = Array.isArray(working.escalations)
              ? [...working.escalations]
              : [];
            workingEscalations.push({
              id: `esc-crashes-${nowMs}`,
              reason: "consecutive_pulse_crashes",
              detail: rung4HaltReason ?? "",
              escalated_at: nowIso,
              resolved_at: null,
            } as unknown as JsonObject);
            working.escalations = workingEscalations as unknown as JsonObject[];
          }
        },
      );

      try {
        writeLastPulse(mindRunRoot, {
          at: nowIso,
          pulse_id: openPulse.pulse_id,
          outcome,
          next_wake_at: null,
        });
      } catch {
        // best effort
      }
    }
  }

  return {
    deadPulseReclaimed: reclaimedPulseId !== undefined,
    ...(reclaimedPulseId !== undefined ? { reclaimedPulseId } : {}),
    consecutiveCrashes,
    halted: rung4Halted,
    ...(rung4HaltReason !== undefined ? { haltReason: rung4HaltReason } : {}),
  };
}
