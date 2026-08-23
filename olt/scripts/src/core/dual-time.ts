import { randomUUID } from "node:crypto";
import { HarnessError } from "./errors/harness-error.ts";

/**
 * Universal Dual-Time Record containing full UTC and local time representation,
 * time zone identifier, signed offset in minutes, and Unix epoch milliseconds.
 */
export interface DualTimeRecord {
  utc: string;
  local: string;
  timezone: string;
  offset_minutes: number;
  timestamp_ms: number;
}

export interface DurationResult {
  duration_ms: number;
  formatted: string;
}

export interface ActionTelemetry<
  TDetails extends Record<string, unknown> = Record<string, unknown>,
> {
  action_id: string;
  action_type: string;
  actor: string;
  timestamp: DualTimeRecord;
  display_time: string;
  details: TDetails;
}

export type SubagentStatus =
  | "spawned"
  | "claimed"
  | "running"
  | "submitted"
  | "reviewed"
  | "failed"
  | "timed_out";

export interface SubagentLifecycleTelemetry {
  subagent_id: string;
  actor: string;
  role?: string | undefined;
  spawned_at?: DualTimeRecord | undefined;
  claimed_at?: DualTimeRecord | undefined;
  heartbeat_at?: DualTimeRecord | undefined;
  submitted_at?: DualTimeRecord | undefined;
  reviewed_at?: DualTimeRecord | undefined;
  duration_ms?: number | undefined;
  duration_formatted?: string | undefined;
  status: SubagentStatus;
  metadata?: Record<string, unknown> | undefined;
}

export type ToolExecutionStatus = "success" | "failure" | "error";

