import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export type TaskQueueStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED";

export const TASK_QUEUE_STATUSES: readonly TaskQueueStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
];

export type TaskPriority =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "BACKGROUND";

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
  | "blunder_remediation"
  | "direct_prompt";

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
  readonly retry_count: number;
  readonly max_retries: number;
  readonly error_message?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface NewTaskQueueInput {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly write_scope: readonly string[];
  readonly gate: string;
  readonly charter_goals?: readonly string[] | undefined;
  readonly acceptance_criteria?: readonly string[] | undefined;
  readonly dependencies?: readonly string[] | undefined;
  readonly source_type?: TaskSourceType | undefined;
  readonly max_retries?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface TaskQueueStats {
  readonly total: number;
  readonly pending: number;
  readonly in_progress: number;
  readonly completed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly active_leases: number;
  readonly expired_leases: number;
}

const DEFAULT_TASK_QUEUE_FILE = ".capsules/TASK_QUEUE.jsonl";
const DEFAULT_LEASE_DURATION_SECONDS = 1800; // 30 minutes
const DEFAULT_MAX_RETRIES = 3;

/**
 * Resolves the absolute path to the task queue storage file.
 */
export function resolveTaskQueuePath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  const cwd = process.cwd();
  if (existsSync(join(cwd, ".capsules"))) {
    return join(cwd, DEFAULT_TASK_QUEUE_FILE);
  }
  const parentCapsules = join(dirname(cwd), ".capsules");
  if (existsSync(parentCapsules)) {
    return join(dirname(cwd), DEFAULT_TASK_QUEUE_FILE);
  }
  return resolve(cwd, DEFAULT_TASK_QUEUE_FILE);
}

/**
 * Reads and parses all task items from the task queue JSONL storage.
 */
export function readTaskQueue(customPath?: string): TaskQueueItem[] {
  const filePath = resolveTaskQueuePath(customPath);
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const items: TaskQueueItem[] = [];

  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (!parsed["id"] || typeof parsed["id"] !== "string") {
        continue;
      }
      items.push(deserializeTaskQueueItem(parsed));
    } catch {
      // Ignore individual malformed log lines
    }
  }

  return items;
}

/**
 * Writes task items atomically to the task queue storage.
 */
export function writeTaskQueue(items: readonly TaskQueueItem[], customPath?: string): void {
  const filePath = resolveTaskQueuePath(customPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lines = items.map((item) => JSON.stringify(item));
  writeFileSync(filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
}

/**
 * Clears all items in the task queue.
 */
export function clearTaskQueue(customPath?: string): void {
  const filePath = resolveTaskQueuePath(customPath);
  if (existsSync(filePath)) {
    writeFileSync(filePath, "", "utf8");
  }
}

/**
 * Validates task dependency DAG for circular dependencies using depth-first search.
 */
export function validateTaskQueueDag(items: readonly TaskQueueItem[]): {
  readonly ok: boolean;
  readonly cycles: readonly (readonly string[])[];
} {
  const itemMap = new Map<string, TaskQueueItem>();
  for (const item of items) {
    itemMap.set(item.id, item);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];
  const cycles: string[][] = [];

  function dfs(nodeId: string): void {
    visited.add(nodeId);
    recStack.add(nodeId);
    path.push(nodeId);

    const item = itemMap.get(nodeId);
    if (item) {
      for (const depId of item.dependencies) {
        if (!visited.has(depId)) {
          if (itemMap.has(depId)) {
            dfs(depId);
          }
        } else if (recStack.has(depId)) {
          const cycleStart = path.indexOf(depId);
          if (cycleStart !== -1) {
            cycles.push([...path.slice(cycleStart), depId]);
          }
        }
      }
    }

    path.pop();
    recStack.delete(nodeId);
  }

  for (const item of items) {
    if (!visited.has(item.id)) {
      dfs(item.id);
    }
  }

  return {
    ok: cycles.length === 0,
    cycles,
  };
}

/**
 * Enqueues a single new task into the task queue with dependency resolution.
 */
export function enqueueTask(
  input: NewTaskQueueInput,
  customPath?: string,
): TaskQueueItem {
  const existing = readTaskQueue(customPath);
  const duplicate = existing.find((e) => e.id === input.id);
  if (duplicate) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Task with id '${input.id}' already exists in the queue`,
    );
  }

  const rawDeps = input.dependencies ?? [];
  if (rawDeps.includes(input.id)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Task '${input.id}' cannot depend on itself`,
    );
  }

  const nowIso = new Date().toISOString();
  const completedIds = new Set(
    existing.filter((t) => t.status === "COMPLETED").map((t) => t.id),
  );

  // Compute unresolved dependencies
  const blockedBy = rawDeps.filter((depId) => !completedIds.has(depId));
  const initialStatus: TaskQueueStatus = blockedBy.length > 0 ? "BLOCKED" : "PENDING";

  const newItem: TaskQueueItem = {
    id: input.id.trim(),
    title: input.title.trim(),
    description: input.description?.trim() ?? input.title.trim(),
    priority: input.priority ?? "MEDIUM",
    status: initialStatus,
    write_scope: [...input.write_scope],
    gate: input.gate.trim(),
    charter_goals: input.charter_goals && input.charter_goals.length > 0 ? [...input.charter_goals] : ["G1"],
    acceptance_criteria: input.acceptance_criteria ? [...input.acceptance_criteria] : [],
    dependencies: [...rawDeps],
    blocked_by: blockedBy,
    lease: null,
    source_type: input.source_type ?? "direct_prompt",
    created_at: nowIso,
    updated_at: nowIso,
    started_at: null,
    completed_at: null,
    failed_at: null,
    retry_count: 0,
    max_retries: input.max_retries ?? DEFAULT_MAX_RETRIES,
    error_message: null,
    metadata: input.metadata,
  };

  const updatedQueue = [...existing, newItem];
  const dagCheck = validateTaskQueueDag(updatedQueue);
  if (!dagCheck.ok) {
    const cycleStr = dagCheck.cycles.map((c) => c.join(" -> ")).join("; ");
    throw new HarnessError(
      "INTEGRITY",
      `Cannot enqueue task '${newItem.id}': circular dependency detected (${cycleStr})`,
    );
  }

  writeTaskQueue(updatedQueue, customPath);
  return newItem;
}

