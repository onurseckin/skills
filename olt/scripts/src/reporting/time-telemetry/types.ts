import type { DualTimeRecord } from "../../core/dual-time/index.ts";
import { isDualTimeRecord } from "../../core/dual-time/index.ts";
import type { JsonValue } from "../../core/contracts/index.ts";

export type HarnessActionCategory =
  | "plan"
  | "queue"
  | "task"
  | "run"
  | "doctor"
  | "mind"
  | "watchdog"
  | "subagent"
  | "gate"
  | "workflow"
  | "custom";

export type ActionExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "failure"
  | "error"
  | "timed_out";

export const HARNESS_ACTION_CATEGORIES: readonly HarnessActionCategory[] = [
  "plan",
  "queue",
  "task",
  "run",
  "doctor",
  "mind",
  "watchdog",
  "subagent",
  "gate",
  "workflow",
  "custom",
] as const;

export const ACTION_EXECUTION_STATUSES: readonly ActionExecutionStatus[] = [
  "pending",
  "running",
  "success",
  "failure",
  "error",
  "timed_out",
] as const;

export interface SubStepTiming {
  readonly name: string;
  readonly startedAt: DualTimeRecord;
  readonly finishedAt?: DualTimeRecord | undefined;
  readonly durationMs?: number | undefined;
  readonly durationFormatted?: string | undefined;
  readonly status: ActionExecutionStatus;
  readonly details?: Readonly<Record<string, JsonValue>> | undefined;
}

export interface HarnessActionTimeRecord {
  readonly actionId: string;
  readonly actionName: string;
  readonly category: HarnessActionCategory;
  readonly actor: string;
  readonly tier: number;
  readonly status: ActionExecutionStatus;
  readonly startedAt: DualTimeRecord;
  readonly finishedAt?: DualTimeRecord | undefined;
  readonly durationMs?: number | undefined;
  readonly durationFormatted?: string | undefined;
  readonly driftMs?: number | undefined;
  readonly subSteps?: readonly SubStepTiming[] | undefined;
  readonly metadata?: Readonly<Record<string, JsonValue>> | undefined;
  readonly error?: string | undefined;
}

export interface StartActionSpanOptions {
  readonly category?: HarnessActionCategory | undefined;
  readonly tier?: number | undefined;
  readonly startedAt?: Date | number | string | DualTimeRecord | undefined;
  readonly timezone?: string | undefined;
  readonly metadata?: Readonly<Record<string, JsonValue>> | undefined;
  readonly expectedStartMs?: number | undefined;
}

export interface LatencyPercentiles {
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

export interface CategoryTelemetrySummary {
  readonly category: HarnessActionCategory;
  readonly count: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly errorRate: number;
  readonly totalDurationMs: number;
  readonly meanDurationMs: number;
  readonly maxDurationMs: number;
  readonly percentiles: LatencyPercentiles;
}

export interface ActorTelemetrySummary {
  readonly actor: string;
  readonly tier: number;
  readonly count: number;
  readonly totalDurationMs: number;
  readonly meanDurationMs: number;
  readonly errorCount: number;
}

export interface TimeAnomaly {
  readonly type:
    | "excessive_duration"
    | "negative_duration"
    | "clock_drift"
    | "orphaned_span"
    | "unclosed_substep";
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly actionId: string;
  readonly actionName: string;
  readonly actor: string;
  readonly message: string;
  readonly thresholdMs?: number | undefined;
  readonly actualMs?: number | undefined;
}

export interface TimeTelemetryHealthResult {
  readonly healthy: boolean;
  readonly totalChecked: number;
  readonly anomalyCount: number;
  readonly anomalies: readonly TimeAnomaly[];
  readonly recommendation: string;
}

export interface TimeTelemetryReport {
  readonly generatedAt: DualTimeRecord;
  readonly runId?: string | undefined;
  readonly totalActions: number;
  readonly activeActions: number;
  readonly completedActions: number;
  readonly totalDurationMs: number;
  readonly overallPercentiles: LatencyPercentiles;
  readonly categoryBreakdown: readonly CategoryTelemetrySummary[];
  readonly actorBreakdown: readonly ActorTelemetrySummary[];
  readonly recentActions: readonly HarnessActionTimeRecord[];
  readonly anomalies: readonly TimeAnomaly[];
  readonly timezone: string;
}

export interface TelemetryFilter {
  readonly category?: HarnessActionCategory | readonly HarnessActionCategory[] | undefined;
  readonly actor?: string | readonly string[] | undefined;
  readonly tier?: number | readonly number[] | undefined;
  readonly status?: ActionExecutionStatus | readonly ActionExecutionStatus[] | undefined;
  readonly actionName?: string | readonly string[] | undefined;
  readonly fromMs?: number | undefined;
  readonly toMs?: number | undefined;
}

export function isHarnessActionCategory(value: unknown): value is HarnessActionCategory {
  return (
    typeof value === "string" && HARNESS_ACTION_CATEGORIES.includes(value as HarnessActionCategory)
  );
}

export function isActionExecutionStatus(value: unknown): value is ActionExecutionStatus {
  return (
    typeof value === "string" && ACTION_EXECUTION_STATUSES.includes(value as ActionExecutionStatus)
  );
}

export function isHarnessActionTimeRecord(value: unknown): value is HarnessActionTimeRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;

  if (typeof rec.actionId !== "string" || typeof rec.actionName !== "string") return false;
  if (!isHarnessActionCategory(rec.category)) return false;
  if (typeof rec.actor !== "string" || typeof rec.tier !== "number") return false;
  if (!isActionExecutionStatus(rec.status)) return false;
  if (!isDualTimeRecord(rec.startedAt)) return false;

  if (rec.finishedAt !== undefined && !isDualTimeRecord(rec.finishedAt)) return false;
  if (rec.durationMs !== undefined && typeof rec.durationMs !== "number") return false;
  if (rec.durationFormatted !== undefined && typeof rec.durationFormatted !== "string")
    return false;
  if (rec.driftMs !== undefined && typeof rec.driftMs !== "number") return false;
  if (rec.error !== undefined && typeof rec.error !== "string") return false;

  if (rec.subSteps !== undefined) {
    if (!Array.isArray(rec.subSteps)) return false;
    for (const sub of rec.subSteps) {
      if (typeof sub !== "object" || sub === null) return false;
      const s = sub as Record<string, unknown>;
      if (typeof s.name !== "string" || !isDualTimeRecord(s.startedAt)) return false;
      if (!isActionExecutionStatus(s.status)) return false;
    }
  }

  return true;
}

export function isTimeTelemetryReport(value: unknown): value is TimeTelemetryReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;

  return (
    isDualTimeRecord(rec.generatedAt) &&
    typeof rec.totalActions === "number" &&
    typeof rec.activeActions === "number" &&
    typeof rec.completedActions === "number" &&
    typeof rec.totalDurationMs === "number" &&
    typeof rec.timezone === "string" &&
    Array.isArray(rec.categoryBreakdown) &&
    Array.isArray(rec.actorBreakdown) &&
    Array.isArray(rec.recentActions) &&
    Array.isArray(rec.anomalies)
  );
}

export function isTimeTelemetryHealthResult(value: unknown): value is TimeTelemetryHealthResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;

  return (
    typeof rec.healthy === "boolean" &&
    typeof rec.totalChecked === "number" &&
    typeof rec.anomalyCount === "number" &&
    Array.isArray(rec.anomalies) &&
    typeof rec.recommendation === "string"
  );
}
