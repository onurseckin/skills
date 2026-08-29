import {
  DEFAULT_LEASE_DURATION_SECONDS,
  resolveTaskQueuePath,
  type TaskQueueItem,
} from "./types.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { withTaskQueueTransaction, readTaskQueueFile, writeTaskQueueUnlocked } from "./storage.ts";
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