/**
 * Enqueues a batch of tasks, validating and wiring dependencies across the batch.
 */
export function enqueueTasksBatch(
  inputs: readonly NewTaskQueueInput[],
  customPath?: string,
): readonly TaskQueueItem[] {
  const existing = readTaskQueue(customPath);
  const existingIds = new Set(existing.map((e) => e.id));
  const newIds = new Set<string>();

  for (const input of inputs) {
    if (existingIds.has(input.id) || newIds.has(input.id)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Duplicate task id '${input.id}' detected in batch enqueue`,
      );
    }
    newIds.add(input.id);
  }

  const nowIso = new Date().toISOString();
  const completedIds = new Set(
    existing.filter((t) => t.status === "COMPLETED").map((t) => t.id),
  );

  const newItems: TaskQueueItem[] = [];
  for (const input of inputs) {
    const rawDeps = input.dependencies ?? [];
    if (rawDeps.includes(input.id)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Task '${input.id}' cannot depend on itself`,
      );
    }

    const blockedBy = rawDeps.filter((depId) => !completedIds.has(depId));
    const initialStatus: TaskQueueStatus = blockedBy.length > 0 ? "BLOCKED" : "PENDING";

    newItems.push({
      id: input.id.trim(),
      title: input.title.trim(),
      description: input.description?.trim() ?? input.title.trim(),
      priority: input.priority ?? "MEDIUM",
      status: initialStatus,
      write_scope: [...input.write_scope],
      gate: input.gate.trim(),
      charter_goals: input.charter_goals && input.charter_goals.length > 0 ? [...input.charter_goals] : ["G1"],
      acceptance_criteria: input.acceptance_criteria ? [...input.acceptance_criteria] : [],
      dependencies: [...rawDeps],
      blocked_by: blockedBy,
      lease: null,
      source_type: input.source_type ?? "direct_prompt",
      created_at: nowIso,
      updated_at: nowIso,
      started_at: null,
      completed_at: null,
      failed_at: null,
      retry_count: 0,
      max_retries: input.max_retries ?? DEFAULT_MAX_RETRIES,
      error_message: null,
      metadata: input.metadata,
    });
  }

  const updatedQueue = [...existing, ...newItems];
  const dagCheck = validateTaskQueueDag(updatedQueue);
  if (!dagCheck.ok) {
    const cycleStr = dagCheck.cycles.map((c) => c.join(" -> ")).join("; ");
    throw new HarnessError(
      "INTEGRITY",
      `Cannot enqueue batch: circular dependency detected (${cycleStr})`,
    );
  }

  writeTaskQueue(updatedQueue, customPath);
  return newItems;
}

/**
 * Claims a lease on a specific task.
 */