export interface ToolExecutionTelemetry {
  tool_name: string;
  actor: string;
  started_at: DualTimeRecord;
  finished_at: DualTimeRecord;
  duration_ms: number;
  duration_formatted: string;
  status: ToolExecutionStatus;
  parameters?: Record<string, unknown> | undefined;
  error?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export type TestStatus = "pass" | "fail" | "skip";

export interface IndividualTestTiming {
  name: string;
  duration_ms: number;
  duration_formatted: string;
  status: TestStatus;
  started_at?: DualTimeRecord | undefined;
  completed_at?: DualTimeRecord | undefined;
  error?: string | undefined;
}

export interface UnitTestTelemetry {
  test_suite: string;
  actor: string;
  started_at: DualTimeRecord;
  completed_at: DualTimeRecord;
  test_duration_ms: number;
  test_duration_formatted: string;
  individual_tests: IndividualTestTiming[];
  passed: boolean;
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  details?: Record<string, unknown> | undefined;
}

export interface SchedulerWatchdogTelemetry {
  tick_utc: string;
  tick_local: string;
  tick_dual: DualTimeRecord;
  interval_ms: number;
  drift_ms: number;
  elapsed_ms: number;
  actor: string;
  component: "scheduler" | "watchdog" | string;
  iteration?: number | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface StepMachineTelemetry {
  step_id: string;
  step_name: string;
  state: string;
  actor: string;
  created_dual: DualTimeRecord;
  started_at?: DualTimeRecord | undefined;
  completed_at?: DualTimeRecord | undefined;
  updated_dual: DualTimeRecord;
  duration_ms?: number | undefined;
  duration_formatted?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

function resolveDate(dateOrMs?: Date | number | string | DualTimeRecord): Date {
  if (dateOrMs === undefined) {
    return new Date();
  }
  if (typeof dateOrMs === "number") {
    if (!Number.isFinite(dateOrMs)) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid timestamp number: ${dateOrMs}`);
    }
    const date = new Date(dateOrMs);
    if (isNaN(date.getTime())) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid timestamp number: ${dateOrMs}`);
    }
    return date;
  }
  if (typeof dateOrMs === "string") {
    const date = new Date(dateOrMs);
    if (isNaN(date.getTime())) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid date string: ${dateOrMs}`);
    }
    return date;
  }
  if (dateOrMs instanceof Date) {
    if (isNaN(dateOrMs.getTime())) {
      throw new HarnessError("INVALID_ARGUMENT", "Invalid Date object");
    }
    return dateOrMs;
  }
  if (typeof dateOrMs === "object" && dateOrMs !== null) {
    if (typeof dateOrMs.timestamp_ms === "number" && Number.isFinite(dateOrMs.timestamp_ms)) {
      const date = new Date(dateOrMs.timestamp_ms);
      if (!isNaN(date.getTime())) return date;
    }
    if (typeof dateOrMs.utc === "string") {
      const date = new Date(dateOrMs.utc);
      if (!isNaN(date.getTime())) return date;
    }
  }
  throw new HarnessError("INVALID_ARGUMENT", `Cannot extract date from value: ${String(dateOrMs)}`);
}

function extractTimestampMs(value: DualTimeRecord | string | number | Date): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid timestamp number: ${value}`);
    }
    return value;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    if (isNaN(ms)) {
      throw new HarnessError("INVALID_ARGUMENT", "Invalid Date object");
    }
    return ms;
  }
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    if (isNaN(ms)) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid date string: ${value}`);
    }
    return ms;
  }
  if (typeof value === "object" && value !== null) {
    if (typeof value.timestamp_ms === "number" && Number.isFinite(value.timestamp_ms)) {
      return value.timestamp_ms;
    }
    if (typeof value.utc === "string") {
      const ms = new Date(value.utc).getTime();
      if (!isNaN(ms)) return ms;
    }
  }
  throw new HarnessError(
    "INVALID_ARGUMENT",
    `Cannot extract timestamp from value: ${String(value)}`,
  );
}

function extractDualTimeParts(
  date: Date,
  timezone: string,
): { local: string; offset_minutes: number; timezone: string } {
  let parts: Intl.DateTimeFormatPart[];
  let offsetParts: Intl.DateTimeFormatPart[];

  try {
    parts = Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hourCycle: "h23",
    }).formatToParts(date);

    offsetParts = Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    }).formatToParts(date);
  } catch (error) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid timezone: ${timezone} (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((p) => p.type === type);
    return found ? found.value : "00";
  };

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  const frac = get("fractionalSecond");
  const fractionalSecond = (frac && frac.length > 0 ? frac : "000").padEnd(3, "0");

  const offsetPart = offsetParts.find((p) => p.type === "timeZoneName");
  const offsetRaw = offsetPart ? offsetPart.value : "GMT+00:00";
  let offsetStr = "+00:00";
  let offsetMinutes = 0;

  const offsetMatch = offsetRaw.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  if (offsetMatch && offsetMatch[1] && offsetMatch[2]) {
    const sign = offsetMatch[1] === "-" ? -1 : 1;
    const hours = parseInt(offsetMatch[2], 10);
    const mins = offsetMatch[3] ? parseInt(offsetMatch[3], 10) : 0;
    offsetMinutes = sign * (hours * 60 + mins);
    const formattedHours = String(hours).padStart(2, "0");
    const formattedMins = String(mins).padStart(2, "0");
    offsetStr = `${offsetMatch[1]}${formattedHours}:${formattedMins}`;
  }

  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fractionalSecond}${offsetStr}`;

  return {
    local,
    offset_minutes: offsetMinutes,
    timezone,
  };
}

/**
 * Returns a DualTimeRecord for the given date/timestamp, containing UTC ISO string,
 * local ISO string with offset, timezone name, signed offset in minutes, and epoch ms.
 */
export function getDualTime(
  dateOrMs?: Date | number | string | DualTimeRecord,
  timezone?: string,
): DualTimeRecord {
  const date = resolveDate(dateOrMs);
  const detectedTz =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const targetTimezone = timezone ? timezone : detectedTz ? detectedTz : "UTC";

  // If input is already a valid DualTimeRecord and timezone matches or was not specified, reuse
  if (
    typeof dateOrMs === "object" &&
    dateOrMs !== null &&
    !(dateOrMs instanceof Date) &&
    isDualTimeRecord(dateOrMs) &&
    (timezone === undefined || dateOrMs.timezone === timezone)
  ) {
    return { ...dateOrMs };
  }

  const {
    local,
    offset_minutes,
    timezone: resolvedTz,
  } = extractDualTimeParts(date, targetTimezone);

  return {
    utc: date.toISOString(),
    local,
    timezone: resolvedTz,
    offset_minutes,
    timestamp_ms: date.getTime(),
  };
}

