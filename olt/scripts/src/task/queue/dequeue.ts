import { randomBytes } from "node:crypto";
import {
  DEFAULT_LEASE_DURATION_SECONDS,
  PRIORITY_WEIGHTS,
  resolveTaskQueuePath,
  type TaskQueueItem,
} from "./types.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { withTaskQueueTransaction } from "./locks.ts";
import { readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";
import { pruneCompletedTasksUnlocked, reclaimExpiredLeasesUnlocked } from "./maintenance.ts";

export function assertSingleActiveLease(
  tasks: readonly TaskQueueItem[],
  agentId: string,
  nowMs = Date.now(),
): void {
  for (const task of tasks) {
    if (
      (task.status === "IN_PROGRESS" ||
        task.status === "RUNNING" ||
        task.status === "VALIDATING") &&
      task.lease &&
      task.lease.agent_id === agentId
    ) {
      const expMs = Date.parse(task.lease.expires_at);
      if (Number.isFinite(expMs) && expMs > nowMs) {
        throw new HarnessError(
          "INVALID_STATE",
          `Agent '${agentId}' already holds active lease on task '${task.id}'`,
        );
      }
    }
  }
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
  if (index === -1)
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  const task = queue[index]!;
  if (task.status === "COMPLETED")
    throw new HarnessError("INVALID_STATE", `Cannot admit task '${task.id}': already COMPLETED`);
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

export function admitTask(params: {
  readonly taskId: string;
  readonly admittedBy?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): TaskQueueItem {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => admitTaskUnlocked(params, p));
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
  if (index === -1)
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  const task = queue[index]!;
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  const nowIso = params.nowIso ?? new Date(nowMs).toISOString();

  if (task.status === "COMPLETED")
    throw new HarnessError("INVALID_STATE", `Cannot claim task '${task.id}': already COMPLETED`);
  if (task.status === "BLOCKED")
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot claim task '${task.id}': task is BLOCKED by [${task.blocked_by.join(", ")}]`,
    );
  if (task.status === "FAILED" || task.status === "ESCALATED") {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot claim task '${task.id}': task has status ${task.status} (${task.error_message ?? "no error note"})`,
    );
  }
  if ((task.status === "IN_PROGRESS" || task.status === "RUNNING") && task.lease) {
    const expiresMs = Date.parse(task.lease.expires_at);
    if (Number.isFinite(expiresMs) && expiresMs > nowMs && task.lease.agent_id !== params.agentId) {
      throw new HarnessError(
        "INVALID_STATE",
        `Task '${task.id}' is actively leased to agent '${task.lease.agent_id}' until ${task.lease.expires_at}`,
      );
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
  return { task: leasedTask, leaseToken: token };
}

export function claimTaskLease(params: {
  readonly taskId: string;
  readonly agentId: string;
  readonly durationSeconds?: number | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): { readonly task: TaskQueueItem; readonly leaseToken: string } {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => claimTaskLeaseUnlocked(params, p));
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
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const wDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
    if (wDiff !== 0) return wDiff;
    return a.created_at.localeCompare(b.created_at);
  });
  return claimTaskLeaseUnlocked(
    {
      taskId: eligible[0]!.id,
      agentId: params.agentId,
      durationSeconds: params.durationSeconds,
      nowIso: params.nowIso,
    },
    filePath,
  );
}

export function popNextEligibleTask(params: {
  readonly agentId: string;
  readonly durationSeconds?: number | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): { readonly task: TaskQueueItem; readonly leaseToken: string } | null {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => popNextEligibleTaskUnlocked(params, p));
}

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

export function dequeueTask(
  agentId: string,
  durationSeconds = DEFAULT_LEASE_DURATION_SECONDS,
  options?: { readonly customPath?: string | undefined; readonly nowIso?: string | undefined },
): TaskQueueItem | null {
  const filePath = resolveTaskQueuePath(options?.customPath);
  return withTaskQueueTransaction(filePath, () => {
    const queue = readTaskQueueFile(filePath);
    assertSingleActiveLease(queue, agentId);
    const popped = popNextEligibleTaskUnlocked(
      { agentId, durationSeconds, nowIso: options?.nowIso },
      filePath,
    );
    return popped ? popped.task : null;
  });
}

export function renewTaskLeaseUnlocked(
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
  if (index === -1)
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  const task = queue[index]!;
  if (!task.lease)
    throw new HarnessError("INVALID_STATE", `Task '${task.id}' does not have an active lease`);
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
    lease: { ...task.lease, expires_at: newExpiresAt, lease_duration_seconds: extSeconds },
    updated_at: nowIso,
  };
  queue[index] = renewedTask;
  writeTaskQueueUnlocked(queue, filePath);
  return renewedTask;
}

export function renewTaskLease(params: {
  readonly taskId: string;
  readonly agentId: string;
  readonly leaseToken: string;
  readonly extensionSeconds?: number | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): TaskQueueItem {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => renewTaskLeaseUnlocked(params, p));
}

export function releaseTaskLeaseUnlocked(
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
  if (index === -1)
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  const task = queue[index]!;
  if (task.lease) {
    if (params.leaseToken && task.lease.token !== params.leaseToken)
      throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
    if (task.lease.agent_id !== params.agentId)
      throw new HarnessError(
        "INVALID_STATE",
        `Agent '${params.agentId}' does not hold lease for task '${task.id}'`,
      );
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

export function releaseTaskLease(params: {
  readonly taskId: string;
  readonly agentId: string;
  readonly leaseToken?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): TaskQueueItem {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => releaseTaskLeaseUnlocked(params, p));
}

export function startTaskValidationUnlocked(
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
  if (index === -1)
    throw new HarnessError("INVALID_ARGUMENT", `Task '${params.taskId}' not found in task queue`);
  const task = queue[index]!;
  if (task.status === "COMPLETED")
    throw new HarnessError("INVALID_STATE", `Cannot validate task '${task.id}': already COMPLETED`);
  if (params.leaseToken && task.lease && task.lease.token !== params.leaseToken)
    throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
  if (params.agentId && task.lease && task.lease.agent_id !== params.agentId)
    throw new HarnessError(
      "INVALID_STATE",
      `Agent mismatch for task '${task.id}': leased to '${task.lease.agent_id}'`,
    );
  const nowIso = params.nowIso ?? new Date().toISOString();
  const validatingTask: TaskQueueItem = { ...task, status: "VALIDATING", updated_at: nowIso };
  queue[index] = validatingTask;
  writeTaskQueueUnlocked(queue, filePath);
  return validatingTask;
}

export function startTaskValidation(params: {
  readonly taskId: string;
  readonly agentId?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly customPath?: string | undefined;
  readonly nowIso?: string | undefined;
}): TaskQueueItem {
  const p = resolveTaskQueuePath(params.customPath);
  return withTaskQueueTransaction(p, () => startTaskValidationUnlocked(params, p));
}