export function claimTaskLease(params: {
  readonly taskId: string;
  readonly agentId: string;
  readonly durationSeconds?: number | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): { readonly task: TaskQueueItem; readonly leaseToken: string } {
  const queue = readTaskQueue(params.customPath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Task '${params.taskId}' not found in task queue`,
    );
  }

  const task = queue[index]!;
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  const nowIso = params.nowIso ?? new Date(nowMs).toISOString();

  if (task.status === "COMPLETED") {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot claim task '${task.id}': already COMPLETED`,
    );
  }

  if (task.status === "BLOCKED") {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot claim task '${task.id}': task is BLOCKED by [${task.blocked_by.join(", ")}]`,
    );
  }

  if (task.status === "FAILED") {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot claim task '${task.id}': task has FAILED (${task.error_message ?? "no error note"})`,
    );
  }

  if (task.status === "IN_PROGRESS" && task.lease) {
    const expiresMs = Date.parse(task.lease.expires_at);
    if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
      if (task.lease.agent_id !== params.agentId) {
        throw new HarnessError(
          "INVALID_STATE",
          `Task '${task.id}' is actively leased to agent '${task.lease.agent_id}' until ${task.lease.expires_at}`,
        );
      }
    }
  }

  const durationSec = params.durationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS;
  const expiresAt = new Date(nowMs + durationSec * 1000).toISOString();
  const token = `lease-${randomBytes(12).toString("hex")}`;
  const attempt = (task.lease?.attempt ?? 0) + 1;

  const leasedTask: TaskQueueItem = {
    ...task,
    status: "IN_PROGRESS",
    lease: {
      agent_id: params.agentId,
      leased_at: nowIso,
      expires_at: expiresAt,
      attempt,
      lease_duration_seconds: durationSec,
      token,
    },
    started_at: task.started_at ?? nowIso,
    updated_at: nowIso,
  };

  queue[index] = leasedTask;
  writeTaskQueue(queue, params.customPath);

  return {
    task: leasedTask,
    leaseToken: token,
  };
}

/**
 * Pops and claims the next highest priority eligible task from the queue.
 */
