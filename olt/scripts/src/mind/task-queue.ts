import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/index.ts";
import {
  recordCompletedTask,
  recordCompletedTasksBatch,
  type CompletedTaskRecord,
} from "./completed-tasks.ts";

export type TaskQueueStatus =
  | "PENDING"
  | "ADMITTED"
  | "IN_PROGRESS"
  | "RUNNING"
  | "VALIDATING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "ESCALATED";

export const TASK_QUEUE_STATUSES: readonly TaskQueueStatus[] = [
  "PENDING",
  "ADMITTED",
  "IN_PROGRESS",
  "RUNNING",
  "VALIDATING",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "ESCALATED",
];

export type TaskPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND";

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
  | "defect_remediation"
  | "direct_prompt"
  | "plan_enhancement";

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
  readonly escalated_at?: string | null | undefined;
  readonly retry_count: number;
  readonly max_retries: number;
  readonly error_message?: string | null | undefined;
  readonly assigned_tier?: string | null | undefined;
  readonly assigned_role?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface NewTaskQueueInput {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly status?: TaskQueueStatus | undefined;
  readonly write_scope: readonly string[];
  readonly gate: string;
  readonly charter_goals?: readonly string[] | undefined;
  readonly acceptance_criteria?: readonly string[] | undefined;
  readonly dependencies?: readonly string[] | undefined;
  readonly source_type?: TaskSourceType | undefined;
  readonly max_retries?: number | undefined;
  readonly assigned_tier?: string | undefined;
  readonly assigned_role?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface TaskQueueStats {
  readonly total: number;
  readonly pending: number;
  readonly admitted: number;
  readonly in_progress: number;
  readonly running: number;
  readonly validating: number;
  readonly completed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly escalated: number;
  readonly active_leases: number;
  readonly expired_leases: number;
}

export const DEFAULT_TASK_QUEUE_FILE = ".olt/capsules/TASK_QUEUE.jsonl";

const DEFAULT_LEASE_DURATION_SECONDS = 1800; // 30 minutes
const DEFAULT_MAX_RETRIES = 3;

type TaskQueuePersistenceStage =
  | "before_write"
  | "before_fsync"
  | "before_rename"
  | "after_rename"
  | "before_directory_fsync";
let taskQueuePersistenceTestHook: ((stage: TaskQueuePersistenceStage) => void) | undefined;
const taskQueueLockSleep = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

/** @internal Narrow deterministic durability seam for unit tests. */
export function __setTaskQueuePersistenceTestHook(
  hook: ((stage: TaskQueuePersistenceStage) => void) | undefined,
): void {
  taskQueuePersistenceTestHook = hook;
}

function invokeTaskQueuePersistenceHook(stage: TaskQueuePersistenceStage): void {
  taskQueuePersistenceTestHook?.(stage);
}

/**
 * Resolves the canonical path for the task queue storage file.
 */
export function resolveCanonicalTaskQueuePath(customRoot?: string, _useTodo = false): string {
  return require("path").join(customRoot || process.cwd(), ".olt", "task-queue.jsonl");
}

/**
 * Resolves the absolute path to the task queue storage file, supporting canonical, todo, and legacy locations.
 */
export function resolveTaskQueuePath(customPath?: string): string {
  if (customPath && customPath.trim()) return require("path").resolve(customPath.trim());
  return require("path").join(process.cwd(), ".olt", "task-queue.jsonl");
}

/**
 * Migrates legacy task queue files to the canonical .capsules/mind/queue/ layout.
 */

/**
 * Reads and parses all task items from the task queue JSONL storage.
 */
export function readTaskQueue(customPath?: string): TaskQueueItem[] {
  const filePath = resolveTaskQueuePath(customPath);
  return readTaskQueueFile(filePath);
}

function readTaskQueueFile(filePath: string): TaskQueueItem[] {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(filePath);
    if (!before.isFile() || before.nlink !== 1) {
      throw new HarnessError("INTEGRITY", "task queue must be a single-link regular file");
    }
    descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new HarnessError("INTEGRITY", "task queue changed while being opened");
    }
    const raw = readFileSync(descriptor, "utf8");
    const after = lstatSync(filePath);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      !after.isFile() ||
      after.nlink !== 1
    ) {
      throw new HarnessError("INTEGRITY", "task queue changed while being read");
    }
    return parseTaskQueue(raw);
  } catch (error) {
    if (isOwnEnoent(error)) return [];
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("INTEGRITY", "could not securely read task queue");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseTaskQueue(raw: string): TaskQueueItem[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const items: TaskQueueItem[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      items.push(deserializeTaskQueueItem(parsed));
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError("INTEGRITY", `task queue line ${index + 1} is malformed`);
    }
  }

  return items;
}

