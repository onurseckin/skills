import { PRIORITY_WEIGHTS, resolveTaskQueuePath, type TaskQueueItem } from "./types.ts";
import type { TaskQueueFilterOptions, TaskQueueStats } from "./filters.ts";
import { withTaskQueueTransaction } from "./locks.ts";
import {
  cleanStaleTempFiles,
  readTaskQueue,
  readTaskQueueFile,
  writeTaskQueueUnlocked,
} from "./storage.ts";
import {
  recordCompletedTasksBatch,
  type CompletedTaskRecord,
} from "../../mind/archival/completed/index.ts";
import { dirname } from "node:path";

export function getQueueStats(
  customPathOrItems?: string | readonly TaskQueueItem[],
): TaskQueueStats {
  const items = Array.isArray(customPathOrItems)
    ? customPathOrItems
    : readTaskQueue(typeof customPathOrItems === "string" ? customPathOrItems : undefined);

  const nowMs = Date.now();
  let pending = 0;
  let admitted = 0;
  let inProgress = 0;
  let running = 0;
  let validating = 0;
  let completed = 0;
  let failed = 0;
  let blocked = 0;
  let escalated = 0;
  let activeLeases = 0;
  let expiredLeases = 0;

  for (const item of items) {
    switch (item.status) {
      case "PENDING":
        pending += 1;
        break;
      case "ADMITTED":
        admitted += 1;
        break;
      case "IN_PROGRESS":
        inProgress += 1;
        break;
      case "RUNNING":
        running += 1;
        inProgress += 1;
        break;
      case "VALIDATING":
        validating += 1;
        break;
      case "COMPLETED":
        completed += 1;
        break;
      case "FAILED":
        failed += 1;
        break;
      case "BLOCKED":
        blocked += 1;
        break;
      case "ESCALATED":
        escalated += 1;
        break;
    }
    if (item.lease) {
      const expMs = Date.parse(item.lease.expires_at);
      if (Number.isFinite(expMs) && expMs > nowMs) activeLeases += 1;
      else expiredLeases += 1;
    }
  }

  return {
    total: items.length,
    pending,
    admitted,
    in_progress: inProgress,
    running,
    validating,
    completed,
    failed,
    blocked,
    escalated,
    active_leases: activeLeases,
    expired_leases: expiredLeases,
  };
}

export function getTaskQueueStats(tasksOrPath?: readonly TaskQueueItem[] | string): TaskQueueStats {
  return getQueueStats(tasksOrPath);
}

export function listTaskQueue(options: TaskQueueFilterOptions = {}): TaskQueueItem[] {
  const all = readTaskQueue(options.customPath);
  let filtered = all;
  if (options.status) filtered = filtered.filter((t) => t.status === options.status);
  if (options.priority) filtered = filtered.filter((t) => t.priority === options.priority);
  if (options.agentId) filtered = filtered.filter((t) => t.lease?.agent_id === options.agentId);
  if (options.search) {
    const q = options.search.toLowerCase();
    filtered = filtered.filter(
      (t) => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q),
    );
  }

  filtered.sort((a, b) => {
    const pDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
    if (pDiff !== 0) return pDiff;
    return a.created_at.localeCompare(b.created_at);
  });

  if (options.limit !== undefined && options.limit > 0) return filtered.slice(0, options.limit);
  return filtered;
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
    } catch {}
  }

  if (prunedCount > 0) writeTaskQueueUnlocked(remaining, filePath);
  return { prunedCount, remainingCount: remaining.length, archivedCount };
}

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

export function pruneTaskQueue(options?: {
  readonly customPath?: string | undefined;
  readonly completedTasksPath?: string | undefined;
  readonly autoArchive?: boolean | undefined;
}): {
  readonly prunedCount: number;
  readonly remainingCount: number;
  readonly archivedCount?: number | undefined;
} {
  return pruneCompletedTasks(options?.customPath, options);
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

  if (modified) writeTaskQueueUnlocked(queue, filePath);
  return { reclaimedCount: reclaimedTasks.length, tasks: reclaimedTasks };
}

export function reclaimExpiredLeases(
  params: { readonly customPath?: string | undefined; readonly nowMs?: number | undefined } = {},
): { readonly reclaimedCount: number; readonly tasks: readonly TaskQueueItem[] } {
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => reclaimExpiredLeasesUnlocked(params, filePath));
}

export function compactTaskQueue(filePath?: string): {
  readonly beforeCount: number;
  readonly afterCount: number;
  readonly prunedCount: number;
} {
  const targetPath = resolveTaskQueuePath(filePath);
  return withTaskQueueTransaction(targetPath, () => {
    const before = readTaskQueueFile(targetPath);
    const pruneRes = pruneCompletedTasksUnlocked(undefined, targetPath);
    cleanStaleTempFiles(dirname(targetPath));
    return {
      beforeCount: before.length,
      afterCount: pruneRes.remainingCount,
      prunedCount: pruneRes.prunedCount,
    };
  });
}