export function popNextEligibleTask(params: {
  readonly agentId: string;
  readonly durationSeconds?: number | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): { readonly task: TaskQueueItem; readonly leaseToken: string } | null {
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  reclaimExpiredLeases({ customPath: params.customPath, nowMs });

  const queue = readTaskQueue(params.customPath);
  const eligible = queue.filter((t) => {
    if (t.status !== "PENDING") return false;
    if (t.blocked_by.length > 0) return false;
    if (t.lease) {
      const expMs = Date.parse(t.lease.expires_at);
      if (Number.isFinite(expMs) && expMs > nowMs) return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    return null;
  }

  // Sort eligible tasks by priority weight descending, then by created_at ascending
  eligible.sort((a, b) => {
    const wDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
    if (wDiff !== 0) return wDiff;
    return a.created_at.localeCompare(b.created_at);
  });

  const selected = eligible[0]!;
  return claimTaskLease({
    taskId: selected.id,
    agentId: params.agentId,
    durationSeconds: params.durationSeconds,
    customPath: params.customPath,
    nowIso: params.nowIso,
  });
}

/**
 * Renews an existing active task lease.
 */
export function renewTaskLease(params: {
  readonly taskId: string;
  readonly agentId: string;
  readonly leaseToken: string;
  readonly extensionSeconds?: number | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): TaskQueueItem {
  const queue = readTaskQueue(params.customPath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Task '${params.taskId}' not found in task queue`,
    );
  }

  const task = queue[index]!;
  if (!task.lease) {
    throw new HarnessError(
      "INVALID_STATE",
      `Task '${task.id}' does not have an active lease`,
    );
  }

  if (task.lease.token !== params.leaseToken || task.lease.agent_id !== params.agentId) {
    throw new HarnessError(
      "INVALID_STATE",
      `Invalid lease token or agent mismatch for task '${task.id}'`,
    );
  }

  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  const nowIso = params.nowIso ?? new Date(nowMs).toISOString();
  const extSeconds = params.extensionSeconds ?? DEFAULT_LEASE_DURATION_SECONDS;
  const newExpiresAt = new Date(nowMs + extSeconds * 1000).toISOString();

  const renewedTask: TaskQueueItem = {
    ...task,
    lease: {
      ...task.lease,
      expires_at: newExpiresAt,
      lease_duration_seconds: extSeconds,
    },
    updated_at: nowIso,
  };

  queue[index] = renewedTask;
  writeTaskQueue(queue, params.customPath);
  return renewedTask;
}

/**
 * Releases a task lease back to PENDING status without completing it.
 */
export function releaseTaskLease(params: {
  readonly taskId: string;
  readonly agentId: string;
  readonly leaseToken?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): TaskQueueItem {
  const queue = readTaskQueue(params.customPath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Task '${params.taskId}' not found in task queue`,
    );
  }

  const task = queue[index]!;
  if (task.lease) {
    if (params.leaseToken && task.lease.token !== params.leaseToken) {
      throw new HarnessError(
        "INVALID_STATE",
        `Lease token mismatch for task '${task.id}'`,
      );
    }
    if (task.lease.agent_id !== params.agentId) {
      throw new HarnessError(
        "INVALID_STATE",
        `Agent '${params.agentId}' does not hold lease for task '${task.id}'`,
      );
    }
  }

  const nowIso = params.nowIso ?? new Date().toISOString();
  const releasedTask: TaskQueueItem = {
    ...task,
    status: "PENDING",
    lease: null,
    updated_at: nowIso,
  };

  queue[index] = releasedTask;
  writeTaskQueue(queue, params.customPath);
  return releasedTask;
}

/**
 * Marks a task as COMPLETED, clears lease, and unblocks any dependent tasks.
 */
export function completeTask(params: {
  readonly taskId: string;
  readonly agentId?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): {
  readonly completedTask: TaskQueueItem;
  readonly unblockedTasks: readonly TaskQueueItem[];
} {
  const queue = readTaskQueue(params.customPath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Task '${params.taskId}' not found in task queue`,
    );
  }

  const task = queue[index]!;
  if (task.status === "COMPLETED") {
    return { completedTask: task, unblockedTasks: [] };
  }

  if (params.leaseToken && task.lease && task.lease.token !== params.leaseToken) {
    throw new HarnessError(
      "INVALID_STATE",
      `Lease token mismatch for task '${task.id}'`,
    );
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

  writeTaskQueue(queue, params.customPath);

  return {
    completedTask,
    unblockedTasks,
  };
}

/**
 * Records a task failure, managing retries and blocking dependent tasks if permanently failed.
 */
export function failTask(params: {
  readonly taskId: string;
  readonly errorMessage: string;
  readonly agentId?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly canRetry?: boolean | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): {
  readonly task: TaskQueueItem;
  readonly retried: boolean;
  readonly affectedDependents: readonly string[];
} {
  const queue = readTaskQueue(params.customPath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Task '${params.taskId}' not found in task queue`,
    );
  }

  const task = queue[index]!;
  if (params.leaseToken && task.lease && task.lease.token !== params.leaseToken) {
    throw new HarnessError(
      "INVALID_STATE",
      `Lease token mismatch for task '${task.id}'`,
    );
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
    writeTaskQueue(queue, params.customPath);
    return {
      task: retriedTask,
      retried: true,
      affectedDependents: [],
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
    if (item.id === failedTask.id || item.status === "COMPLETED" || item.status === "FAILED") continue;

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

  writeTaskQueue(queue, params.customPath);

  return {
    task: failedTask,
    retried: false,
    affectedDependents,
  };
}

/**
 * Scans and reclaims expired leases across the task queue.
 */
export function reclaimExpiredLeases(params: {
  readonly customPath?: string | undefined;
  readonly nowMs?: number | undefined;
} = {}): {
  readonly reclaimedCount: number;
  readonly tasks: readonly TaskQueueItem[];
} {
  const queue = readTaskQueue(params.customPath);
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const reclaimedTasks: TaskQueueItem[] = [];
  let modified = false;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if (item.status === "IN_PROGRESS" && item.lease) {
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
    writeTaskQueue(queue, params.customPath);
  }

  return {
    reclaimedCount: reclaimedTasks.length,
    tasks: reclaimedTasks,
  };
}

/**
 * Computes queue statistics across all items.
 */
export function getQueueStats(customPathOrItems?: string | readonly TaskQueueItem[]): TaskQueueStats {
  const items = Array.isArray(customPathOrItems)
    ? customPathOrItems
    : readTaskQueue(typeof customPathOrItems === "string" ? customPathOrItems : undefined);

  const nowMs = Date.now();
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  let failed = 0;
  let blocked = 0;
  let activeLeases = 0;
  let expiredLeases = 0;

  for (const item of items) {
    switch (item.status) {
      case "PENDING":
        pending += 1;
        break;
      case "IN_PROGRESS":
        inProgress += 1;
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
    in_progress: inProgress,
    completed,
    failed,
    blocked,
    active_leases: activeLeases,
    expired_leases: expiredLeases,
  };
}

/**
 * Lists tasks from queue with optional filtering.
 */
export function listTaskQueue(options: {
  readonly status?: TaskQueueStatus | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly customPath?: string | undefined;
  readonly limit?: number | undefined;
} = {}): TaskQueueItem[] {
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
 * Prunes completed tasks from queue storage, returning count of removed items.
 */
export function pruneCompletedTasks(customPath?: string): {
  readonly prunedCount: number;
  readonly remainingCount: number;
} {
  const all = readTaskQueue(customPath);
  const remaining = all.filter((t) => t.status !== "COMPLETED");
  const prunedCount = all.length - remaining.length;

  if (prunedCount > 0) {
    writeTaskQueue(remaining, customPath);
  }

  return {
    prunedCount,
    remainingCount: remaining.length,
  };
}

function deserializeTaskQueueItem(raw: Record<string, unknown>): TaskQueueItem {
  const statusRaw = String(raw["status"] ?? "PENDING").toUpperCase();
  const status: TaskQueueStatus = TASK_QUEUE_STATUSES.includes(statusRaw as TaskQueueStatus)
    ? (statusRaw as TaskQueueStatus)
    : "PENDING";

  const priorityRaw = String(raw["priority"] ?? "MEDIUM").toUpperCase();
  const priority: TaskPriority = TASK_PRIORITIES.includes(priorityRaw as TaskPriority)
    ? (priorityRaw as TaskPriority)
    : "MEDIUM";

  const writeScope = Array.isArray(raw["write_scope"])
    ? raw["write_scope"].filter((s): s is string => typeof s === "string")
    : [];

  const charterGoals = Array.isArray(raw["charter_goals"])
    ? raw["charter_goals"].filter((g): g is string => typeof g === "string")
    : ["G1"];

  const acceptanceCriteria = Array.isArray(raw["acceptance_criteria"])
    ? raw["acceptance_criteria"].filter((c): c is string => typeof c === "string")
    : [];

  const dependencies = Array.isArray(raw["dependencies"])
    ? raw["dependencies"].filter((d): d is string => typeof d === "string")
    : [];

  const blockedBy = Array.isArray(raw["blocked_by"])
    ? raw["blocked_by"].filter((b): b is string => typeof b === "string")
    : [];

  let lease: TaskLease | null = null;
  if (raw["lease"] && typeof raw["lease"] === "object") {
    const l = raw["lease"] as Record<string, unknown>;
    if (typeof l["agent_id"] === "string" && typeof l["expires_at"] === "string") {
      lease = {
        agent_id: l["agent_id"],
        leased_at: typeof l["leased_at"] === "string" ? l["leased_at"] : new Date().toISOString(),
        expires_at: l["expires_at"],
        attempt: typeof l["attempt"] === "number" ? l["attempt"] : 1,
        lease_duration_seconds: typeof l["lease_duration_seconds"] === "number" ? l["lease_duration_seconds"] : DEFAULT_LEASE_DURATION_SECONDS,
        token: typeof l["token"] === "string" ? l["token"] : "unknown-token",
      };
    }
  }

  return {
    id: String(raw["id"]),
    title: typeof raw["title"] === "string" ? raw["title"] : `Task ${raw["id"]}`,
    description: typeof raw["description"] === "string" ? raw["description"] : "",
    priority,
    status,
    write_scope: writeScope,
    gate: typeof raw["gate"] === "string" ? raw["gate"] : "bun test tests/unit && bun run typecheck",
    charter_goals: charterGoals,
    acceptance_criteria: acceptanceCriteria,
    dependencies,
    blocked_by: blockedBy,
    lease,
    source_type: validateSourceType(raw["source_type"]),
    created_at: typeof raw["created_at"] === "string" ? raw["created_at"] : new Date().toISOString(),
    updated_at: typeof raw["updated_at"] === "string" ? raw["updated_at"] : new Date().toISOString(),
    started_at: typeof raw["started_at"] === "string" ? raw["started_at"] : null,
    completed_at: typeof raw["completed_at"] === "string" ? raw["completed_at"] : null,
    failed_at: typeof raw["failed_at"] === "string" ? raw["failed_at"] : null,
    retry_count: typeof raw["retry_count"] === "number" ? raw["retry_count"] : 0,
    max_retries: typeof raw["max_retries"] === "number" ? raw["max_retries"] : DEFAULT_MAX_RETRIES,
    error_message: typeof raw["error_message"] === "string" ? raw["error_message"] : null,
    metadata: typeof raw["metadata"] === "object" && raw["metadata"] !== null
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
      val === "blunder_remediation" ||
      val === "direct_prompt"
    ) {
      return val;
    }
  }
  return "direct_prompt";
}
