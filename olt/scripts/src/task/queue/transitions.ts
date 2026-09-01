import { HarnessError } from "../../core/errors/index.ts";
import { withTaskQueueTransaction } from "./locks.ts";
import { readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";
import { resolveTaskQueuePath, type TaskQueueItem } from "./types.ts";

export {
  assertValidActiveLease,
  assertWriteScopeASTPurity,
  stageWorktreeProgress,
  translateSuspendedLeases,
  validateCompletionReceipts,
} from "./lease.ts";

export { completeTask, completeTaskUnlocked } from "./completion.ts";

function propagateBlock(queue: TaskQueueItem[], blockerId: string, nowIso: string): string[] {
  const affected: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if (
      item.id === blockerId ||
      item.status === "COMPLETED" ||
      item.status === "FAILED" ||
      item.status === "ESCALATED"
    )
      continue;
    if (item.dependencies.includes(blockerId)) {
      const blockedBy = item.blocked_by.includes(blockerId)
        ? item.blocked_by
        : [...item.blocked_by, blockerId];
      queue[i] = { ...item, status: "BLOCKED", blocked_by: blockedBy, updated_at: nowIso };
      affected.push(item.id);
    }
  }
  return affected;
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
  if (index === -1)
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  const task = queue[index]!;
  if (task.status === "COMPLETED")
    throw new HarnessError("INVALID_STATE", `Cannot escalate task '${task.id}': already COMPLETED`);
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
      ...task.metadata,
      escalated_by: params.agentId ?? "system",
      escalation_reason: params.reason,
      escalation_timestamp: nowIso,
    },
  };
  queue[index] = escalatedTask;
  const affectedDependents = propagateBlock(queue, escalatedTask.id, nowIso);
  writeTaskQueueUnlocked(queue, filePath);
  return { task: escalatedTask, affectedDependents };
}

export function escalateTask(params: {
  readonly taskId: string;
  readonly reason: string;
  readonly escalationTier?: string | undefined;
  readonly agentId?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): { readonly task: TaskQueueItem; readonly affectedDependents: readonly string[] } {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => escalateTaskUnlocked(params, p));
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
  if (index === -1)
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
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
    return { task: retriedTask, retried: true, affectedDependents: [], escalated: false };
  }
  if (params.escalateOnMaxRetries) {
    const esc = escalateTaskUnlocked(
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
      task: esc.task,
      retried: false,
      affectedDependents: esc.affectedDependents,
      escalated: true,
    };
  }
  const failedTask: TaskQueueItem = {
    ...task,
    status: "FAILED",
    lease: null,
    failed_at: nowIso,
    error_message: params.errorMessage,
    updated_at: nowIso,
  };
  queue[index] = failedTask;
  const affectedDependents = propagateBlock(queue, failedTask.id, nowIso);
  writeTaskQueueUnlocked(queue, filePath);
  return { task: failedTask, retried: false, affectedDependents, escalated: false };
}

export function failTask(
  paramsOrId:
    | string
    | {
        readonly taskId: string;
        readonly errorMessage: string;
        readonly agentId?: string | undefined;
        readonly leaseToken?: string | undefined;
        readonly canRetry?: boolean | undefined;
        readonly escalateOnMaxRetries?: boolean | undefined;
        readonly customPath?: string | undefined;
        readonly nowIso?: string | undefined;
      },
  token?: string,
  errorMessage?: string,
  allowRetryOrCustomPath?: boolean | string,
  customPathArg?: string,
): {
  readonly task: TaskQueueItem;
  readonly retried: boolean;
  readonly affectedDependents: readonly string[];
  readonly escalated?: boolean | undefined;
} {
  let params: {
    readonly taskId: string;
    readonly errorMessage: string;
    readonly agentId?: string | undefined;
    readonly leaseToken?: string | undefined;
    readonly canRetry?: boolean | undefined;
    readonly escalateOnMaxRetries?: boolean | undefined;
    readonly customPath?: string | undefined;
    readonly nowIso?: string | undefined;
  };
  if (typeof paramsOrId === "string") {
    params = {
      taskId: paramsOrId,
      leaseToken: token,
      errorMessage: errorMessage ?? "Task failed",
      canRetry: typeof allowRetryOrCustomPath === "boolean" ? allowRetryOrCustomPath : undefined,
      customPath:
        typeof customPathArg === "string"
          ? customPathArg
          : typeof allowRetryOrCustomPath === "string"
            ? allowRetryOrCustomPath
            : undefined,
    };
  } else {
    params = paramsOrId;
  }
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => failTaskUnlocked(params, p));
}
