import {
  DEFAULT_LEASE_DURATION_SECONDS,
  PRIORITY_WEIGHTS,
  resolveTaskQueuePath,
  type TaskQueueItem,
} from "./types.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { withTaskQueueTransaction } from "./locks.ts";
import { readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";
import { pruneCompletedTasksUnlocked, reclaimExpiredLeasesUnlocked } from "./maintenance.ts";
import { claimTaskLeaseUnlocked } from "./lease.ts";

function findTask(
  queue: readonly TaskQueueItem[],
  taskId: string,
): { readonly task: TaskQueueItem; readonly index: number } {
  const index = queue.findIndex((t) => t.id === taskId);
  if (index === -1)
    throw new HarnessError("INVALID_ARGUMENT", `Task '${taskId}' not found in task queue`);
  return { task: queue[index]!, index };
}

export function assertSingleActiveLease(
  tasks: readonly TaskQueueItem[],
  agentId: string,
  nowMs = Date.now(),
): void {
  for (const task of tasks) {
    if (
      (task.status === "IN_PROGRESS" ||
        task.status === "RUNNING" ||
        task.status === "VALIDATING") &&
      task.lease &&
      task.lease.agent_id === agentId
    ) {
      const expMs = Date.parse(task.lease.expires_at);
      if (Number.isFinite(expMs) && expMs > nowMs) {
        throw new HarnessError(
          "INVALID_STATE",
          `Agent '${agentId}' already holds active lease on task '${task.id}'`,
        );
      }
    }
  }
}

export function admitTaskUnlocked(
  params: { readonly taskId: string; readonly admittedBy?: string; readonly nowIso?: string },
  filePath: string,
): TaskQueueItem {
  const queue = readTaskQueueFile(filePath);
  const { task, index } = findTask(queue, params.taskId);
  if (task.status === "COMPLETED")
    throw new HarnessError("INVALID_STATE", `Cannot admit task '${task.id}': already COMPLETED`);
  if (task.status === "FAILED" || task.status === "ESCALATED") {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot admit task '${task.id}': task has status ${task.status}`,
    );
  }
  const nowIso = params.nowIso ?? new Date().toISOString();
  const admittedTask: TaskQueueItem = {
    ...task,
    status: task.blocked_by.length > 0 ? "BLOCKED" : "ADMITTED",
    updated_at: nowIso,
    metadata: {
      ...(task.metadata ?? {}),
      ...(params.admittedBy ? { admitted_by: params.admittedBy } : {}),
      admitted_at: nowIso,
    },
  };
  queue[index] = admittedTask;
  writeTaskQueueUnlocked(queue, filePath);
  return admittedTask;
}

export function admitTask(params: {
  readonly taskId: string;
  readonly admittedBy?: string;
  readonly customPath?: string;
  readonly nowIso?: string;
}): TaskQueueItem {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => admitTaskUnlocked(params, p));
}

export function popNextEligibleTaskUnlocked(
  params: { readonly agentId: string; readonly durationSeconds?: number; readonly nowIso?: string },
  filePath: string,
): { readonly task: TaskQueueItem; readonly leaseToken: string } | null {
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  reclaimExpiredLeasesUnlocked({ nowMs }, filePath);
  const queue = readTaskQueueFile(filePath);
  assertSingleActiveLease(queue, params.agentId, nowMs);
  const eligible = queue.filter((t) => {
    if (t.status !== "PENDING" && t.status !== "ADMITTED") return false;
    if (t.blocked_by.length > 0) return false;
    if (t.lease) {
      const expMs = Date.parse(t.lease.expires_at);
      if (Number.isFinite(expMs) && expMs > nowMs) return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;
  eligible.sort(
    (a, b) =>
      PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority] ||
      a.created_at.localeCompare(b.created_at),
  );
  return claimTaskLeaseUnlocked(
    {
      taskId: eligible[0]!.id,
      agentId: params.agentId,
      ...(params.durationSeconds !== undefined ? { durationSeconds: params.durationSeconds } : {}),
      ...(params.nowIso !== undefined ? { nowIso: params.nowIso } : {}),
    },
    filePath,
  );
}

export function popNextEligibleTask(params: {
  readonly agentId: string;
  readonly durationSeconds?: number;
  readonly customPath?: string;
  readonly nowIso?: string;
}): { readonly task: TaskQueueItem; readonly leaseToken: string } | null {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => popNextEligibleTaskUnlocked(params, p));
}

export function popNextEligibleTaskWithCleanup(params: {
  readonly agentId: string;
  readonly durationSeconds?: number;
  readonly customPath?: string;
  readonly completedTasksPath?: string;
  readonly nowIso?: string;
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
      {
        agentId: params.agentId,
        ...(params.durationSeconds !== undefined
          ? { durationSeconds: params.durationSeconds }
          : {}),
        ...(params.nowIso !== undefined ? { nowIso: params.nowIso } : {}),
      },
      filePath,
    );
    return popped ? { ...popped, prunedCount: pruneRes.prunedCount } : null;
  });
}

export function dequeueTask(
  agentId: string,
  durationSeconds = DEFAULT_LEASE_DURATION_SECONDS,
  options?: { readonly customPath?: string; readonly nowIso?: string },
): TaskQueueItem | null {
  const filePath = resolveTaskQueuePath(options?.customPath);
  return withTaskQueueTransaction(filePath, () => {
    const popped = popNextEligibleTaskUnlocked(
      {
        agentId,
        durationSeconds,
        ...(options?.nowIso !== undefined ? { nowIso: options.nowIso } : {}),
      },
      filePath,
    );
    return popped ? popped.task : null;
  });
}
