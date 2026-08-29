export const DEFAULT_LEASE_DURATION_MS = 300_000;
import { resolve } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../../platform/index.ts";
import {
  recordCompletedTask,
  recordCompletedTasksBatch,
  type CompletedTaskRecord,
} from "../../archival/completed/index.ts";

export {
  releaseFlock,
  tryExclusiveFlock,
  recordCompletedTask,
  recordCompletedTasksBatch,
  type CompletedTaskRecord,
};

export interface TaskQueueStats {
  readonly total: number;
  readonly pending: number;
  readonly admitted: number;
  readonly in_progress: number;
  readonly running: number;
  readonly validating: number;
  readonly completed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly escalated: number;
  readonly active_leases: number;
  readonly expired_leases: number;
}

export type TaskQueueStatus =
  | "PENDING"
  | "ADMITTED"
  | "IN_PROGRESS"
  | "RUNNING"
  | "VALIDATING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "ESCALATED";

export const TASK_QUEUE_STATUSES: readonly TaskQueueStatus[] = [
  "PENDING",
  "ADMITTED",
  "IN_PROGRESS",
  "RUNNING",
  "VALIDATING",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "ESCALATED",
];

export type TaskPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND";

export const TASK_PRIORITIES: readonly TaskPriority[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "BACKGROUND",
];

export const PRIORITY_WEIGHTS: Readonly<Record<TaskPriority, number>> = {
  CRITICAL: 100,
  HIGH: 75,
  MEDIUM: 50,
  LOW: 25,
  BACKGROUND: 10,
};

export type TaskSourceType =
  | "external_intake"
  | "feedback_intake"
  | "self_evolution"
  | "defect_remediation"
  | "direct_prompt"
  | "plan_enhancement";

export interface TaskLease {
  readonly agent_id: string;
  readonly leased_at: string;
  readonly expires_at: string;
  readonly attempt: number;
  readonly lease_duration_seconds: number;
  readonly token: string;
}

export interface TaskQueueItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly status: TaskQueueStatus;
  readonly write_scope: readonly string[];
  readonly gate: string;
  readonly charter_goals: readonly string[];
  readonly acceptance_criteria: readonly string[];
  readonly dependencies: readonly string[];
  readonly blocked_by: readonly string[];
  readonly lease?: TaskLease | null | undefined;
  readonly source_type: TaskSourceType;
  readonly created_at: string;
  readonly updated_at: string;
  readonly started_at?: string | null | undefined;
  readonly completed_at?: string | null | undefined;
  readonly failed_at?: string | null | undefined;
  readonly escalated_at?: string | null | undefined;
  readonly retry_count: number;
  readonly max_retries: number;
  readonly error_message?: string | null | undefined;
  readonly assigned_tier?: string | null | undefined;
  readonly assigned_role?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface NewTaskQueueInput {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly status?: TaskQueueStatus | undefined;
  readonly write_scope: readonly string[];
  readonly gate: string;
  readonly charter_goals?: readonly string[] | undefined;
  readonly acceptance_criteria?: readonly string[] | undefined;
  readonly dependencies?: readonly string[] | undefined;
  readonly source_type?: TaskSourceType | undefined;
  readonly max_retries?: number | undefined;
  readonly assigned_tier?: string | undefined;
  readonly assigned_role?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export const DEFAULT_TASK_QUEUE_FILE = ".olt/tasks.jsonl";

export function resolveTaskQueuePath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  return resolve(process.cwd(), DEFAULT_TASK_QUEUE_FILE);
}

export function resolveCanonicalTaskQueuePath(customPath?: string): string {
  return resolveTaskQueuePath(customPath);
}

export const DEFAULT_LEASE_DURATION_SECONDS = 1800;
export const DEFAULT_MAX_RETRIES = 3;

export type TaskQueuePersistenceStage =
  | "before_write"
  | "before_fsync"
  | "before_rename"
  | "after_rename"
  | "before_directory_fsync";

let taskQueuePersistenceTestHook: ((stage: TaskQueuePersistenceStage) => void) | undefined;
export const taskQueueLockSleep = new Int32Array(
  new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
);

export function __setTaskQueuePersistenceTestHook(
  hook: ((stage: TaskQueuePersistenceStage) => void) | undefined,
): void {
  taskQueuePersistenceTestHook = hook;
}

export function invokeTaskQueuePersistenceHook(stage: TaskQueuePersistenceStage): void {
  taskQueuePersistenceTestHook?.(stage);
}

export function validateSourceType(val: unknown): TaskSourceType {
  const validSources: TaskSourceType[] = [
    "external_intake",
    "feedback_intake",
    "self_evolution",
    "defect_remediation",
    "direct_prompt",
    "plan_enhancement",
  ];
  if (typeof val === "string" && (validSources as string[]).includes(val)) {
    return val as TaskSourceType;
  }
  return "self_evolution";
}

