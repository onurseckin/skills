import type { ReactiveEvent, ReactiveWakeupTrigger } from "./types.ts";

export function resolveTimestampMs(now?: string | number | Date): number {
  const timeMs =
    typeof now === "number"
      ? now
      : now instanceof Date
        ? now.getTime()
        : typeof now === "string"
          ? Date.parse(now)
          : Date.now();
  return Number.isFinite(timeMs) ? timeMs : Date.now();
}

export function normalizeReactiveTrigger(
  trigger?: ReactiveWakeupTrigger,
  currentTime?: string | number | Date,
): { normalized: ReactiveEvent; resolvedMs: number } {
  const resolvedMs = resolveTimestampMs(currentTime);
  const isoTimestamp = new Date(resolvedMs).toISOString();

  const normalized: ReactiveEvent =
    typeof trigger === "string"
      ? { type: trigger, timestamp: isoTimestamp }
      : trigger && typeof trigger === "object"
        ? {
            type: trigger.type,
            ...(trigger.source !== undefined ? { source: trigger.source } : {}),
            ...(trigger.taskId !== undefined ? { taskId: trigger.taskId } : {}),
            ...(trigger.agentId !== undefined ? { agentId: trigger.agentId } : {}),
            timestamp: trigger.timestamp ?? isoTimestamp,
            ...(trigger.payload !== undefined ? { payload: trigger.payload } : {}),
          }
        : { type: "reactive_wakeup", timestamp: isoTimestamp };

  return { normalized, resolvedMs };
}
