import { randomBytes } from "node:crypto";
import {
  DEFAULT_LEASE_DURATION_SECONDS,
  PRIORITY_WEIGHTS,
  resolveTaskQueuePath,
  type TaskQueueItem,
  type TaskLease,
} from "./types.ts";
import { reclaimExpiredLeasesUnlocked } from "./stats.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { withTaskQueueTransaction, readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";
export function admitTask(params: {
  readonly taskId: string;
  readonly admittedBy?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): TaskQueueItem {
  const filePath = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(filePath, () => admitTaskUnlocked(params, filePath));
}

export function admitTaskUnlocked(
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

export function claimTaskLeaseUnlocked(
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

export function popNextEligibleTaskUnlocked(
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
