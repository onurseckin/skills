import { PRIORITY_WEIGHTS } from "./types.ts";
import type { TaskQueueItem, TaskQueueStats, TaskPriority, TaskQueueStatus } from "./types.ts";
import { readTaskQueue } from "./storage.ts";
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
      if (Number.isFinite(expMs) && expMs > nowMs) {
        activeLeases += 1;
      } else {
        expiredLeases += 1;
      }
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

/**
 * Lists tasks from queue with optional filtering.
 */
export function listTaskQueue(
  options: {
    readonly status?: TaskQueueStatus | undefined;
    readonly priority?: TaskPriority | undefined;
    readonly customPath?: string | undefined;
    readonly limit?: number | undefined;
  } = {},
): TaskQueueItem[] {
  const all = readTaskQueue(options.customPath);
  let filtered = all;

  if (options.status) {
    filtered = filtered.filter((t) => t.status === options.status);
  }
  if (options.priority) {
    filtered = filtered.filter((t) => t.priority === options.priority);
  }

  // Sort by priority descending, then created_at ascending
  filtered.sort((a, b) => {
    const pDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
    if (pDiff !== 0) return pDiff;
    return a.created_at.localeCompare(b.created_at);
  });

  if (options.limit !== undefined && options.limit > 0) {
    return filtered.slice(0, options.limit);
  }

  return filtered;
}

/**
 * Prunes completed tasks from queue storage, automatically archiving them to completed-tasks.jsonl.
 */
