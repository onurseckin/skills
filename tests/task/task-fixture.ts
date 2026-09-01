/**
 * @file task-fixture.ts
 * In-memory test sandbox fixture and pure RAM task queue harness for tests/task domain
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CompletionReceipts,
  NewTaskQueueInput,
  TaskLease,
  TaskQueueItem,
  TaskQueueStats,
} from "../../olt/scripts/src/task/queue/index.ts";

const SCRATCH_BASE = join(tmpdir(), "task-scratch");
const rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  rootsToClean.length = 0;
});

function slug(value: string): string {
  const cleaned = value
    .replace(/\.+/g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = cleaned.slice(0, 20).replace(/-+$/, "");
  return trimmed.length > 0 ? trimmed : "root";
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

let counter = 0;

/**
 * Creates an isolated scratch sandbox directory for testing task queues.
 * Automatically registered for cleanup in afterEach hooks.
 */
export function scratchRoot(callerPath = "task-test", label = "test"): string {
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = join(SCRATCH_BASE, dirName);

  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}

  mkdirSync(root, { recursive: true });
  rootsToClean.push(root);
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

export function createInMemoryTaskItem(overrides: Partial<TaskQueueItem> = {}): TaskQueueItem {
  return {
    taskId: "task-in-memory-01",
    role: "implementer",
    priority: "high",
    status: "ready",
    effort: 2,
    retries: 0,
    maxRetries: 3,
    blockedBy: [],
    dependents: [],
    history: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function createInMemoryTaskLease(overrides: Partial<TaskLease> = {}): TaskLease {
  return {
    leaseId: "lease-in-memory-01",
    holder: "implementer_1",
    expiresAt: "2026-01-01T01:00:00.000Z",
    ...overrides,
  };
}

export function createInMemoryCompletionReceipts(
  overrides: Partial<CompletionReceipts> = {},
): CompletionReceipts {
  return {
    verifiedCommit: "commit-in-memory-01",
    verificationSummary: "Verified in memory with zero disk mutations",
    validatorVerdict: "passed",
    artifactsArchive: "memory/receipts/task-in-memory-01.json",
    ...overrides,
  };
}

export class InMemoryTaskQueue {
  private readonly items: Map<string, TaskQueueItem> = new Map();

  public enqueue(input: NewTaskQueueInput): TaskQueueItem {
    const item = createInMemoryTaskItem({
      taskId: input.taskId,
      role: input.role,
      priority: input.priority,
      effort: input.effort,
      blockedBy: input.blockedBy ?? [],
      metadata: input.metadata ?? {},
    });
    this.items.set(item.taskId, item);
    return item;
  }

  public get(taskId: string): TaskQueueItem | undefined {
    const item = this.items.get(taskId);
    return item ? { ...item } : undefined;
  }

  public list(): readonly TaskQueueItem[] {
    return Array.from(this.items.values()).map((item) => ({ ...item }));
  }

  public claim(taskId: string, holder: string): TaskQueueItem | null {
    const item = this.items.get(taskId);
    if (!item || item.status !== "ready") return null;
    item.status = "claimed";
    item.assignedTo = holder;
    item.lease = createInMemoryTaskLease({ holder });
    item.updatedAt = new Date().toISOString();
    return { ...item };
  }

  public complete(taskId: string): TaskQueueItem | null {
    const item = this.items.get(taskId);
    if (!item || item.status !== "claimed") return null;
    item.status = "completed";
    item.lease = undefined;
    item.updatedAt = new Date().toISOString();
    return { ...item };
  }

  public fail(taskId: string): TaskQueueItem | null {
    const item = this.items.get(taskId);
    if (!item || item.status !== "claimed") return null;
    item.retries += 1;
    item.status = item.retries >= item.maxRetries ? "failed" : "ready";
    item.lease = undefined;
    item.updatedAt = new Date().toISOString();
    return { ...item };
  }

  public getStats(): TaskQueueStats {
    let ready = 0;
    let claimed = 0;
    let completed = 0;
    let failed = 0;
    let suspended = 0;

    for (const item of this.items.values()) {
      if (item.status === "ready") ready += 1;
      else if (item.status === "claimed") claimed += 1;
      else if (item.status === "completed") completed += 1;
      else if (item.status === "failed") failed += 1;
      else if (item.status === "suspended") suspended += 1;
    }

    return {
      total: this.items.size,
      ready,
      claimed,
      completed,
      failed,
      suspended,
    };
  }

  public clear(): void {
    this.items.clear();
  }
}

export function createInMemoryTaskQueue(): InMemoryTaskQueue {
  return new InMemoryTaskQueue();
}
