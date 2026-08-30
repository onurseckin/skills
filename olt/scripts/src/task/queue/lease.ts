import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { withTaskQueueTransaction } from "./locks.ts";
import { readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";
import {
  DEFAULT_LEASE_DURATION_SECONDS,
  resolveTaskQueuePath,
  type CompletionReceipts,
  type TaskQueueItem,
} from "./types.ts";
import { assertSingleActiveLease } from "./dequeue.ts";

function findTask(
  queue: readonly TaskQueueItem[],
  taskId: string,
): { readonly task: TaskQueueItem; readonly index: number } {
  const index = queue.findIndex((t) => t.id === taskId);
  if (index === -1)
    throw new HarnessError("INVALID_ARGUMENT", `Task '${taskId}' not found in task queue`);
  return { task: queue[index]!, index };
}

export function assertValidActiveLease(task: TaskQueueItem, expectedToken?: string): void {
  if (!task.lease)
    throw new HarnessError("INVALID_STATE", `Task '${task.id}' does not have an active lease`);
  if (expectedToken && task.lease.token !== expectedToken) {
    throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
  }
  const expMs = Date.parse(task.lease.expires_at);
  if (Number.isFinite(expMs) && expMs <= Date.now()) {
    throw new HarnessError("INVALID_STATE", `Lease expired for task '${task.id}'`);
  }
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
      if (content.includes("/*") || content.includes("//")) {
        throw new HarnessError("INTEGRITY", `AST purity invariant violated in ${relPath}`);
      }
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

export function claimTaskLeaseUnlocked(
  params: {
    readonly taskId: string;
    readonly agentId: string;
    readonly durationSeconds?: number;
    readonly nowIso?: string;
  },
  filePath: string,
): { readonly task: TaskQueueItem; readonly leaseToken: string } {
  const queue = readTaskQueueFile(filePath);
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  assertSingleActiveLease(queue, params.agentId, nowMs);
  const { task, index } = findTask(queue, params.taskId);
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
    const exp = Date.parse(task.lease.expires_at);
    if (Number.isFinite(exp) && exp > nowMs && task.lease.agent_id !== params.agentId) {
      throw new HarnessError(
        "INVALID_STATE",
        `Task '${task.id}' is actively leased to agent '${task.lease.agent_id}' until ${task.lease.expires_at}`,
      );
    }
  }

  const durationSec = params.durationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS;
  const token = `lease-${randomBytes(12).toString("hex")}`;
  const leasedTask: TaskQueueItem = {
    ...task,
    status: "IN_PROGRESS",
    lease: {
      agent_id: params.agentId,
      leased_at: nowIso,
      expires_at: new Date(nowMs + durationSec * 1000).toISOString(),
      attempt: (task.lease?.attempt ?? 0) + 1,
      lease_duration_seconds: durationSec,
      token,
    },
    started_at: task.started_at ?? nowIso,
    updated_at: nowIso,
  };
  queue[index] = leasedTask;
  writeTaskQueueUnlocked(queue, filePath);
  return { task: leasedTask, leaseToken: token };
}

export function claimTaskLease(params: {
  readonly taskId: string;
  readonly agentId: string;
  readonly durationSeconds?: number;
  readonly customPath?: string;
  readonly nowIso?: string;
}): { readonly task: TaskQueueItem; readonly leaseToken: string } {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => claimTaskLeaseUnlocked(params, p));
}

export function renewTaskLeaseUnlocked(
  params: {
    readonly taskId: string;
    readonly agentId: string;
    readonly leaseToken: string;
    readonly extensionSeconds?: number;
    readonly nowIso?: string;
  },
  filePath: string,
): TaskQueueItem {
  const queue = readTaskQueueFile(filePath);
  const { task, index } = findTask(queue, params.taskId);
  if (!task.lease)
    throw new HarnessError("INVALID_STATE", `Task '${task.id}' does not have an active lease`);
  if (task.lease.token !== params.leaseToken || task.lease.agent_id !== params.agentId) {
    throw new HarnessError(
      "INVALID_STATE",
      `Invalid lease token or agent mismatch for task '${task.id}'`,
    );
  }
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  const extSeconds = params.extensionSeconds ?? DEFAULT_LEASE_DURATION_SECONDS;
  const renewedTask: TaskQueueItem = {
    ...task,
    lease: {
      ...task.lease,
      expires_at: new Date(nowMs + extSeconds * 1000).toISOString(),
      lease_duration_seconds: extSeconds,
    },
    updated_at: params.nowIso ?? new Date(nowMs).toISOString(),
  };
  queue[index] = renewedTask;
  writeTaskQueueUnlocked(queue, filePath);
  return renewedTask;
}

export function renewTaskLease(params: {
  readonly taskId: string;
  readonly agentId: string;
  readonly leaseToken: string;
  readonly extensionSeconds?: number;
  readonly customPath?: string;
  readonly nowIso?: string;
}): TaskQueueItem {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => renewTaskLeaseUnlocked(params, p));
}

export function releaseTaskLeaseUnlocked(
  params: {
    readonly taskId: string;
    readonly agentId: string;
    readonly leaseToken?: string;
    readonly nowIso?: string;
  },
  filePath: string,
): TaskQueueItem {
  const queue = readTaskQueueFile(filePath);
  const { task, index } = findTask(queue, params.taskId);
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
  const releasedTask: TaskQueueItem = {
    ...task,
    status: "PENDING",
    lease: null,
    updated_at: params.nowIso ?? new Date().toISOString(),
  };
  queue[index] = releasedTask;
  writeTaskQueueUnlocked(queue, filePath);
  return releasedTask;
}

export function releaseTaskLease(params: {
  readonly taskId: string;
  readonly agentId: string;
  readonly leaseToken?: string;
  readonly customPath?: string;
  readonly nowIso?: string;
}): TaskQueueItem {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => releaseTaskLeaseUnlocked(params, p));
}

export function startTaskValidationUnlocked(
  params: {
    readonly taskId: string;
    readonly agentId?: string;
    readonly leaseToken?: string;
    readonly nowIso?: string;
  },
  filePath: string,
): TaskQueueItem {
  const queue = readTaskQueueFile(filePath);
  const { task, index } = findTask(queue, params.taskId);
  if (task.status === "COMPLETED")
    throw new HarnessError("INVALID_STATE", `Cannot validate task '${task.id}': already COMPLETED`);
  if (params.leaseToken && task.lease && task.lease.token !== params.leaseToken) {
    throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
  }
  if (params.agentId && task.lease && task.lease.agent_id !== params.agentId) {
    throw new HarnessError(
      "INVALID_STATE",
      `Agent mismatch for task '${task.id}': leased to '${task.lease.agent_id}'`,
    );
  }
  const validatingTask: TaskQueueItem = {
    ...task,
    status: "VALIDATING",
    updated_at: params.nowIso ?? new Date().toISOString(),
  };
  queue[index] = validatingTask;
  writeTaskQueueUnlocked(queue, filePath);
  return validatingTask;
}

export function startTaskValidation(params: {
  readonly taskId: string;
  readonly agentId?: string;
  readonly leaseToken?: string;
  readonly customPath?: string;
  readonly nowIso?: string;
}): TaskQueueItem {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => startTaskValidationUnlocked(params, p));
}