/**
 * Renders a clean natural human-readable local time display with timezone abbreviation and UTC offset.
 * Example output: "2026-08-22 02:30:00 PDT (UTC-07:00)" or "2026-08-22 09:30:00 UTC (UTC+00:00)"
 */
export function formatDualTimeDisplay(record: DualTimeRecord): string {
  const date = new Date(record.timestamp_ms);
  let parts: Intl.DateTimeFormatPart[];

  try {
    parts = Intl.DateTimeFormat("en-US", {
      timeZone: record.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    }).formatToParts(date);
  } catch {
    parts = [];
  }

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  const year = get("year") || record.local.slice(0, 4);
  const month = get("month") || record.local.slice(5, 7);
  const day = get("day") || record.local.slice(8, 10);
  const hour = get("hour") || record.local.slice(11, 13);
  const minute = get("minute") || record.local.slice(14, 16);
  const second = get("second") || record.local.slice(17, 19);
  const tzShort = get("timeZoneName") || record.timezone;

  const sign = record.offset_minutes >= 0 ? "+" : "-";
  const absM = Math.abs(record.offset_minutes);
  const h = String(Math.floor(absM / 60)).padStart(2, "0");
  const m = String(absM % 60).padStart(2, "0");
  const offsetStr = `${sign}${h}:${m}`;

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${tzShort} (UTC${offsetStr})`;
}

/**
 * Formats a duration in milliseconds to a clean human-readable representation.
 */
export function formatDuration(duration_ms: number): string {
  const prefix = duration_ms < 0 ? "-" : "";
  const abs = Math.abs(duration_ms);

  if (abs < 1000) {
    return `${prefix}${abs}ms`;
  }
  if (abs < 60_000) {
    return `${prefix}${(abs / 1000).toFixed(2)}s`;
  }
  if (abs < 3_600_000) {
    const mins = Math.floor(abs / 60_000);
    const secs = Math.floor((abs % 60_000) / 1000);
    return `${prefix}${mins}m ${secs}s`;
  }
  if (abs < 86_400_000) {
    const hours = Math.floor(abs / 3_600_000);
    const mins = Math.floor((abs % 3_600_000) / 60_000);
    const secs = Math.floor((abs % 60_000) / 1000);
    return `${prefix}${hours}h ${mins}m ${secs}s`;
  }
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const mins = Math.floor((abs % 3_600_000) / 60_000);
  return `${prefix}${days}d ${hours}h ${mins}m`;
}

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

// ---------------------------------------------------------
// Type Guards
// ---------------------------------------------------------

export function isDualTimeRecord(value: unknown): value is DualTimeRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.utc === "string" &&
    typeof rec.local === "string" &&
    typeof rec.timezone === "string" &&
    typeof rec.offset_minutes === "number" &&
    Number.isSafeInteger(rec.offset_minutes) &&
    typeof rec.timestamp_ms === "number" &&
    Number.isFinite(rec.timestamp_ms)
  );
}

export function isActionTelemetry(value: unknown): value is ActionTelemetry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.action_id === "string" &&
    typeof rec.action_type === "string" &&
    typeof rec.actor === "string" &&
    typeof rec.display_time === "string" &&
    isDualTimeRecord(rec.timestamp) &&
    typeof rec.details === "object" &&
    rec.details !== null &&
    !Array.isArray(rec.details)
  );
}

export function isSubagentLifecycleTelemetry(value: unknown): value is SubagentLifecycleTelemetry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.subagent_id !== "string" || typeof rec.actor !== "string") return false;
  if (typeof rec.status !== "string") return false;
  if (rec.role !== undefined && typeof rec.role !== "string") return false;
  if (rec.spawned_at !== undefined && !isDualTimeRecord(rec.spawned_at)) return false;
  if (rec.claimed_at !== undefined && !isDualTimeRecord(rec.claimed_at)) return false;
  if (rec.heartbeat_at !== undefined && !isDualTimeRecord(rec.heartbeat_at)) return false;
  if (rec.submitted_at !== undefined && !isDualTimeRecord(rec.submitted_at)) return false;
  if (rec.reviewed_at !== undefined && !isDualTimeRecord(rec.reviewed_at)) return false;
  if (rec.duration_ms !== undefined && typeof rec.duration_ms !== "number") return false;
  if (rec.duration_formatted !== undefined && typeof rec.duration_formatted !== "string")
    return false;
  if (
    rec.metadata !== undefined &&
    (typeof rec.metadata !== "object" || rec.metadata === null || Array.isArray(rec.metadata))
  )
    return false;
  return true;
}

export function isToolExecutionTelemetry(value: unknown): value is ToolExecutionTelemetry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.tool_name !== "string" || typeof rec.actor !== "string") return false;
  if (!isDualTimeRecord(rec.started_at) || !isDualTimeRecord(rec.finished_at)) return false;
  if (typeof rec.duration_ms !== "number" || typeof rec.duration_formatted !== "string")
    return false;
  if (typeof rec.status !== "string" || !["success", "failure", "error"].includes(rec.status))
    return false;
  if (rec.error !== undefined && typeof rec.error !== "string") return false;
  if (
    rec.parameters !== undefined &&
    (typeof rec.parameters !== "object" || rec.parameters === null || Array.isArray(rec.parameters))
  )
    return false;
  if (
    rec.details !== undefined &&
    (typeof rec.details !== "object" || rec.details === null || Array.isArray(rec.details))
  )
    return false;
  return true;
}

export function isUnitTestTelemetry(value: unknown): value is UnitTestTelemetry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.test_suite !== "string" || typeof rec.actor !== "string") return false;
  if (!isDualTimeRecord(rec.started_at) || !isDualTimeRecord(rec.completed_at)) return false;
  if (typeof rec.test_duration_ms !== "number" || typeof rec.test_duration_formatted !== "string")
    return false;
  if (typeof rec.passed !== "boolean") return false;
  if (
    typeof rec.passed_count !== "number" ||
    typeof rec.failed_count !== "number" ||
    typeof rec.skipped_count !== "number"
  )
    return false;
  if (!Array.isArray(rec.individual_tests)) return false;
  return true;
}

export function isSchedulerWatchdogTelemetry(value: unknown): value is SchedulerWatchdogTelemetry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.tick_utc !== "string" || typeof rec.tick_local !== "string") return false;
  if (!isDualTimeRecord(rec.tick_dual)) return false;
  if (
    typeof rec.interval_ms !== "number" ||
    typeof rec.drift_ms !== "number" ||
    typeof rec.elapsed_ms !== "number"
  )
    return false;
  if (typeof rec.actor !== "string" || typeof rec.component !== "string") return false;
  if (rec.iteration !== undefined && typeof rec.iteration !== "number") return false;
  return true;
}

export function isStepMachineTelemetry(value: unknown): value is StepMachineTelemetry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (
    typeof rec.step_id !== "string" ||
    typeof rec.step_name !== "string" ||
    typeof rec.state !== "string" ||
    typeof rec.actor !== "string"
  )
    return false;
  if (!isDualTimeRecord(rec.created_dual) || !isDualTimeRecord(rec.updated_dual)) return false;
  if (rec.started_at !== undefined && !isDualTimeRecord(rec.started_at)) return false;
  if (rec.completed_at !== undefined && !isDualTimeRecord(rec.completed_at)) return false;
  if (rec.duration_ms !== undefined && typeof rec.duration_ms !== "number") return false;
  if (rec.duration_formatted !== undefined && typeof rec.duration_formatted !== "string")
    return false;
  return true;
}
