import {
  resolveTaskQueuePath,
  recordCompletedTask,
  type CompletedTaskRecord,
  type TaskQueueItem,
} from "./types.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { withTaskQueueTransaction, readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";
export function completeTask(params: {
  readonly taskId: string;
  readonly agentId?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
  readonly proofSummary?: string | undefined;
  readonly testPath?: string | undefined;
  readonly assertions?: number | string | readonly string[] | null | undefined;
  readonly runtimeMs?: number | string | null | undefined;
  readonly commitSha?: string | null | undefined;
  readonly autoArchive?: boolean | undefined;
  readonly completedTasksPath?: string | undefined;
  readonly autoPrune?: boolean | undefined;
}): {
  readonly completedTask: TaskQueueItem;
  readonly unblockedTasks: readonly TaskQueueItem[];
  readonly archivedRecord?: CompletedTaskRecord | undefined;
} {
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => completeTaskUnlocked(params, filePath));
}

export function completeTaskUnlocked(
  params: {
    readonly taskId: string;
    readonly agentId?: string | undefined;
    readonly leaseToken?: string | undefined;
    readonly nowIso?: string | undefined;
    readonly proofSummary?: string | undefined;
    readonly testPath?: string | undefined;
    readonly assertions?: number | string | readonly string[] | null | undefined;
    readonly runtimeMs?: number | string | null | undefined;
    readonly commitSha?: string | null | undefined;
    readonly autoArchive?: boolean | undefined;
    readonly completedTasksPath?: string | undefined;
    readonly autoPrune?: boolean | undefined;
  },
  filePath: string,
): {
  readonly completedTask: TaskQueueItem;
  readonly unblockedTasks: readonly TaskQueueItem[];
  readonly archivedRecord?: CompletedTaskRecord | undefined;
} {
  const queue = readTaskQueueFile(filePath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  }

  const task = queue[index]!;
  if (task.status === "COMPLETED") {
    return { completedTask: task, unblockedTasks: [] };
  }

  if (params.leaseToken && task.lease && task.lease.token !== params.leaseToken) {
    throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
  }

  const nowIso = params.nowIso ?? new Date().toISOString();
  const completedTask: TaskQueueItem = {
    ...task,
    status: "COMPLETED",
    lease: null,
    completed_at: nowIso,
    updated_at: nowIso,
  };

  queue[index] = completedTask;

  // Unblock dependent tasks
  const unblockedTasks: TaskQueueItem[] = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if (item.status === "COMPLETED" || item.id === completedTask.id) continue;

    if (item.blocked_by.includes(completedTask.id)) {
      const remainingBlocked = item.blocked_by.filter((id) => id !== completedTask.id);
      const isNowPending = remainingBlocked.length === 0 && item.status === "BLOCKED";

      const updatedItem: TaskQueueItem = {
        ...item,
        blocked_by: remainingBlocked,
        status: isNowPending ? "PENDING" : item.status,
        updated_at: nowIso,
      };

      queue[i] = updatedItem;
      if (isNowPending) {
        unblockedTasks.push(updatedItem);
      }
    }
  }

  let archivedRecord: CompletedTaskRecord | undefined = undefined;
  if (params.autoArchive || params.proofSummary) {
    const proofSummary =
      params.proofSummary ?? completedTask.description ?? `Completed task ${completedTask.id}`;
    try {
      archivedRecord = recordCompletedTask(
        {
          id: completedTask.id,
          source: "task_queue",
          title: completedTask.title,
          status: "COMPLETED",
          proof_summary: proofSummary,
          completed_at: nowIso,
          category: (completedTask.metadata?.["category"] as string | undefined) ?? "CORE_ENGINE",
          test_path:
            params.testPath ?? (completedTask.metadata?.["test_path"] as string | undefined),
          assertions:
            params.assertions ??
            (completedTask.metadata?.["assertions"] as
              | number
              | string
              | readonly string[]
              | null
              | undefined),
          runtime_ms:
            params.runtimeMs ??
            (completedTask.metadata?.["runtime_ms"] as number | string | null | undefined),
          commit_sha:
            params.commitSha ?? (completedTask.metadata?.["commit_sha"] as string | undefined),
          metadata: completedTask.metadata,
        },
        { customPath: params.completedTasksPath },
      );
    } catch {
      // Non-fatal archival fallback
    }
  }

  if (params.autoPrune) {
    const remainingQueue = queue.filter((t) => t.id !== completedTask.id);
    writeTaskQueueUnlocked(remainingQueue, filePath);
  } else {
    writeTaskQueueUnlocked(queue, filePath);
  }

  return {
    completedTask,
    unblockedTasks,
    ...(archivedRecord ? { archivedRecord } : {}),
  };
}

/**
 * Escalates a task to a higher supervisory tier or human review.
 */
export function escalateTask(params: {
  readonly taskId: string;
  readonly reason: string;
  readonly escalationTier?: string | undefined;
  readonly agentId?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): {
  readonly task: TaskQueueItem;
  readonly affectedDependents: readonly string[];
} {
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => escalateTaskUnlocked(params, filePath));
}

export function escalateTaskUnlocked(
  params: {
    readonly taskId: string;
    readonly reason: string;
    readonly escalationTier?: string | undefined;
    readonly agentId?: string | undefined;
    readonly leaseToken?: string | undefined;
    readonly nowIso?: string | undefined;
  },
  filePath: string,
): { readonly task: TaskQueueItem; readonly affectedDependents: readonly string[] } {
  const queue = readTaskQueueFile(filePath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  }

  const task = queue[index]!;
  if (task.status === "COMPLETED") {
    throw new HarnessError("INVALID_STATE", `Cannot escalate task '${task.id}': already COMPLETED`);
  }

  if (params.leaseToken && task.lease && task.lease.token !== params.leaseToken) {
    throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
  }

  const nowIso = params.nowIso ?? new Date().toISOString();
  const escalatedTask: TaskQueueItem = {
    ...task,
    status: "ESCALATED",
    lease: null,
    escalated_at: nowIso,
    error_message: params.reason,
    assigned_tier: params.escalationTier ?? task.assigned_tier ?? "Tier_0_Mind",
    updated_at: nowIso,
    metadata: {
      ...(task.metadata ?? {}),
      escalated_by: params.agentId ?? "system",
      escalation_reason: params.reason,
      escalation_timestamp: nowIso,
    },
  };

  queue[index] = escalatedTask;

  // Mark all dependent tasks as BLOCKED
  const affectedDependents: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if (
      item.id === escalatedTask.id ||
      item.status === "COMPLETED" ||
      item.status === "FAILED" ||
      item.status === "ESCALATED"
    )
      continue;

    if (item.dependencies.includes(escalatedTask.id)) {
      if (!item.blocked_by.includes(escalatedTask.id)) {
        queue[i] = {
          ...item,
          status: "BLOCKED",
          blocked_by: [...item.blocked_by, escalatedTask.id],
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
    task: escalatedTask,
    affectedDependents,
  };
}

/**
 * Records a task failure, managing retries and blocking dependent tasks if permanently failed.
 */
