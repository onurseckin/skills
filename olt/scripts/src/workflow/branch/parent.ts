import type { BranchRecord, BranchSubTask } from "../../core/contracts/index.ts";
import { isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { isLeaseSuspended, restoreLease, suspendLease } from "../lease/suspension.ts";
import { tokenMatches } from "../lease/token.ts";
import { transition } from "../task-state.ts";
import type { TaskRecord } from "../types.ts";
import { locateSubTask } from "./ledger.ts";

export type BranchParent =
  | { kind: "task"; id: string; task: TaskRecord; writeScope: string[]; depth: number }
  | {
      kind: "sub_task";
      id: string;
      branch: BranchRecord;
      subTask: BranchSubTask;
      writeScope: string[];
      depth: number;
    };

function isTaskRecord(value: unknown): value is TaskRecord {
  if (!isJsonObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.write_scope) &&
    Array.isArray(value.history) &&
    Array.isArray(value.attempts)
  );
}

function planTask(draft: JsonObject, taskId: string): TaskRecord | undefined {
  const tasks = draft.tasks;
  if (!isJsonObject(tasks)) return undefined;
  const task = tasks[taskId];
  if (task === undefined) return undefined;
  if (!isTaskRecord(task)) {
    throw new HarnessError("INTEGRITY", `state.tasks.${taskId} is not a task record`);
  }
  return task;
}

export function resolveBranchParent(
  draft: JsonObject,
  ledger: readonly BranchRecord[],
  parentId: string,
): BranchParent {
  const task = planTask(draft, parentId);
  if (task) {
    return {
      kind: "task",
      id: parentId,
      task,
      writeScope: task.write_scope.filter((entry) => typeof entry === "string"),
      depth: 0,
    };
  }
  const located = locateSubTask(ledger, parentId);
  if (!located) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `unknown parent ${parentId}: it is neither a plan task nor a branch sub-task`,
    );
  }
  return {
    kind: "sub_task",
    id: parentId,
    branch: located.branch,
    subTask: located.subTask,
    writeScope: [...located.subTask.write_scope],
    depth: located.branch.depth,
  };
}

function parentLease(parent: BranchParent): JsonObject {
  const lease = parent.kind === "task" ? parent.task.lease : parent.subTask.lease;
  if (!isJsonObject(lease)) {
    throw new HarnessError("INVALID_STATE", `${parent.id} holds no lease`);
  }
  return lease;
}

export function assertParentLease(
  parent: BranchParent,
  agentId: string,
  token: string,
  now: Date,
): JsonObject {
  const lease = parentLease(parent);
  const digest = lease.token_digest;
  if (typeof digest !== "string" || lease.agent_id !== agentId || !tokenMatches(token, digest)) {
    throw new HarnessError("INVALID_STATE", "lease identity or token is invalid");
  }
  if (!isLeaseSuspended(lease)) {
    const expiresAt = typeof lease.expires_at === "string" ? Date.parse(lease.expires_at) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= now.valueOf()) {
      throw new HarnessError("INVALID_STATE", "lease has expired");
    }
  }
  return lease;
}

export function assertParentWorking(parent: BranchParent): void {
  if (parent.kind === "task") {
    if (!["leased", "running"].includes(parent.task.status)) {
      throw new HarnessError(
        "INVALID_STATE",
        `task ${parent.id} is ${parent.task.status} and cannot open a branch`,
      );
    }
    return;
  }
  if (parent.subTask.status !== "claimed") {
    throw new HarnessError(
      "INVALID_STATE",
      `sub-task ${parent.id} is ${parent.subTask.status} and cannot open a branch`,
    );
  }
}

export function assertParentBranched(parent: BranchParent): void {
  const status = parent.kind === "task" ? parent.task.status : parent.subTask.status;
  if (status !== "branched") {
    throw new HarnessError("INVALID_STATE", `${parent.id} is ${status}, not branched`);
  }
}

export function suspendParent(
  parent: BranchParent,
  actor: string,
  now: Date,
  reason: string,
): void {
  suspendLease(parentLease(parent), now);
  if (parent.kind === "task") transition(parent.task, "branched", actor, now, reason);
  else parent.subTask.status = "branched";
}

export function resumeParent(parent: BranchParent, actor: string, now: Date, reason: string): void {
  const lease = parentLease(parent);
  const duration = typeof lease.duration_seconds === "number" ? lease.duration_seconds : 0;
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new HarnessError("INTEGRITY", `${parent.id} lease has no usable duration`);
  }
  restoreLease(lease, now, duration);
  if (parent.kind === "task") transition(parent.task, "running", actor, now, reason);
  else parent.subTask.status = "claimed";
}
