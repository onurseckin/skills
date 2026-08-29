import { loadRun } from "../../../../engine/store/index.ts";
import type { JsonObject } from "../../../../core/contracts/index.ts";
import { transact } from "../../../../engine/store/index.ts";
import type { Rung5Result } from "../types.ts";

export function executeRung5(params: {
  readonly mindRunRoot: string;
  readonly loadedMind: ReturnType<typeof loadRun>;
  readonly actor: string;
  readonly nowMs: number;
  readonly nowIso: string;
  readonly actionsTaken: string[];
  readonly escalations: string[];
}): Rung5Result {
  const { mindRunRoot, loadedMind, actor, nowMs, nowIso, actionsTaken, escalations } = params;

  let gapExceeded = false;
  let gapMs: number | undefined;
  let armedIntervalMs: number | undefined;
  let driverLatenessMs: number | undefined;
  let gapNotified = false;

  const pulseState = (loadedMind.state.pulse ?? {}) as Record<string, unknown>;
  const lastPulse = pulseState.last as Record<string, unknown> | undefined;

  if (lastPulse) {
    const closedAtMs = lastPulse.closed_at ? Date.parse(lastPulse.closed_at as string) : NaN;
    const startedAtMs = lastPulse.started_at ? Date.parse(lastPulse.started_at as string) : NaN;
    const referencePulseMs = Number.isFinite(closedAtMs)
      ? closedAtMs
      : Number.isFinite(startedAtMs)
        ? startedAtMs
        : NaN;

    if (Number.isFinite(referencePulseMs)) {
      gapMs = Math.max(0, nowMs - referencePulseMs);
      armedIntervalMs = (lastPulse.armed_interval_ms as number) ?? 900_000;
      const allowedGapMs = armedIntervalMs * 2;

      if (gapMs > allowedGapMs) {
        gapExceeded = true;
        driverLatenessMs = gapMs - armedIntervalMs;
        const msg = `GAP: Mind driver inactive for ${Math.round(gapMs / 1000)}s (armed interval: ${Math.round(armedIntervalMs / 1000)}s, factor: ${(gapMs / armedIntervalMs).toFixed(1)}x)`;
        actionsTaken.push(`Rung 5: ${msg}`);
        escalations.push(msg);
        gapNotified = true;

        transact(
          mindRunRoot,
          actor,
          "mind-driver-gap-observed",
          {
            gap_ms: gapMs,
            armed_interval_ms: armedIntervalMs,
            driver_lateness_ms: driverLatenessMs,
            factor: gapMs / armedIntervalMs,
          },
          (working) => {
            const observations = Array.isArray(working.observations)
              ? [...working.observations]
              : [];
            observations.push({
              id: `obs-gap-${nowMs}`,
              source: "driver-gap",
              count: 1,
              observed_at: nowIso,
              evidence_class: "harness_observed",
              detail: {
                gap_ms: gapMs,
                armed_interval_ms: armedIntervalMs,
                driver_lateness_ms: driverLatenessMs,
              },
            } as unknown as JsonObject);
            working.observations = observations as unknown as JsonObject[];
          },
        );
      }
    }
  }

  return {
    gapExceeded,
    ...(gapMs !== undefined ? { gapMs } : {}),
    ...(armedIntervalMs !== undefined ? { armedIntervalMs } : {}),
    ...(driverLatenessMs !== undefined ? { driverLatenessMs } : {}),
    notified: gapNotified,
  };
}
