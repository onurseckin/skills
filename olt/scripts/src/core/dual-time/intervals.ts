import { randomUUID } from "node:crypto";
import {
  ActionTelemetry,
  DualTimeRecord,
  DurationResult,
  SubagentLifecycleTelemetry,
  SubagentStatus,
  TestStatus,
  ToolExecutionStatus,
  ToolExecutionTelemetry,
  UnitTestTelemetry,
  IndividualTestTiming,
} from "./contracts.ts";
import { getDualTime, extractTimestampMs } from "./clock.ts";
import { formatDuration, formatDualTimeDisplay } from "./formatting.ts";

/**
 * Calculates duration between two timestamps and returns duration in ms and formatted string.
 */
export function calculateDuration(
  start: DualTimeRecord | string | number | Date,
  end: DualTimeRecord | string | number | Date,
): DurationResult {
  const startMs = extractTimestampMs(start);
  const endMs = extractTimestampMs(end);
  const duration_ms = endMs - startMs;
  return {
    duration_ms,
    formatted: formatDuration(duration_ms),
  };
}

/**
 * Universal action telemetry creator with dual-time stamp, human-readable display string,
 * action type, actor identifier, and optional details.
 */
export function createActionTelemetry<
  TDetails extends Record<string, unknown> = Record<string, unknown>,
>(
  actionType: string,
  actor: string,
  details?: TDetails,
  timestamp?: Date | number | string | DualTimeRecord,
  timezone?: string,
): ActionTelemetry<TDetails> {
  const timeRecord = getDualTime(timestamp, timezone);
  return {
    action_id: randomUUID(),
    action_type: actionType,
    actor,
    timestamp: timeRecord,
    display_time: formatDualTimeDisplay(timeRecord),
    details: (details ?? {}) as TDetails,
  };
}

/**
 * Subagent Lifecycle Telemetry factory.
 */
export function createSubagentLifecycleTelemetry(params: {
  subagent_id: string;
  actor: string;
  role?: string | undefined;
  status?: SubagentStatus | undefined;
  spawned_at?: Date | number | string | DualTimeRecord | undefined;
  claimed_at?: Date | number | string | DualTimeRecord | undefined;
  heartbeat_at?: Date | number | string | DualTimeRecord | undefined;
  submitted_at?: Date | number | string | DualTimeRecord | undefined;
  reviewed_at?: Date | number | string | DualTimeRecord | undefined;
  metadata?: Record<string, unknown> | undefined;
  timezone?: string | undefined;
}): SubagentLifecycleTelemetry {
  const spawned =
    params.spawned_at !== undefined ? getDualTime(params.spawned_at, params.timezone) : undefined;
  const claimed =
    params.claimed_at !== undefined ? getDualTime(params.claimed_at, params.timezone) : undefined;
  const heartbeat =
    params.heartbeat_at !== undefined
      ? getDualTime(params.heartbeat_at, params.timezone)
      : undefined;
  const submitted =
    params.submitted_at !== undefined
      ? getDualTime(params.submitted_at, params.timezone)
      : undefined;
  const reviewed =
    params.reviewed_at !== undefined ? getDualTime(params.reviewed_at, params.timezone) : undefined;

  let duration_ms: number | undefined;
  let duration_formatted: string | undefined;

  const start = claimed ?? spawned;
  const end = reviewed ?? submitted;
  if (start && end) {
    const calc = calculateDuration(start, end);
    duration_ms = calc.duration_ms;
    duration_formatted = calc.formatted;
  }

  return {
    subagent_id: params.subagent_id,
    actor: params.actor,
    role: params.role,
    status: params.status ?? (spawned ? "spawned" : "running"),
    spawned_at: spawned,
    claimed_at: claimed,
    heartbeat_at: heartbeat,
    submitted_at: submitted,
    reviewed_at: reviewed,
    duration_ms,
    duration_formatted,
    metadata: params.metadata,
  };
}

/**
 * Updates an existing subagent lifecycle record with new state or timestamps.
 */
