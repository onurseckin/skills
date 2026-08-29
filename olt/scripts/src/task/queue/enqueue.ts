import {
  DEFAULT_MAX_RETRIES,
  resolveTaskQueuePath,
  type TaskQueueItem,
  type NewTaskQueueInput,
  type TaskQueueStatus,
} from "./types.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { withTaskQueueTransaction } from "./locks.ts";
import { readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";

export function validateTaskQueueDag(items: readonly TaskQueueItem[]): {
  readonly ok: boolean;
  readonly cycles: readonly (readonly string[])[];
} {
  const itemMap = new Map<string, TaskQueueItem>();
  for (const item of items) itemMap.set(item.id, item);

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
          if (itemMap.has(depId)) dfs(depId);
        } else if (recStack.has(depId)) {
          const cycleStart = path.indexOf(depId);
          if (cycleStart !== -1) cycles.push([...path.slice(cycleStart), depId]);
        }
      }
    }

    path.pop();
    recStack.delete(nodeId);
  }

  for (const item of items) {
    if (!visited.has(item.id)) dfs(item.id);
  }

  return { ok: cycles.length === 0, cycles };
}

export function enqueueTaskUnlocked(input: NewTaskQueueInput, filePath: string): TaskQueueItem {
  const existing = readTaskQueueFile(filePath);
  if (existing.some((e) => e.id === input.id)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Task with id '${input.id}' already exists in the queue`,
    );
  }

  const rawDeps = input.dependencies ?? [];
  if (rawDeps.includes(input.id)) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${input.id}' cannot depend on itself`);
  }

  const nowIso = new Date().toISOString();
  const completedIds = new Set(existing.filter((t) => t.status === "COMPLETED").map((t) => t.id));
  const blockedBy = rawDeps.filter((depId) => !completedIds.has(depId));
  const initialStatus: TaskQueueStatus =
    typeof input.status === "string" ? input.status : blockedBy.length > 0 ? "BLOCKED" : "PENDING";

  const newItem: TaskQueueItem = {
    id: input.id.trim(),
    title: input.title.trim(),
    description: input.description?.trim() ?? input.title.trim(),
    priority: typeof input.priority === "string" ? input.priority : "MEDIUM",
    status: initialStatus,
    write_scope: [...input.write_scope],
    gate: input.gate.trim(),
    charter_goals:
      input.charter_goals && input.charter_goals.length > 0 ? [...input.charter_goals] : ["G1"],
    acceptance_criteria: input.acceptance_criteria ? [...input.acceptance_criteria] : [],
    dependencies: [...rawDeps],
    blocked_by: blockedBy,
    lease: null,
    source_type: typeof input.source_type === "string" ? input.source_type : "direct_prompt",
    created_at: nowIso,
    updated_at: nowIso,
    started_at: undefined,
    completed_at: undefined,
    failed_at: undefined,
    escalated_at: undefined,
    retry_count: 0,
    max_retries: input.max_retries ?? DEFAULT_MAX_RETRIES,
    error_message: undefined,
    assigned_tier: input.assigned_tier ?? undefined,
    assigned_role: input.assigned_role ?? undefined,
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

  writeTaskQueueUnlocked(updatedQueue, filePath);
  return newItem;
}

export function enqueueTask(input: NewTaskQueueInput, customPath?: string): TaskQueueItem {
  const filePath = resolveTaskQueuePath(customPath);
  return withTaskQueueTransaction(filePath, () => enqueueTaskUnlocked(input, filePath));
}

export function enqueueTasksBatchUnlocked(
  inputs: readonly NewTaskQueueInput[],
  filePath: string,
): readonly TaskQueueItem[] {
  const existing = readTaskQueueFile(filePath);
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
  const completedIds = new Set(existing.filter((t) => t.status === "COMPLETED").map((t) => t.id));

  const newItems: TaskQueueItem[] = [];
  for (const input of inputs) {
    const rawDeps = input.dependencies ?? [];
    if (rawDeps.includes(input.id)) {
      throw new HarnessError("INVALID_ARGUMENT", `Task '${input.id}' cannot depend on itself`);
    }

    const blockedBy = rawDeps.filter((depId) => !completedIds.has(depId));
    const initialStatus: TaskQueueStatus =
      typeof input.status === "string"
        ? input.status
        : blockedBy.length > 0
          ? "BLOCKED"
          : "PENDING";

    newItems.push({
      id: input.id.trim(),
      title: input.title.trim(),
      description: input.description?.trim() ?? input.title.trim(),
      priority: typeof input.priority === "string" ? input.priority : "MEDIUM",
      status: initialStatus,
      write_scope: [...input.write_scope],
      gate: input.gate.trim(),
      charter_goals:
        input.charter_goals && input.charter_goals.length > 0 ? [...input.charter_goals] : ["G1"],
      acceptance_criteria: input.acceptance_criteria ? [...input.acceptance_criteria] : [],
      dependencies: [...rawDeps],
      blocked_by: blockedBy,
      lease: null,
      source_type: typeof input.source_type === "string" ? input.source_type : "direct_prompt",
      created_at: nowIso,
      updated_at: nowIso,
      started_at: undefined,
      completed_at: undefined,
      failed_at: undefined,
      escalated_at: undefined,
      retry_count: 0,
      max_retries: input.max_retries ?? DEFAULT_MAX_RETRIES,
      error_message: undefined,
      assigned_tier: input.assigned_tier ?? undefined,
      assigned_role: input.assigned_role ?? undefined,
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

  writeTaskQueueUnlocked(updatedQueue, filePath);
  return newItems;
}

export function enqueueTasksBatch(
  inputs: readonly NewTaskQueueInput[],
  customPath?: string,
): readonly TaskQueueItem[] {
  const filePath = resolveTaskQueuePath(customPath);
  return withTaskQueueTransaction(filePath, () => enqueueTasksBatchUnlocked(inputs, filePath));
}
