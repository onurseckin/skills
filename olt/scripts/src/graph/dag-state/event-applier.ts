import type { JsonObject } from "../../core/contracts/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import type { ActiveAgentState, DynamicTaskState } from "./types.ts";

export interface DagReconstructionState {
  currentRevision: number;
  totalBranches: number;
}

export function applyEvent(
  event: JsonObject,
  seq: number,
  taskMap: Map<string, DynamicTaskState>,
  agentMap: Map<string, ActiveAgentState>,
  stateRef: DagReconstructionState,
): void {
  const kind =
    typeof event.kind === "string" ? event.kind : typeof event.type === "string" ? event.type : "";
  const actor = typeof event.actor === "string" ? event.actor : "";
  const payload = isJsonObject(event.payload)
    ? event.payload
    : isJsonObject(event.data)
      ? event.data
      : {};
  const timestamp = typeof event.timestamp === "string" ? event.timestamp : undefined;

  if (actor && actor !== "system") {
    const existingAgent = agentMap.get(actor);
    agentMap.set(actor, {
      agentId: actor,
      role: existingAgent?.role ?? "worker",
      currentTaskId: existingAgent?.currentTaskId ?? null,
      lastActiveSeq: seq + 1,
      lastActiveTimestamp: timestamp,
    });
  }

  if (kind === "plan-compiled" && typeof payload.revision === "number") {
    stateRef.currentRevision = payload.revision;
  } else if (kind === "plan-task-added") {
    const taskId = typeof payload.task_id === "string" ? payload.task_id : "";
    if (taskId && !taskMap.has(taskId)) {
      taskMap.set(taskId, {
        id: taskId,
        label: typeof payload.label === "string" ? payload.label : taskId,
        status: "ready",
        role: typeof payload.role === "string" ? payload.role : "implementer",
        dependencies: [],
        writeScope: Array.isArray(payload.write_scope)
          ? payload.write_scope.filter((s): s is string => typeof s === "string")
          : [],
        assignedAgent: null,
        origin: "dynamic_expansion",
        createdAtSeq: seq + 1,
        updatedAtSeq: seq + 1,
        round: 1,
        attempt: 1,
        executionState: "ready",
      });
    }
  } else if (kind === "task-claimed") {
    const taskId = typeof payload.task_id === "string" ? payload.task_id : "";
    const agent = typeof payload.agent === "string" ? payload.agent : actor;
    const role = typeof payload.role === "string" ? payload.role : "implementer";
    const existing = taskMap.get(taskId);
    if (existing) {
      taskMap.set(taskId, {
        ...existing,
        status: "leased",
        assignedAgent: agent,
        role,
        updatedAtSeq: seq + 1,
        executionState: "in_flight",
      });
    }
    if (agent) {
      agentMap.set(agent, {
        agentId: agent,
        role,
        currentTaskId: taskId,
        lastActiveSeq: seq + 1,
        lastActiveTimestamp: timestamp,
      });
    }
  } else if (kind === "task-submitted") {
    const taskId = typeof payload.task_id === "string" ? payload.task_id : "";
    const existing = taskMap.get(taskId);
    if (existing) {
      taskMap.set(taskId, {
        ...existing,
        status: "submitted",
        updatedAtSeq: seq + 1,
        executionState: "submitted",
      });
    }
  } else if (kind === "task-validate-start" || kind === "validate-start") {
    const taskId = typeof payload.task_id === "string" ? payload.task_id : "";
    const validator = typeof payload.validator === "string" ? payload.validator : actor;
    const existing = taskMap.get(taskId);
    if (existing) {
      taskMap.set(taskId, {
        ...existing,
        status: "validating",
        validatorId: validator,
        updatedAtSeq: seq + 1,
        executionState: "under_validation",
      });
    }
    if (validator) {
      agentMap.set(validator, {
        agentId: validator,
        role: "validator",
        currentTaskId: taskId,
        lastActiveSeq: seq + 1,
        lastActiveTimestamp: timestamp,
      });
    }
  } else if (kind === "task-reviewed") {
    const taskId = typeof payload.task_id === "string" ? payload.task_id : "";
    const status = typeof payload.status === "string" ? payload.status : "";
    const existing = taskMap.get(taskId);
    if (existing) {
      const isPass = status === "pass" || status === "passed" || status === "approved";
      taskMap.set(taskId, {
        ...existing,
        status: isPass ? "done" : "changes_requested",
        updatedAtSeq: seq + 1,
        executionState: isPass ? "completed" : "rejected",
        round: isPass ? existing.round : existing.round + 1,
        rejectionReason:
          !isPass && typeof payload.summary === "string" ? payload.summary : undefined,
      });
    }
  } else if (kind === "branch-opened") {
    stateRef.totalBranches++;
    const parentTaskId = typeof payload.parent_task_id === "string" ? payload.parent_task_id : "";
    const branchId =
      typeof payload.branch_id === "string"
        ? payload.branch_id
        : `branch-${stateRef.totalBranches}`;
    const subtasks = Array.isArray(payload.subtasks) ? payload.subtasks : [];

    for (const sub of subtasks) {
      if (isJsonObject(sub) && typeof sub.id === "string") {
        const subId = sub.id;
        taskMap.set(subId, {
          id: subId,
          label: typeof sub.label === "string" ? sub.label : subId,
          status: "ready",
          role: "sub_implementer",
          dependencies: parentTaskId ? [parentTaskId] : [],
          writeScope: Array.isArray(sub.write_scope)
            ? sub.write_scope.filter((s): s is string => typeof s === "string")
            : [],
          assignedAgent: null,
          origin: "branch",
          createdAtSeq: seq + 1,
          updatedAtSeq: seq + 1,
          branchId,
          round: 1,
          attempt: 1,
          executionState: "branch_ready",
        });
      }
    }
  } else if (kind === "branch-collected") {
    const branchId = typeof payload.branch_id === "string" ? payload.branch_id : "";
    for (const [id, t] of taskMap.entries()) {
      if (t.branchId === branchId && t.status !== "done") {
        taskMap.set(id, {
          ...t,
          status: "done",
          updatedAtSeq: seq + 1,
          executionState: "branch_collected",
        });
      }
    }
  }
}
