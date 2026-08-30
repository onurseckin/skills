import { HarnessError } from "../../core/errors/index.ts";
import {
  recordCompletedTask,
  type CompletedTaskRecord,
} from "../../mind/archival/completed/index.ts";
import { validateCompletionReceipts } from "./lease.ts";
import { withTaskQueueTransaction } from "./locks.ts";
import { readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";
import { resolveTaskQueuePath, type CompletionReceipts, type TaskQueueItem } from "./types.ts";

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
    readonly receipts?: CompletionReceipts | undefined;
  },
  filePath: string,
): {
  readonly completedTask: TaskQueueItem;
  readonly unblockedTasks: readonly TaskQueueItem[];
  readonly archivedRecord?: CompletedTaskRecord | undefined;
} {
  validateCompletionReceipts(params.receipts);
  const queue = readTaskQueueFile(filePath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  }
  const task = queue[index]!;
  if (task.status === "COMPLETED") return { completedTask: task, unblockedTasks: [] };
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
      if (isNowPending) unblockedTasks.push(updatedItem);
    }
  }
  let archivedRecord: CompletedTaskRecord | undefined;
  if (params.autoArchive || params.proofSummary || params.receipts?.proof_summary) {
    const proofSummary =
      params.proofSummary ??
      params.receipts?.proof_summary ??
      completedTask.description ??
      `Completed task ${completedTask.id}`;
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
            params.testPath ??
            params.receipts?.test_path ??
            (completedTask.metadata?.["test_path"] as string | undefined),
          assertions:
            params.assertions ??
            params.receipts?.assertions ??
            (completedTask.metadata?.["assertions"] as
              | number
              | string
              | readonly string[]
              | null
              | undefined),
          runtime_ms:
            params.runtimeMs ??
            params.receipts?.runtime_ms ??
            (completedTask.metadata?.["runtime_ms"] as number | string | null | undefined),
          commit_sha:
            params.commitSha ??
            params.receipts?.commit_sha ??
            (completedTask.metadata?.["commit_sha"] as string | undefined),
          metadata: completedTask.metadata,
        },
        { customPath: params.completedTasksPath },
      );
    } catch {}
  }
  if (params.autoPrune) {
    writeTaskQueueUnlocked(
      queue.filter((t) => t.id !== completedTask.id),
      filePath,
    );
  } else {
    writeTaskQueueUnlocked(queue, filePath);
  }
  return { completedTask, unblockedTasks, ...(archivedRecord ? { archivedRecord } : {}) };
}

export function completeTask(
  paramsOrId:
    | string
    | {
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
        readonly receipts?: CompletionReceipts | undefined;
      },
  tokenOrReceipts?: string | CompletionReceipts,
  receiptsArgOrPath?: CompletionReceipts | string,
  customPathArg?: string,
): {
  readonly completedTask: TaskQueueItem;
  readonly unblockedTasks: readonly TaskQueueItem[];
  readonly archivedRecord?: CompletedTaskRecord | undefined;
} {
  let params: {
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
    readonly receipts?: CompletionReceipts | undefined;
  };
  if (typeof paramsOrId === "string") {
    params = {
      taskId: paramsOrId,
      leaseToken: typeof tokenOrReceipts === "string" ? tokenOrReceipts : undefined,
      receipts:
        typeof tokenOrReceipts === "object"
          ? tokenOrReceipts
          : typeof receiptsArgOrPath === "object"
            ? receiptsArgOrPath
            : undefined,
      customPath:
        typeof customPathArg === "string"
          ? customPathArg
          : typeof receiptsArgOrPath === "string"
            ? receiptsArgOrPath
            : undefined,
    };
  } else {
    params = paramsOrId;
  }
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => completeTaskUnlocked(params, p));
}