/**
 * Writes task items atomically to the task queue storage.
 */
export function writeTaskQueue(items: readonly TaskQueueItem[], customPath?: string): void {
  const filePath = resolveTaskQueuePath(customPath);
  withTaskQueueTransaction(filePath, () => writeTaskQueueUnlocked(items, filePath));
}

function writeTaskQueueUnlocked(items: readonly TaskQueueItem[], filePath: string): void {
  const raw = serializeTaskQueue(items);
  atomicReplaceTaskQueue(filePath, raw);
}

function serializeTaskQueue(items: readonly TaskQueueItem[]): string {
  return (
    items
      .map((item) =>
        JSON.stringify(deserializeTaskQueueItem(item as unknown as Record<string, unknown>)),
      )
      .join("\n") + (items.length > 0 ? "\n" : "")
  );
}

/**
 * Clears all items in the task queue.
 */
export function clearTaskQueue(customPath?: string): void {
  const filePath = resolveTaskQueuePath(customPath);
  withTaskQueueTransaction(filePath, () => writeTaskQueueUnlocked([], filePath));
}

function isOwnEnoent(error: unknown): boolean {
  return isOwnCode(error, "ENOENT");
}

function isOwnCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor?.value === code;
}

function assertStableDirectory(path: string, descriptor: number, label: string): void {
  const before = lstatSync(path);
  const opened = fstatSync(descriptor);
  if (
    !before.isDirectory() ||
    !opened.isDirectory() ||
    before.dev !== opened.dev ||
    before.ino !== opened.ino
  ) {
    throw new HarnessError("INTEGRITY", `${label} directory changed while being opened`);
  }
}

function acquireTaskQueueFlock(descriptor: number, label: string): void {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (tryExclusiveFlock(descriptor)) return;
    Atomics.wait(taskQueueLockSleep, 0, 0, 5);
  }
  throw new HarnessError("LOCK_TIMEOUT", `${label} is already locked`);
}

/** Runs a queue mutation under stable repository and queue-parent inode locks. */
function withTaskQueueTransaction<T>(filePath: string, mutation: () => T): T {
  const parent = dirname(filePath);
  const parentRoot = dirname(parent);
  const root = parentRoot === parent || parentRoot === "/" ? parent : parentRoot;
  let rootFd: number | undefined;
  let parentFd: number | undefined;
  let rootLocked = false;
  let parentLocked = false;
  let primaryThrown = false;
  let primary: unknown;
  let result!: T;
  try {
    rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    assertStableDirectory(root, rootFd, "task queue root");
    acquireTaskQueueFlock(rootFd, "task queue root");
    rootLocked = true;
    assertStableDirectory(root, rootFd, "task queue root");
    try {
      mkdirSync(parent);
    } catch (error) {
      if (!isOwnCode(error, "EEXIST")) throw error;
    }
    assertStableDirectory(root, rootFd, "task queue root");
    parentFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    assertStableDirectory(parent, parentFd, "task queue parent");
    acquireTaskQueueFlock(parentFd, "task queue parent");
    parentLocked = true;
    assertStableDirectory(parent, parentFd, "task queue parent");
    result = mutation();
  } catch (error) {
    primaryThrown = true;
    primary = error;
  }

  let cleanupThrown = false;
  let cleanup: unknown;
  const attemptCleanup = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      if (!cleanupThrown) {
        cleanupThrown = true;
        cleanup = error;
      }
    }
  };
  if (parentLocked && parentFd !== undefined) attemptCleanup(() => releaseFlock(parentFd!));
  if (rootLocked && rootFd !== undefined) attemptCleanup(() => releaseFlock(rootFd!));
  if (parentFd !== undefined) attemptCleanup(() => closeSync(parentFd!));
  if (rootFd !== undefined) attemptCleanup(() => closeSync(rootFd!));
  if (primaryThrown) throw primary;
  if (cleanupThrown) throw cleanup;
  return result;
}

