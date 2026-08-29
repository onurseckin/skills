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
