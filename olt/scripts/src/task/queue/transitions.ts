import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type { CompletionReceipts, TaskQueueItem } from "./types.ts";
import { resolveTaskQueuePath } from "./types.ts";
import { withTaskQueueTransaction } from "./locks.ts";
import { readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";
import {
  recordCompletedTask,
  type CompletedTaskRecord,
} from "../../mind/archival/completed/index.ts";

export function assertValidActiveLease(task: TaskQueueItem, expectedToken?: string): void {
  if (!task.lease)
    throw new HarnessError("INVALID_STATE", `Task '${task.id}' does not have an active lease`);
  if (expectedToken && task.lease.token !== expectedToken)
    throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
  const expMs = Date.parse(task.lease.expires_at);
  if (Number.isFinite(expMs) && expMs <= Date.now())
    throw new HarnessError("INVALID_STATE", `Lease expired for task '${task.id}'`);
}

export function validateCompletionReceipts(receipts?: CompletionReceipts): void {
  if (!receipts) return;
  if (receipts.exit_code !== undefined && receipts.exit_code !== 0) {
    throw new HarnessError(
      "INTEGRITY",
      `Mechanical exit code must be 0, got ${receipts.exit_code}`,
    );
  }
  if (receipts.cognitive_verdict !== undefined && receipts.cognitive_verdict !== "PASS") {
    throw new HarnessError(
      "INTEGRITY",
      `Cognitive verdict must be PASS, got ${receipts.cognitive_verdict}`,
    );
  }
}

export function assertWriteScopeASTPurity(repoRoot: string, writeScope: readonly string[]): void {
  for (const relPath of writeScope) {
    const fullPath = resolve(repoRoot, relPath);
    if (
      existsSync(fullPath) &&
      (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx") || fullPath.endsWith(".js"))
    ) {
      const content = readFileSync(fullPath, "utf8");
      if (content.includes("/*") || content.includes("//"))
        throw new HarnessError("INTEGRITY", `AST purity invariant violated in ${relPath}`);
    }
  }
}

export function stageWorktreeProgress(worktreePath: string): void {
  if (existsSync(worktreePath)) {
    try {
      const proc = spawnSync("git", ["add", "-A"], { cwd: worktreePath });
      if (proc.status !== 0)
        throw new HarnessError("INTEGRITY", `Failed to stage worktree in ${worktreePath}`);
    } catch (error) {
      if (error instanceof HarnessError) throw error;
    }
  }
}

export function translateSuspendedLeases(
  tasks: readonly TaskQueueItem[],
  frozenDurationMs: number,
): { readonly translatedCount: number; readonly tasks: readonly TaskQueueItem[] } {
  if (frozenDurationMs <= 0) return { translatedCount: 0, tasks: [...tasks] };
  let count = 0;
  const updated = tasks.map((task) => {
    if (
      task.lease &&
      (task.status === "IN_PROGRESS" || task.status === "RUNNING" || task.status === "VALIDATING")
    ) {
      const expMs = Date.parse(task.lease.expires_at);
      if (Number.isFinite(expMs)) {
        count++;
        return {
          ...task,
          lease: { ...task.lease, expires_at: new Date(expMs + frozenDurationMs).toISOString() },
        };
      }
    }
    return task;
  });
  return { translatedCount: count, tasks: updated };
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
      ...(task.metadata ?? {}),
      escalated_by: params.agentId ?? "system",
      escalation_reason: params.reason,
      escalation_timestamp: nowIso,
    },
  };

  queue[index] = escalatedTask;
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
      const blockedBy = item.blocked_by.includes(escalatedTask.id)
        ? item.blocked_by
        : [...item.blocked_by, escalatedTask.id];
      queue[i] = { ...item, status: "BLOCKED", blocked_by: blockedBy, updated_at: nowIso };
      affectedDependents.push(item.id);
    }
  }

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
      const blockedBy = item.blocked_by.includes(failedTask.id)
        ? item.blocked_by
        : [...item.blocked_by, failedTask.id];
      queue[i] = { ...item, status: "BLOCKED", blocked_by: blockedBy, updated_at: nowIso };
      affectedDependents.push(item.id);
    }
  }

  writeTaskQueueUnlocked(queue, filePath);
  return { task: failedTask, retried: false, affectedDependents, escalated: false };
}

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
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => failTaskUnlocked(params, p));
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
  if (index === -1)
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  const task = queue[index]!;
  if (task.status === "COMPLETED") return { completedTask: task, unblockedTasks: [] };
  if (params.leaseToken && task.lease && task.lease.token !== params.leaseToken)
    throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);

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
    } catch {}
  }

  if (params.autoPrune)
    writeTaskQueueUnlocked(
      queue.filter((t) => t.id !== completedTask.id),
      filePath,
    );
  else writeTaskQueueUnlocked(queue, filePath);

  return { completedTask, unblockedTasks, ...(archivedRecord ? { archivedRecord } : {}) };
}

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
  readonly receipts?: CompletionReceipts | undefined;
}): {
  readonly completedTask: TaskQueueItem;
  readonly unblockedTasks: readonly TaskQueueItem[];
  readonly archivedRecord?: CompletedTaskRecord | undefined;
} {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => completeTaskUnlocked(params, p));
}