function atomicReplaceTaskQueue(filePath: string, raw: string): void {
  const parent = dirname(filePath);
  let previous: { readonly dev: number; readonly ino: number } | undefined;
  try {
    const existing = lstatSync(filePath);
    if (!existing.isFile() || existing.nlink !== 1) {
      throw new HarnessError("INTEGRITY", "task queue must be a single-link regular file");
    }
    previous = { dev: existing.dev, ino: existing.ino };
  } catch (error) {
    if (!isOwnEnoent(error)) throw error;
  }

  const temporary = join(
    parent,
    `.task-queue.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let tempFd: number | undefined;
  let dirFd: number | undefined;
  let renamed = false;
  try {
    tempFd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const bytes = Buffer.from(raw, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      invokeTaskQueuePersistenceHook("before_write");
      const written = writeSync(tempFd, bytes, offset, bytes.length - offset);
      if (written <= 0)
        throw new HarnessError("INTEGRITY", "could not completely write task queue");
      offset += written;
    }
    invokeTaskQueuePersistenceHook("before_fsync");
    fsyncSync(tempFd);
    closeSync(tempFd);
    tempFd = undefined;
    try {
      const current = lstatSync(filePath);
      if (
        !previous ||
        !current.isFile() ||
        current.nlink !== 1 ||
        current.dev !== previous.dev ||
        current.ino !== previous.ino
      ) {
        throw new HarnessError("INTEGRITY", "task queue changed before replacement");
      }
    } catch (error) {
      if (!(previous === undefined && isOwnEnoent(error))) throw error;
    }
    invokeTaskQueuePersistenceHook("before_rename");
    renameSync(temporary, filePath);
    renamed = true;
    invokeTaskQueuePersistenceHook("after_rename");
    dirFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    assertStableDirectory(parent, dirFd, "task queue parent");
    invokeTaskQueuePersistenceHook("before_directory_fsync");
    fsyncSync(dirFd);
  } catch (error) {
    if (renamed) {
      throw new HarnessError(
        "INTEGRITY",
        "task queue mutation outcome is uncertain and possibly committed after rename",
      );
    }
    throw error;
  } finally {
    if (tempFd !== undefined) closeSync(tempFd);
    if (dirFd !== undefined) closeSync(dirFd);
    if (!renamed) {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (!isOwnEnoent(error)) throw error;
      }
    }
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
export function enqueueTask(input: NewTaskQueueInput, customPath?: string): TaskQueueItem {
  const filePath = resolveTaskQueuePath(customPath);
  return withTaskQueueTransaction(filePath, () => enqueueTaskUnlocked(input, filePath));
}

function enqueueTaskUnlocked(input: NewTaskQueueInput, filePath: string): TaskQueueItem {
  const existing = readTaskQueueFile(filePath);
  const duplicate = existing.find((e) => e.id === input.id);
  if (duplicate) {
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

  // Compute unresolved dependencies
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
    started_at: null,
    completed_at: null,
    failed_at: null,
    escalated_at: null,
    retry_count: 0,
    max_retries: input.max_retries ?? DEFAULT_MAX_RETRIES,
    error_message: null,
    assigned_tier: input.assigned_tier ?? null,
    assigned_role: input.assigned_role ?? null,
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

/**
 * Enqueues a batch of tasks, validating and wiring dependencies across the batch.
 */
export function enqueueTasksBatch(
  inputs: readonly NewTaskQueueInput[],
  customPath?: string,
): readonly TaskQueueItem[] {
  const filePath = resolveTaskQueuePath(customPath);
  return withTaskQueueTransaction(filePath, () => enqueueTasksBatchUnlocked(inputs, filePath));
}

function enqueueTasksBatchUnlocked(
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
      started_at: null,
      completed_at: null,
      failed_at: null,
      escalated_at: null,
      retry_count: 0,
      max_retries: input.max_retries ?? DEFAULT_MAX_RETRIES,
      error_message: null,
      assigned_tier: input.assigned_tier ?? null,
      assigned_role: input.assigned_role ?? null,
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

/**
 * Explicitly admits a pending task into the admitted execution queue.
 */
export function admitTask(params: {
  readonly taskId: string;
  readonly admittedBy?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): TaskQueueItem {
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => admitTaskUnlocked(params, filePath));
}

function admitTaskUnlocked(
  params: {
    readonly taskId: string;
    readonly admittedBy?: string | undefined;
    readonly nowIso?: string | undefined;
  },
  filePath: string,
): TaskQueueItem {
  const queue = readTaskQueueFile(filePath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  }

  const task = queue[index]!;
  if (task.status === "COMPLETED") {
    throw new HarnessError("INVALID_STATE", `Cannot admit task '${task.id}': already COMPLETED`);
  }
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
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => claimTaskLeaseUnlocked(params, filePath));
}

function claimTaskLeaseUnlocked(
  params: {
    readonly taskId: string;
    readonly agentId: string;
    readonly durationSeconds?: number | undefined;
    readonly nowIso?: string | undefined;
  },
  filePath: string,
): { readonly task: TaskQueueItem; readonly leaseToken: string } {
  const queue = readTaskQueueFile(filePath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  }

  const task = queue[index]!;
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  const nowIso = params.nowIso ?? new Date(nowMs).toISOString();

  if (task.status === "COMPLETED") {
    throw new HarnessError("INVALID_STATE", `Cannot claim task '${task.id}': already COMPLETED`);
  }

  if (task.status === "BLOCKED") {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot claim task '${task.id}': task is BLOCKED by [${task.blocked_by.join(", ")}]`,
    );
  }

  if (task.status === "FAILED" || task.status === "ESCALATED") {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot claim task '${task.id}': task has status ${task.status} (${task.error_message ?? "no error note"})`,
    );
  }

  if ((task.status === "IN_PROGRESS" || task.status === "RUNNING") && task.lease) {
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
  writeTaskQueueUnlocked(queue, filePath);

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
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => popNextEligibleTaskUnlocked(params, filePath));
}

function popNextEligibleTaskUnlocked(
  params: {
    readonly agentId: string;
    readonly durationSeconds?: number | undefined;
    readonly nowIso?: string | undefined;
  },
  filePath: string,
): { readonly task: TaskQueueItem; readonly leaseToken: string } | null {
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  reclaimExpiredLeasesUnlocked({ nowMs }, filePath);

  const queue = readTaskQueueFile(filePath);
  const eligible = queue.filter((t) => {
    if (t.status !== "PENDING" && t.status !== "ADMITTED") return false;
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
  return claimTaskLeaseUnlocked(
    {
      taskId: selected.id,
      agentId: params.agentId,
      durationSeconds: params.durationSeconds,
      nowIso: params.nowIso,
    },
    filePath,
  );
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
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => renewTaskLeaseUnlocked(params, filePath));
}

function renewTaskLeaseUnlocked(
  params: {
    readonly taskId: string;
    readonly agentId: string;
    readonly leaseToken: string;
    readonly extensionSeconds?: number | undefined;
    readonly nowIso?: string | undefined;
  },
  filePath: string,
): TaskQueueItem {
  const queue = readTaskQueueFile(filePath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  }

  const task = queue[index]!;
  if (!task.lease) {
    throw new HarnessError("INVALID_STATE", `Task '${task.id}' does not have an active lease`);
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
  writeTaskQueueUnlocked(queue, filePath);
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
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => releaseTaskLeaseUnlocked(params, filePath));
}

function releaseTaskLeaseUnlocked(
  params: {
    readonly taskId: string;
    readonly agentId: string;
    readonly leaseToken?: string | undefined;
    readonly nowIso?: string | undefined;
  },
  filePath: string,
): TaskQueueItem {
  const queue = readTaskQueueFile(filePath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  }

  const task = queue[index]!;
  if (task.lease) {
    if (params.leaseToken && task.lease.token !== params.leaseToken) {
      throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
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
  writeTaskQueueUnlocked(queue, filePath);
  return releasedTask;
}

/**
 * Transitions an in-progress or running task to VALIDATING state for verification.
 */
export function startTaskValidation(params: {
  readonly taskId: string;
  readonly agentId?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): TaskQueueItem {
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => startTaskValidationUnlocked(params, filePath));
}

function startTaskValidationUnlocked(
  params: {
    readonly taskId: string;
    readonly agentId?: string | undefined;
    readonly leaseToken?: string | undefined;
    readonly nowIso?: string | undefined;
  },
  filePath: string,
): TaskQueueItem {
  const queue = readTaskQueueFile(filePath);
  const index = queue.findIndex((t) => t.id === params.taskId);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  }

  const task = queue[index]!;
  if (task.status === "COMPLETED") {
    throw new HarnessError("INVALID_STATE", `Cannot validate task '${task.id}': already COMPLETED`);
  }

  if (params.leaseToken && task.lease && task.lease.token !== params.leaseToken) {
    throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
  }

  if (params.agentId && task.lease && task.lease.agent_id !== params.agentId) {
    throw new HarnessError(
      "INVALID_STATE",
      `Agent mismatch for task '${task.id}': leased to '${task.lease.agent_id}'`,
    );
  }

  const nowIso = params.nowIso ?? new Date().toISOString();
  const validatingTask: TaskQueueItem = {
    ...task,
    status: "VALIDATING",
    updated_at: nowIso,
  };

  queue[index] = validatingTask;
  writeTaskQueueUnlocked(queue, filePath);
  return validatingTask;
}

/**
 * Marks a task as COMPLETED, clears lease, unblocks dependent tasks, and optionally archives record.
 */
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

function completeTaskUnlocked(
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

function escalateTaskUnlocked(
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

function failTaskUnlocked(
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

function reclaimExpiredLeasesUnlocked(
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

function pruneCompletedTasksUnlocked(
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
    } catch {
      // Non-fatal if ledger path is not configured
    }
  }

  if (prunedCount > 0) {
    writeTaskQueueUnlocked(remaining, filePath);
  }

  return {
    prunedCount,
    remainingCount: remaining.length,
    archivedCount,
  };
}

/**
 * Pops the next eligible task from the queue and cleans up completed tasks atomically.
 */
export function popNextEligibleTaskWithCleanup(params: {
  readonly agentId: string;
  readonly durationSeconds?: number | undefined;
  readonly customPath?: string | undefined;
  readonly completedTasksPath?: string | undefined;
  readonly nowIso?: string | undefined;
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
      { agentId: params.agentId, durationSeconds: params.durationSeconds, nowIso: params.nowIso },
      filePath,
    );
    return popped ? { ...popped, prunedCount: pruneRes.prunedCount } : null;
  });
}

function deserializeTaskQueueItem(raw: Record<string, unknown>): TaskQueueItem {
  const requiredString = (key: string): string => {
    const value = raw[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new HarnessError("INTEGRITY", `task queue record has invalid ${key}`);
    }
    return value;
  };
  const stringArray = (key: string, nonEmpty = false): string[] => {
    const value = raw[key];
    if (
      !Array.isArray(value) ||
      (nonEmpty && value.length === 0) ||
      !value.every((entry) => typeof entry === "string" && entry.trim())
    ) {
      throw new HarnessError("INTEGRITY", `task queue record has invalid ${key}`);
    }
    return [...value];
  };
  const id = requiredString("id");
  const status = requiredString("status") as TaskQueueStatus;
  const priority = requiredString("priority") as TaskPriority;
  if (!TASK_QUEUE_STATUSES.includes(status) || !TASK_PRIORITIES.includes(priority)) {
    throw new HarnessError("INTEGRITY", `task queue record has invalid status or priority`);
  }
  const sourceType = validateSourceType(raw["source_type"]);
  if (raw["source_type"] !== sourceType) {
    throw new HarnessError("INTEGRITY", "task queue record has invalid source_type");
  }
  const retryCount = raw["retry_count"];
  const maxRetries = raw["max_retries"];
  if (
    typeof retryCount !== "number" ||
    !Number.isSafeInteger(retryCount) ||
    retryCount < 0 ||
    typeof maxRetries !== "number" ||
    !Number.isSafeInteger(maxRetries) ||
    maxRetries < 0
  ) {
    throw new HarnessError("INTEGRITY", "task queue record has invalid retry counters");
  }
  let lease: TaskLease | null = null;
  if (raw["lease"] !== null && raw["lease"] !== undefined) {
    const value = raw["lease"];
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new HarnessError("INTEGRITY", "task queue record has invalid lease");
    }
    const rawLease = value as Record<string, unknown>;
    const agentId = rawLease.agent_id;
    const token = rawLease.token;
    const leasedAt = rawLease.leased_at;
    const expiresAt = rawLease.expires_at;
    const attempt = rawLease.attempt;
    const duration = rawLease.lease_duration_seconds;
    if (
      typeof agentId !== "string" ||
      !agentId.trim() ||
      typeof token !== "string" ||
      !token.trim() ||
      typeof leasedAt !== "string" ||
      !Number.isFinite(Date.parse(leasedAt)) ||
      typeof expiresAt !== "string" ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      typeof attempt !== "number" ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1 ||
      typeof duration !== "number" ||
      !Number.isSafeInteger(duration) ||
      duration < 1
    )
      throw new HarnessError("INTEGRITY", "task queue record has invalid lease");
    lease = {
      agent_id: agentId,
      token,
      leased_at: leasedAt,
      expires_at: expiresAt,
      attempt,
      lease_duration_seconds: duration,
    };
  }
  const createdAt = requiredString("created_at");
  const updatedAt = requiredString("updated_at");
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
    throw new HarnessError("INTEGRITY", "task queue record has invalid timestamps");
  }
  return {
    id,
    title: requiredString("title"),
    description: requiredString("description"),
    priority,
    status,
    write_scope: stringArray("write_scope", true),
    gate: requiredString("gate"),
    charter_goals: stringArray("charter_goals", true),
    acceptance_criteria: stringArray("acceptance_criteria"),
    dependencies: stringArray("dependencies"),
    blocked_by: stringArray("blocked_by"),
    lease,
    source_type: sourceType,
    created_at: createdAt,
    updated_at: updatedAt,
    started_at: typeof raw["started_at"] === "string" ? raw["started_at"] : null,
    completed_at: typeof raw["completed_at"] === "string" ? raw["completed_at"] : null,
    failed_at: typeof raw["failed_at"] === "string" ? raw["failed_at"] : null,
    escalated_at: typeof raw["escalated_at"] === "string" ? raw["escalated_at"] : null,
    retry_count: retryCount,
    max_retries: maxRetries,
    error_message: typeof raw["error_message"] === "string" ? raw["error_message"] : null,
    assigned_tier: typeof raw["assigned_tier"] === "string" ? raw["assigned_tier"] : null,
    assigned_role: typeof raw["assigned_role"] === "string" ? raw["assigned_role"] : null,
    metadata:
      typeof raw["metadata"] === "object" &&
      raw["metadata"] !== null &&
      !Array.isArray(raw["metadata"])
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
      val === "defect_remediation" ||
      val === "direct_prompt" ||
      val === "plan_enhancement"
    ) {
      return val;
    }
  }
  throw new HarnessError("INTEGRITY", "task queue record has invalid source_type");
}
