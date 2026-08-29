import { DualTimeRecord, SchedulerWatchdogTelemetry, StepMachineTelemetry } from "./contracts.ts";
import { getDualTime, extractTimestampMs } from "./clock.ts";
import { calculateDuration } from "./intervals.ts";

/**
 * Calculates drift in milliseconds between expected tick time and actual tick time.
 */
export function calculateDrift(expectedMs: number, actualMs: number): number {
  return actualMs - expectedMs;
}

/**
 * Scheduler and watchdog telemetry factory.
 */
export function createSchedulerWatchdogTelemetry(params: {
  actor: string;
  component?: "scheduler" | "watchdog" | string | undefined;
  interval_ms: number;
  expected_tick_ms?: number | undefined;
  actual_tick?: Date | number | string | DualTimeRecord | undefined;
  start_time?: Date | number | string | DualTimeRecord | undefined;
  iteration?: number | undefined;
  details?: Record<string, unknown> | undefined;
  timezone?: string | undefined;
}): SchedulerWatchdogTelemetry {
  const actualDual = getDualTime(params.actual_tick ?? new Date(), params.timezone);
  const actualMs = actualDual.timestamp_ms;
  const expectedMs = params.expected_tick_ms ?? actualMs;
  const startMs =
    params.start_time !== undefined ? extractTimestampMs(params.start_time) : actualMs;

  const drift_ms = calculateDrift(expectedMs, actualMs);
  const elapsed_ms = Math.max(0, actualMs - startMs);

  return {
    tick_utc: actualDual.utc,
    tick_local: actualDual.local,
    tick_dual: actualDual,
    interval_ms: params.interval_ms,
    drift_ms,
    elapsed_ms,
    actor: params.actor,
    component: typeof params.component === "string" ? params.component : "scheduler",
    iteration: params.iteration,
    details: params.details,
  };
}

/**
 * Step machine and graph node dual-time telemetry factory.
 */
export function createStepMachineTelemetry(params: {
  step_id: string;
  step_name: string;
  state: string;
  actor: string;
  created_at?: Date | number | string | DualTimeRecord | undefined;
  started_at?: Date | number | string | DualTimeRecord | undefined;
  completed_at?: Date | number | string | DualTimeRecord | undefined;
  updated_at?: Date | number | string | DualTimeRecord | undefined;
  details?: Record<string, unknown> | undefined;
  timezone?: string | undefined;
}): StepMachineTelemetry {
  const created = getDualTime(params.created_at ?? new Date(), params.timezone);
  const updated = getDualTime(params.updated_at ?? created, params.timezone);
  const started =
    params.started_at !== undefined ? getDualTime(params.started_at, params.timezone) : undefined;
  const completed =
    params.completed_at !== undefined
      ? getDualTime(params.completed_at, params.timezone)
      : undefined;

  let duration_ms: number | undefined;
  let duration_formatted: string | undefined;

  if (started && completed) {
    const calc = calculateDuration(started, completed);
    duration_ms = calc.duration_ms;
    duration_formatted = calc.formatted;
  }

  return {
    step_id: params.step_id,
    step_name: params.step_name,
    state: params.state,
    actor: params.actor,
    created_dual: created,
    started_at: started,
    completed_at: completed,
    updated_dual: updated,
    duration_ms,
    duration_formatted,
    details: params.details,
  };
}

/**
 * Updates step machine telemetry record with state transitions or completion dual timestamps.
 */
export function updateStepMachineTelemetry(
  current: StepMachineTelemetry,
  update: {
    state?: string | undefined;
    started_at?: Date | number | string | DualTimeRecord | undefined;
    completed_at?: Date | number | string | DualTimeRecord | undefined;
    updated_at?: Date | number | string | DualTimeRecord | undefined;
    details?: Record<string, unknown> | undefined;
    timezone?: string | undefined;
  },
): StepMachineTelemetry {
  const started =
    update.started_at !== undefined
      ? getDualTime(update.started_at, update.timezone)
      : current.started_at;
  const completed =
    update.completed_at !== undefined
      ? getDualTime(update.completed_at, update.timezone)
      : current.completed_at;
  const updated = getDualTime(update.updated_at ?? new Date(), update.timezone);

  let duration_ms = current.duration_ms;
  let duration_formatted = current.duration_formatted;

  if (started && completed) {
    const calc = calculateDuration(started, completed);
    duration_ms = calc.duration_ms;
    duration_formatted = calc.formatted;
  }

  return {
    ...current,
    state: update.state ?? current.state,
    started_at: started,
    completed_at: completed,
    updated_dual: updated,
    duration_ms,
    duration_formatted,
    details:
      update.details !== undefined || current.details !== undefined
        ? { ...(current.details ?? {}), ...(update.details ?? {}) }
        : undefined,
  };
}
