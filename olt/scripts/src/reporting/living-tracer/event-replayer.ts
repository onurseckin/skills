/**
 * Living Tracer Telemetry Event Replayer
 */
import type { HarnessEvent } from "../../core/contracts/index.ts";
import { handleTaskStateTransition } from "./task-state-transitions.ts";
import {
  parsePayloadNumber,
  parsePayloadString,
  parsePayloadStringArray,
  type ActiveAgentState,
  type DynamicTaskState,
  type ReplayContext,
  type SproutedRepairPair,
} from "./types.ts";

export type { ReplayContext };

export function replayTelemetryEvent(ev: HarnessEvent, ctx: ReplayContext): void {
  const payload =
    typeof ev.payload === "object" && ev.payload !== null
      ? (ev.payload as Record<string, unknown>)
      : {};
  const actor = ev.actor;
  const kind = ev.kind;
  const lowerKind = kind.toLowerCase();
  const seq = ev.sequence;

  if (typeof ev.revision === "number" && ev.revision > ctx.revision) {
    ctx.revision = ev.revision;
  }

  const explicitTaskId = parsePayloadString(payload, ["task_id", "taskId", "task", "id"]);
  const role = parsePayloadString(payload, [
    "role",
    "assigned_role",
    "assignedRole",
    "repair_assignee",
  ]);
  const tool = parsePayloadString(payload, [
    "tool",
    "current_tool",
    "tool_name",
    "toolName",
    "tool_call",
  ]);
  const cmd = parsePayloadString(payload, ["command", "cmd", "command_line", "commandLine"]);
  const exitCode = parsePayloadNumber(payload, ["exit_code", "code", "exitCode"]);
  const roundInPayload = parsePayloadNumber(payload, ["round", "repair_round", "attempt_round"]);
  const attemptInPayload = parsePayloadNumber(payload, ["attempt", "lease_attempt"]);
  const branchIdFromPayload = parsePayloadString(payload, ["branch_id", "branchId", "branch"]);
  const validatorFromPayload = parsePayloadString(payload, [
    "validator_id",
    "validatorId",
    "validator",
    "validator_agent",
    "validatorAgent",
  ]);
  const probeRoundInPayload = parsePayloadNumber(payload, ["probe_round", "probeRound"]);
  const coordinatesFromPayload =
    typeof payload.coordinates === "string" ||
    (typeof payload.coordinates === "object" && payload.coordinates !== null)
      ? (payload.coordinates as
          | { wave?: number; lane?: number; rank?: number; order?: number }
          | string)
      : undefined;

  const taskId = explicitTaskId ?? (actor ? (ctx.agentMap.get(actor)?.taskId ?? null) : null);

  if (actor && actor !== "system" && actor !== "operator") {
    const existingAgent = ctx.agentMap.get(actor);
    ctx.agentMap.set(actor, {
      role:
        role ?? existingAgent?.role ?? (lowerKind.includes("val") ? "validator" : "implementer"),
      taskId: taskId ?? existingAgent?.taskId ?? null,
      currentTool: tool ?? existingAgent?.currentTool ?? null,
      currentCommand: cmd ?? existingAgent?.currentCommand ?? null,
      lastActiveSeq: seq,
      activeStepIndex: seq,
    });
  }

  if (lowerKind === "branch-opened" || lowerKind === "branch:open") {
    if (branchIdFromPayload) ctx.branches.add(branchIdFromPayload);
  } else if (
    lowerKind === "branch-collected" ||
    lowerKind === "branch:collect" ||
    lowerKind === "branch-abandoned"
  ) {
    if (branchIdFromPayload) ctx.branches.delete(branchIdFromPayload);
  }

  if (
    lowerKind === "task-created" ||
    lowerKind === "task:add" ||
    lowerKind === "task-added" ||
    lowerKind === "smart-task:plan" ||
    lowerKind === "subtask-created" ||
    lowerKind === "dynamic-expansion"
  ) {
    const id = explicitTaskId ?? parsePayloadString(payload, ["id"]);
    if (id) {
      const label = parsePayloadString(payload, ["label", "title"]) ?? id;
      const deps = parsePayloadStringArray(payload, "dependencies").concat(
        parsePayloadStringArray(payload, "deps"),
      );
      const writeScope = parsePayloadStringArray(payload, "write_scope").concat(
        parsePayloadStringArray(payload, "writeScope"),
      );
      const taskRound = roundInPayload ?? 1;
      if (taskRound > ctx.maxRoundReached) ctx.maxRoundReached = taskRound;

      ctx.taskMap.set(id, {
        id,
        label,
        status: deps.length > 0 ? "proposed" : "ready",
        role: role ?? undefined,
        dependencies: [...new Set(deps)],
        writeScope: [...new Set(writeScope)],
        assignedAgent: null,
        origin: branchIdFromPayload ? "branch" : "dynamic_expansion",
        createdAtSeq: seq,
        updatedAtSeq: seq,
        branchId: branchIdFromPayload ?? undefined,
        round: taskRound,
        attempt: attemptInPayload ?? 1,
        executionState: deps.length > 0 ? "[🔒 PROPOSED]" : "[⏳ READY]",
        activeTool: null,
        activeCommand: null,
        activeStepIndex: seq,
        sproutedChildren: [],
        validatorId: validatorFromPayload ?? undefined,
        probeRound: probeRoundInPayload ?? undefined,
        coordinates: coordinatesFromPayload ?? undefined,
      });
    }
  }

  if (taskId) {
    if (!ctx.taskMap.has(taskId)) {
      const label = parsePayloadString(payload, ["label", "title"]) ?? taskId;
      const writeScope = parsePayloadStringArray(payload, "write_scope").concat(
        parsePayloadStringArray(payload, "writeScope"),
      );
      const deps = parsePayloadStringArray(payload, "dependencies").concat(
        parsePayloadStringArray(payload, "deps"),
      );
      const taskRound = roundInPayload ?? 1;
      if (taskRound > ctx.maxRoundReached) ctx.maxRoundReached = taskRound;

      ctx.taskMap.set(taskId, {
        id: taskId,
        label,
        status: "ready",
        role: role ?? undefined,
        dependencies: [...new Set(deps)],
        writeScope: [...new Set(writeScope)],
        assignedAgent: null,
        origin: "static",
        createdAtSeq: seq,
        updatedAtSeq: seq,
        round: taskRound,
        attempt: attemptInPayload ?? 1,
        executionState: "[⏳ READY]",
        activeTool: null,
        activeCommand: null,
        activeStepIndex: seq,
        sproutedChildren: [],
        validatorId: validatorFromPayload ?? undefined,
        probeRound: probeRoundInPayload ?? undefined,
        coordinates: coordinatesFromPayload ?? undefined,
      });
    }

    const existing = ctx.taskMap.get(taskId)!;
    let targetTask = existing;
    let targetTaskId = taskId;

    if (
      (existing.status === "changes_requested" || existing.executionState.includes("REJECTED")) &&
      (roundInPayload === 2 || role === "repairer" || (attemptInPayload && attemptInPayload > 1)) &&
      existing.sproutedChildren &&
      existing.sproutedChildren.length > 0
    ) {
      const repairChildId = existing.sproutedChildren[0]!;
      if (ctx.taskMap.has(repairChildId)) {
        targetTask = ctx.taskMap.get(repairChildId)!;
        targetTaskId = repairChildId;
      }
    }

    handleTaskStateTransition(
      targetTask,
      targetTaskId,
      {
        actor,
        kind,
        lowerKind,
        seq,
        payload,
        role,
        tool,
        cmd,
        exitCode,
        roundInPayload,
        attemptInPayload,
        validatorFromPayload,
      },
      ctx,
    );
  }
}
