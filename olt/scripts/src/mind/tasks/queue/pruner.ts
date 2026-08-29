import {
  resolveTaskQueuePath,
  recordCompletedTasksBatch,
  TASK_QUEUE_STATUSES,
  TASK_PRIORITIES,
  type CompletedTaskRecord,
  type TaskQueueItem,
  type TaskQueueStatus,
  type TaskPriority,
  type TaskLease,
  type TaskSourceType,
} from "./types.ts";
import { withTaskQueueTransaction, readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";
import { popNextEligibleTaskUnlocked } from "./enqueue.ts";
import { HarnessError } from "../../../core/errors/index.ts";

export function pruneCompletedTasks(
  customPath?: string,
  options?: {
    readonly completedTasksPath?: string | undefined;
    readonly autoArchive?: boolean | undefined;
  },
): {
  readonly prunedCount: number;
  readonly remainingCount: number;
  readonly archivedCount?: number | undefined;
} {
  const filePath = resolveTaskQueuePath(customPath);
  return withTaskQueueTransaction(filePath, () => pruneCompletedTasksUnlocked(options, filePath));
}

export function pruneCompletedTasksUnlocked(
  options:
    | {
        readonly completedTasksPath?: string | undefined;
        readonly autoArchive?: boolean | undefined;
      }
    | undefined,
  filePath: string,
): {
  readonly prunedCount: number;
  readonly remainingCount: number;
  readonly archivedCount?: number | undefined;
} {
  const all = readTaskQueueFile(filePath);
  const completed = all.filter((t) => t.status === "COMPLETED");
  const remaining = all.filter((t) => t.status !== "COMPLETED");
  const prunedCount = completed.length;

  let archivedCount = 0;
  if (completed.length > 0 && options?.autoArchive !== false) {
    const records: CompletedTaskRecord[] = completed.map((t) => ({
      id: t.id,
      source: "task_queue",
      title: t.title,
      status: "COMPLETED",
      proof_summary: t.description || `Completed task ${t.id}`,
      completed_at: t.completed_at ?? new Date().toISOString(),
      category: t.metadata?.["category"] as string | undefined,
      test_path: t.metadata?.["test_path"] as string | undefined,
      metadata: t.metadata,
    }));
    try {
      const archived = recordCompletedTasksBatch(records, {
        customPath: options?.completedTasksPath,
      });
      archivedCount = archived.length;
    } catch {
      // Non-fatal if ledger path is not configured
    }
  }

  if (prunedCount > 0) {
    writeTaskQueueUnlocked(remaining, filePath);
  }

  return {
    prunedCount,
    remainingCount: remaining.length,
    archivedCount,
  };
}

/**
 * Pops the next eligible task from the queue and cleans up completed tasks atomically.
 */
export function popNextEligibleTaskWithCleanup(params: {
  readonly agentId: string;
  readonly durationSeconds?: number | undefined;
  readonly customPath?: string | undefined;
  readonly completedTasksPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): {
  readonly task: TaskQueueItem;
  readonly leaseToken: string;
  readonly prunedCount: number;
} | null {
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => {
    const pruneRes = pruneCompletedTasksUnlocked(
      { completedTasksPath: params.completedTasksPath, autoArchive: true },
      filePath,
    );
    const popped = popNextEligibleTaskUnlocked(
      { agentId: params.agentId, durationSeconds: params.durationSeconds, nowIso: params.nowIso },
      filePath,
    );
    return popped ? { ...popped, prunedCount: pruneRes.prunedCount } : null;
  });
}

function deserializeTaskQueueItem(raw: Record<string, unknown>): TaskQueueItem {
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
  const priority = requiredString("priority") as TaskPriority;
  if (!TASK_QUEUE_STATUSES.includes(status) || !TASK_PRIORITIES.includes(priority)) {
    throw new HarnessError("INTEGRITY", `task queue record has invalid status or priority`);
  }
  const sourceType = validateSourceType(raw["source_type"]);
  if (raw["source_type"] !== sourceType) {
    throw new HarnessError("INTEGRITY", "task queue record has invalid source_type");
  }
  const retryCount = raw["retry_count"];
  const maxRetries = raw["max_retries"];
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
  let lease: TaskLease | null = null;
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
    const attempt = rawLease.attempt;
    const duration = rawLease.lease_duration_seconds;
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
    )
      throw new HarnessError("INTEGRITY", "task queue record has invalid lease");
    lease = {
      agent_id: agentId,
      token,
      leased_at: leasedAt,
      expires_at: expiresAt,
      attempt,
      lease_duration_seconds: duration,
    };
  }
  const createdAt = requiredString("created_at");
  const updatedAt = requiredString("updated_at");
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
    throw new HarnessError("INTEGRITY", "task queue record has invalid timestamps");
  }
  return {
    id,
    title: requiredString("title"),
    description: requiredString("description"),
    priority,
    status,
    write_scope: stringArray("write_scope", true),
    gate: requiredString("gate"),
    charter_goals: stringArray("charter_goals", true),
    acceptance_criteria: stringArray("acceptance_criteria"),
    dependencies: stringArray("dependencies"),
    blocked_by: stringArray("blocked_by"),
    lease,
    source_type: sourceType,
    created_at: createdAt,
    updated_at: updatedAt,
    started_at: typeof raw["started_at"] === "string" ? raw["started_at"] : null,
    completed_at: typeof raw["completed_at"] === "string" ? raw["completed_at"] : null,
    failed_at: typeof raw["failed_at"] === "string" ? raw["failed_at"] : null,
    escalated_at: typeof raw["escalated_at"] === "string" ? raw["escalated_at"] : null,
    retry_count: retryCount,
    max_retries: maxRetries,
    error_message: typeof raw["error_message"] === "string" ? raw["error_message"] : null,
    assigned_tier: typeof raw["assigned_tier"] === "string" ? raw["assigned_tier"] : null,
    assigned_role: typeof raw["assigned_role"] === "string" ? raw["assigned_role"] : null,
    metadata:
      typeof raw["metadata"] === "object" &&
      raw["metadata"] !== null &&
      !Array.isArray(raw["metadata"])
        ? (raw["metadata"] as Record<string, unknown>)
        : undefined,
  };
}

function validateSourceType(val: unknown): TaskSourceType {
  if (typeof val === "string") {
    if (
      val === "external_intake" ||
      val === "feedback_intake" ||
      val === "self_evolution" ||
      val === "defect_remediation" ||
      val === "direct_prompt" ||
      val === "plan_enhancement"
    ) {
      return val;
    }
  }
  throw new HarnessError("INTEGRITY", "task queue record has invalid source_type");
}