export function deserializeTaskQueueItem(raw: Record<string, unknown>): TaskQueueItem {
  const requiredString = (key: string): string => {
    const value = raw[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new HarnessError("INTEGRITY", `task queue record has invalid ${key}`);
    }
    return value;
  };
  const stringArray = (key: string, nonEmpty = false): string[] => {
    const value = raw[key];
    if (
      !Array.isArray(value) ||
      (nonEmpty && value.length === 0) ||
      !value.every((entry) => typeof entry === "string" && entry.trim())
    ) {
      throw new HarnessError("INTEGRITY", `task queue record has invalid ${key}`);
    }
    return [...value];
  };
  const id = requiredString("id");
  const status = requiredString("status") as TaskQueueStatus;
  const priority = (raw["priority"] ?? "MEDIUM") as TaskPriority;
  if (!TASK_QUEUE_STATUSES.includes(status) || !TASK_PRIORITIES.includes(priority)) {
    throw new HarnessError("INTEGRITY", `task queue record has invalid status or priority`);
  }
  const sourceType = validateSourceType(raw["source_type"] ?? "self_evolution");
  if (raw["source_type"] !== undefined && raw["source_type"] !== sourceType) {
    throw new HarnessError("INTEGRITY", "task queue record has invalid source_type");
  }
  const retryCount = raw["retry_count"] ?? 0;
  const maxRetries = raw["max_retries"] ?? 3;
  if (
    typeof retryCount !== "number" ||
    !Number.isSafeInteger(retryCount) ||
    retryCount < 0 ||
    typeof maxRetries !== "number" ||
    !Number.isSafeInteger(maxRetries) ||
    maxRetries < 0
  ) {
    throw new HarnessError("INTEGRITY", "task queue record has invalid retry counters");
  }
  let lease: TaskLease | undefined = undefined;
  if (raw["lease"] !== null && raw["lease"] !== undefined) {
    const value = raw["lease"];
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new HarnessError("INTEGRITY", "task queue record has invalid lease");
    }
    const rawLease = value as Record<string, unknown>;
    const agentId = rawLease.agent_id;
    const token = rawLease.token;
    const leasedAt = rawLease.leased_at;
    const expiresAt = rawLease.expires_at;
    const attempt = rawLease.attempt ?? 1;
    const duration = rawLease.lease_duration_seconds ?? 1800;
    if (
      typeof agentId !== "string" ||
      !agentId.trim() ||
      typeof token !== "string" ||
      !token.trim() ||
      typeof leasedAt !== "string" ||
      !Number.isFinite(Date.parse(leasedAt)) ||
      typeof expiresAt !== "string" ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      typeof attempt !== "number" ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1 ||
      typeof duration !== "number" ||
      !Number.isSafeInteger(duration) ||
      duration < 1
    ) {
      throw new HarnessError("INTEGRITY", "task queue record has invalid lease");
    }
    lease = {
      agent_id: agentId,
      token,
      leased_at: leasedAt,
      expires_at: expiresAt,
      attempt,
      lease_duration_seconds: duration,
    };
  }
  const createdAt =
    typeof raw["created_at"] === "string" ? raw["created_at"] : new Date().toISOString();
  const updatedAt =
    typeof raw["updated_at"] === "string" ? raw["updated_at"] : new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
    throw new HarnessError("INTEGRITY", "task queue record has invalid timestamps");
  }
  return {
    id,
    title: typeof raw["title"] === "string" ? raw["title"] : "",
    description: typeof raw["description"] === "string" ? raw["description"] : "",
    priority,
    status,
    write_scope: stringArray("write_scope", false),
    gate: typeof raw["gate"] === "string" ? raw["gate"] : "",
    charter_goals: Array.isArray(raw["charter_goals"]) ? (raw["charter_goals"] as string[]) : [],
    acceptance_criteria: Array.isArray(raw["acceptance_criteria"])
      ? (raw["acceptance_criteria"] as string[])
      : [],
    dependencies: Array.isArray(raw["dependencies"]) ? (raw["dependencies"] as string[]) : [],
    blocked_by: Array.isArray(raw["blocked_by"]) ? (raw["blocked_by"] as string[]) : [],
    lease,
    source_type: sourceType,
    created_at: createdAt,
    updated_at: updatedAt,
    started_at: typeof raw["started_at"] === "string" ? raw["started_at"] : undefined,
    completed_at: typeof raw["completed_at"] === "string" ? raw["completed_at"] : undefined,
    failed_at: typeof raw["failed_at"] === "string" ? raw["failed_at"] : undefined,
    escalated_at: typeof raw["escalated_at"] === "string" ? raw["escalated_at"] : undefined,
    retry_count: retryCount,
    max_retries: maxRetries,
    error_message: typeof raw["error_message"] === "string" ? raw["error_message"] : undefined,
    assigned_tier: typeof raw["assigned_tier"] === "string" ? raw["assigned_tier"] : undefined,
    assigned_role: typeof raw["assigned_role"] === "string" ? raw["assigned_role"] : undefined,
    metadata:
      typeof raw["metadata"] === "object" &&
      raw["metadata"] !== null &&
      !Array.isArray(raw["metadata"])
        ? (raw["metadata"] as Record<string, unknown>)
        : undefined,
  };
}
