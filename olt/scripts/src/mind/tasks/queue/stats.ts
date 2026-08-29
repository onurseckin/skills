import { escalateTaskUnlocked } from "./transitions.ts";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_LEASE_DURATION_SECONDS,
  PRIORITY_WEIGHTS,
} from "./types.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import type { TaskQueueItem } from "./types.ts";
import { resolveTaskQueuePath } from "./types.ts";
import {
  withTaskQueueTransaction,
  readTaskQueueFile,
  writeTaskQueue,
  writeTaskQueueUnlocked,
} from "./storage.ts";
export function failTask(params: {
  readonly taskId: string;
  readonly errorMessage: string;
  readonly agentId?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly canRetry?: boolean | undefined;
  readonly escalateOnMaxRetries?: boolean | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): {
  readonly task: TaskQueueItem;
  readonly retried: boolean;
  readonly affectedDependents: readonly string[];
  readonly escalated?: boolean | undefined;
} {
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => failTaskUnlocked(params, filePath));
}

export function failTaskUnlocked(
  params: {
    readonly taskId: string;
    readonly errorMessage: string;
    readonly agentId?: string | undefined;
    readonly leaseToken?: string | undefined;
    readonly canRetry?: boolean | undefined;
    readonly escalateOnMaxRetries?: boolean | undefined;
    readonly nowIso?: string | undefined;
  },
  filePath: string,
): {
  readonly task: TaskQueueItem;
  readonly retried: boolean;
  readonly affectedDependents: readonly string[];
  readonly escalated?: boolean | undefined;
} {
  const queue = readTaskQueueFile(filePath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  }

  const task = queue[index]!;
  if (params.leaseToken && task.lease && task.lease.token !== params.leaseToken) {
    throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
  }

  const nowIso = params.nowIso ?? new Date().toISOString();
  const canRetry = params.canRetry !== false && task.retry_count < task.max_retries;

  if (canRetry) {
    const retriedTask: TaskQueueItem = {
      ...task,
      status: task.blocked_by.length > 0 ? "BLOCKED" : "PENDING",
      retry_count: task.retry_count + 1,
      lease: null,
      error_message: params.errorMessage,
      updated_at: nowIso,
    };
    queue[index] = retriedTask;
    writeTaskQueueUnlocked(queue, filePath);
    return {
      task: retriedTask,
      retried: true,
      affectedDependents: [],
      escalated: false,
    };
  }

  if (params.escalateOnMaxRetries) {
    const escResult = escalateTaskUnlocked(
      {
        taskId: params.taskId,
        reason: `Max retries (${task.max_retries}) exceeded: ${params.errorMessage}`,
        agentId: params.agentId,
        leaseToken: params.leaseToken,
        nowIso: params.nowIso,
      },
      filePath,
    );
    return {
      task: escResult.task,
      retried: false,
      affectedDependents: escResult.affectedDependents,
      escalated: true,
    };
  }

  // Permanently FAILED
  const failedTask: TaskQueueItem = {
    ...task,
    status: "FAILED",
    lease: null,
    failed_at: nowIso,
    error_message: params.errorMessage,
    updated_at: nowIso,
  };
  queue[index] = failedTask;

  // Mark all dependent tasks as BLOCKED
  const affectedDependents: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if (
      item.id === failedTask.id ||
      item.status === "COMPLETED" ||
      item.status === "FAILED" ||
      item.status === "ESCALATED"
    )
      continue;

    if (item.dependencies.includes(failedTask.id)) {
      if (!item.blocked_by.includes(failedTask.id)) {
        queue[i] = {
          ...item,
          status: "BLOCKED",
          blocked_by: [...item.blocked_by, failedTask.id],
          updated_at: nowIso,
        };
      } else if (item.status !== "BLOCKED") {
        queue[i] = {
          ...item,
          status: "BLOCKED",
          updated_at: nowIso,
        };
      }
      affectedDependents.push(item.id);
    }
  }

  writeTaskQueueUnlocked(queue, filePath);

  return {
    task: failedTask,
    retried: false,
    affectedDependents,
    escalated: false,
  };
}

/**
 * Scans and reclaims expired leases across the task queue.
 */
export function reclaimExpiredLeases(
  params: {
    readonly customPath?: string | undefined;
    readonly nowMs?: number | undefined;
  } = {},
): {
  readonly reclaimedCount: number;
  readonly tasks: readonly TaskQueueItem[];
} {
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => reclaimExpiredLeasesUnlocked(params, filePath));
}

export function reclaimExpiredLeasesUnlocked(
  params: { readonly nowMs?: number | undefined },
  filePath: string,
): { readonly reclaimedCount: number; readonly tasks: readonly TaskQueueItem[] } {
  const queue = readTaskQueueFile(filePath);
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const reclaimedTasks: TaskQueueItem[] = [];
  let modified = false;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if (
      (item.status === "IN_PROGRESS" ||
        item.status === "RUNNING" ||
        item.status === "VALIDATING") &&
      item.lease
    ) {
      const expiresMs = Date.parse(item.lease.expires_at);
      if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
        // Lease has expired
        const canRetry = item.retry_count < item.max_retries;
        if (canRetry) {
          const reclaimed: TaskQueueItem = {
            ...item,
            status: item.blocked_by.length > 0 ? "BLOCKED" : "PENDING",
            lease: null,
            retry_count: item.retry_count + 1,
            error_message: `Lease expired for agent '${item.lease.agent_id}' at ${item.lease.expires_at}`,
            updated_at: nowIso,
          };
          queue[i] = reclaimed;
          reclaimedTasks.push(reclaimed);
          modified = true;
        } else {
          const failed: TaskQueueItem = {
            ...item,
            status: "FAILED",
            lease: null,
            failed_at: nowIso,
            error_message: `Lease expired and max retries (${item.max_retries}) exceeded`,
            updated_at: nowIso,
          };
          queue[i] = failed;
          reclaimedTasks.push(failed);
          modified = true;
        }
      }
    }
  }

  if (modified) {
    writeTaskQueueUnlocked(queue, filePath);
  }

  return {
    reclaimedCount: reclaimedTasks.length,
    tasks: reclaimedTasks,
  };
}

/**
 * Computes queue statistics across all items.
 */