export function updateSubagentLifecycle(
  current: SubagentLifecycleTelemetry,
  update: {
    claimed_at?: Date | number | string | DualTimeRecord | undefined;
    heartbeat_at?: Date | number | string | DualTimeRecord | undefined;
    submitted_at?: Date | number | string | DualTimeRecord | undefined;
    reviewed_at?: Date | number | string | DualTimeRecord | undefined;
    status?: SubagentStatus | undefined;
    metadata?: Record<string, unknown> | undefined;
    timezone?: string | undefined;
  },
): SubagentLifecycleTelemetry {
  const claimed =
    update.claimed_at !== undefined
      ? getDualTime(update.claimed_at, update.timezone)
      : current.claimed_at;
  const heartbeat =
    update.heartbeat_at !== undefined
      ? getDualTime(update.heartbeat_at, update.timezone)
      : current.heartbeat_at;
  const submitted =
    update.submitted_at !== undefined
      ? getDualTime(update.submitted_at, update.timezone)
      : current.submitted_at;
  const reviewed =
    update.reviewed_at !== undefined
      ? getDualTime(update.reviewed_at, update.timezone)
      : current.reviewed_at;

  const start = claimed ?? current.spawned_at;
  const end = reviewed ?? submitted;
  let duration_ms = current.duration_ms;
  let duration_formatted = current.duration_formatted;

  if (start && end) {
    const calc = calculateDuration(start, end);
    duration_ms = calc.duration_ms;
    duration_formatted = calc.formatted;
  }

  return {
    ...current,
    status: update.status ?? current.status,
    claimed_at: claimed,
    heartbeat_at: heartbeat,
    submitted_at: submitted,
    reviewed_at: reviewed,
    duration_ms,
    duration_formatted,
    metadata:
      update.metadata !== undefined || current.metadata !== undefined
        ? { ...(current.metadata ?? {}), ...(update.metadata ?? {}) }
        : undefined,
  };
}

/**
 * Tool execution telemetry factory.
 */
export function createToolExecutionTelemetry(params: {
  tool_name: string;
  actor: string;
  started_at: Date | number | string | DualTimeRecord;
  finished_at?: Date | number | string | DualTimeRecord | undefined;
  status?: ToolExecutionStatus | undefined;
  parameters?: Record<string, unknown> | undefined;
  error?: string | undefined;
  details?: Record<string, unknown> | undefined;
  timezone?: string | undefined;
}): ToolExecutionTelemetry {
  const started = getDualTime(params.started_at, params.timezone);
  const finished = getDualTime(params.finished_at ?? new Date(), params.timezone);
  const calc = calculateDuration(started, finished);

  return {
    tool_name: params.tool_name,
    actor: params.actor,
    started_at: started,
    finished_at: finished,
    duration_ms: calc.duration_ms,
    duration_formatted: calc.formatted,
    status: params.status ?? (params.error ? "error" : "success"),
    parameters: params.parameters,
    error: params.error,
    details: params.details,
  };
}

/**
 * Unit test run and gates telemetry factory.
 */
export function createUnitTestTelemetry(params: {
  test_suite: string;
  actor: string;
  started_at: Date | number | string | DualTimeRecord;
  completed_at?: Date | number | string | DualTimeRecord | undefined;
  individual_tests?:
    | Array<{
        name: string;
        duration_ms?: number | undefined;
        status: TestStatus;
        started_at?: Date | number | string | DualTimeRecord | undefined;
        completed_at?: Date | number | string | DualTimeRecord | undefined;
        error?: string | undefined;
      }>
    | undefined;
  details?: Record<string, unknown> | undefined;
  timezone?: string | undefined;
}): UnitTestTelemetry {
  const started = getDualTime(params.started_at, params.timezone);
  const completed = getDualTime(params.completed_at ?? new Date(), params.timezone);
  const calc = calculateDuration(started, completed);

  const tests: IndividualTestTiming[] = (params.individual_tests ?? []).map((t) => {
    let testDurationMs = t.duration_ms;
    const testStarted =
      t.started_at !== undefined ? getDualTime(t.started_at, params.timezone) : undefined;
    const testCompleted =
      t.completed_at !== undefined ? getDualTime(t.completed_at, params.timezone) : undefined;

    if (testDurationMs === undefined && testStarted && testCompleted) {
      testDurationMs = calculateDuration(testStarted, testCompleted).duration_ms;
    }
    const finalMs = typeof testDurationMs === "number" ? testDurationMs : 0;

    return {
      name: t.name,
      duration_ms: finalMs,
      duration_formatted: formatDuration(finalMs),
      status: t.status,
      started_at: testStarted,
      completed_at: testCompleted,
      error: t.error,
    };
  });

  const passed_count = tests.filter((t) => t.status === "pass").length;
  const failed_count = tests.filter((t) => t.status === "fail").length;
  const skipped_count = tests.filter((t) => t.status === "skip").length;
  const passed = failed_count === 0;

  return {
    test_suite: params.test_suite,
    actor: params.actor,
    started_at: started,
    completed_at: completed,
    test_duration_ms: calc.duration_ms,
    test_duration_formatted: calc.formatted,
    individual_tests: tests,
    passed,
    passed_count,
    failed_count,
    skipped_count,
    details: params.details,
  };
}
