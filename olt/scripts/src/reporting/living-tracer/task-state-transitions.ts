/**
 * Living Tracer Task State Transition Mechanics
 */
import { createSproutedRepairBranch } from "./sprout-builder.ts";
import {
  formatSeq,
  parsePayloadString,
  type DynamicTaskState,
  type ReplayContext,
} from "./types.ts";

export interface EventTransitionData {
  readonly actor: string;
  readonly kind: string;
  readonly lowerKind: string;
  readonly seq: number;
  readonly payload: Record<string, unknown>;
  readonly role: string | null;
  readonly tool: string | null;
  readonly cmd: string | null;
  readonly exitCode: number | null;
  readonly roundInPayload: number | null;
  readonly attemptInPayload: number | null;
  readonly validatorFromPayload: string | null;
}

export function handleTaskStateTransition(
  targetTask: DynamicTaskState,
  targetTaskId: string,
  evData: EventTransitionData,
  ctx: ReplayContext,
): void {
  const { actor, lowerKind, seq, payload, tool, cmd, exitCode, roundInPayload, attemptInPayload } = evData;
  const currentRound = roundInPayload ?? targetTask.round;
  if (currentRound > ctx.maxRoundReached) ctx.maxRoundReached = currentRound;
  const currentAttempt = attemptInPayload ?? targetTask.attempt;

  let nextStatus = targetTask.status;
  let nextAgent = targetTask.assignedAgent;
  let nextExecutionState = targetTask.executionState;
  let nextActiveTool = targetTask.activeTool;
  let nextActiveCommand = targetTask.activeCommand;
  let rejectionReason = targetTask.rejectionReason;
  let validatorId = targetTask.validatorId;

  if (
    lowerKind === "task-claimed" ||
    lowerKind === "task:claim" ||
    lowerKind === "lease-claimed" ||
    lowerKind === "lease:claim" ||
    lowerKind === "lease-renewed"
  ) {
    nextStatus = "leased";
    nextAgent = actor;
    nextActiveTool = null;
    nextActiveCommand = null;
    nextExecutionState = `[🟢 LEASED by ${actor} (step ${formatSeq(seq)})]`;
    if (actor) {
      ctx.agentMap.set(actor, {
        role: role ? role : targetTask.role ? targetTask.role : "implementer",
        taskId: targetTaskId,
        currentTool: null,
        currentCommand: null,
        lastActiveSeq: seq,
        activeStepIndex: seq,
      });
    }
  } else if (
    lowerKind === "tool-exec" ||
    lowerKind === "tool:start" ||
    lowerKind === "tool_call" ||
    lowerKind === "tool-call" ||
    lowerKind === "tool-invocation" ||
    lowerKind === "exec" ||
    lowerKind === "command-exec"
  ) {
    nextStatus = "in_progress";
    nextActiveTool = tool ? tool : "exec";
    nextActiveCommand = cmd ?? null;
    const displayCmd = cmd ? cmd : tool ? tool : "exec";
    nextExecutionState = `[🟢 RUNNING: ${displayCmd}]`;
    if (actor) {
      ctx.agentMap.set(actor, {
        role: role ? role : targetTask.role ? targetTask.role : "implementer",
        taskId: targetTaskId,
        currentTool: tool ? tool : "exec",
        currentCommand: cmd ?? null,
        lastActiveSeq: seq,
        activeStepIndex: seq,
      });
    }
  } else if (
    lowerKind === "gate:prove" ||
    lowerKind === "gate-prove" ||
    lowerKind === "gate:proof" ||
    lowerKind === "prove"
  ) {
    nextActiveTool = "gate";
    nextActiveCommand = cmd ?? null;
    if (exitCode === 0) {
      nextExecutionState = `[🛡️✓ GATE PASSED (step ${formatSeq(seq)})]`;
      nextActiveTool = null;
      nextActiveCommand = null;
    } else if (exitCode !== null && exitCode !== 0) {
      nextExecutionState = `[🛡️❌ GATE FAILED (exit ${exitCode}, step ${formatSeq(seq)})]`;
    } else {
      const gateCmd = cmd ? cmd : "gate proof";
      nextExecutionState = `[🛡️ PROVING GATE: ${gateCmd}]`;
    }
  } else if (
    lowerKind === "task-submitted" ||
    lowerKind === "task:submit" ||
    lowerKind === "submission-created" ||
    lowerKind === "submit"
  ) {
    nextStatus = "validating";
    nextActiveTool = null;
    nextActiveCommand = null;
    nextExecutionState = `[📦 SUBMITTED (step ${formatSeq(seq)})]`;
  } else if (
    lowerKind === "begin-validation" ||
    lowerKind === "validation-claimed" ||
    lowerKind === "validator-claimed" ||
    lowerKind === "review:begin"
  ) {
    nextStatus = "validating";
    validatorId = actor;
    nextActiveTool = null;
    nextActiveCommand = null;
    nextExecutionState = `[🔍 VALIDATING by ${actor} (step ${formatSeq(seq)})]`;
    if (actor) {
      ctx.agentMap.set(actor, {
        role: "validator",
        taskId: targetTaskId,
        currentTool: null,
        currentCommand: null,
        lastActiveSeq: seq,
        activeStepIndex: seq,
      });
    }
  }

  const verdictStr = parsePayloadString(payload, ["verdict", "decision", "review_verdict"]);
  const isExplicitReject =
    lowerKind.includes("reject") ||
    lowerKind.includes("fail") ||
    verdictStr === "reject" ||
    verdictStr === "rejected" ||
    lowerKind.includes("changes-requested") ||
    lowerKind.includes("changes_requested");
  const isExplicitPass =
    lowerKind.includes("pass") ||
    verdictStr === "pass" ||
    verdictStr === "passed" ||
    lowerKind === "verdict-passed" ||
    (lowerKind === "task-reviewed" && verdictStr !== "reject");

  if (isExplicitReject) {
    nextStatus = "changes_requested";
    const parsedReason = parsePayloadString(payload, [
      "reason",
      "message",
      "error",
      "feedback",
      "finding",
      "rejection_reason",
    ]);
    rejectionReason = parsedReason ? parsedReason : "Validation check failed";
    nextActiveTool = null;
    nextActiveCommand = null;
    nextExecutionState = `[❌ REJECTED - R${currentRound}]`;

    const { repairTask, validatorTask, repairPair, nextRound } = createSproutedRepairBranch(
      targetTask,
      targetTaskId,
      currentRound,
      seq,
      rejectionReason,
    );

    if (nextRound > ctx.maxRoundReached) ctx.maxRoundReached = nextRound;
    ctx.taskMap.set(repairTask.id, repairTask);
    ctx.taskMap.set(validatorTask.id, validatorTask);
    ctx.sproutedRepairPairs.push(repairPair);

    const updatedSprouted = [
      ...(targetTask.sproutedChildren ?? []),
      repairTask.id,
      validatorTask.id,
    ];
    ctx.taskMap.set(targetTaskId, {
      ...targetTask,
      status: nextStatus,
      assignedAgent: nextAgent,
      executionState: nextExecutionState,
      activeTool: nextActiveTool,
      activeCommand: nextActiveCommand,
      rejectionReason,
      validatorId: validatorId ?? actor,
      updatedAtSeq: seq,
      activeStepIndex: seq,
      sproutedChildren: updatedSprouted,
    });
  } else if (isExplicitPass) {
    nextStatus = "satisfied";
    nextActiveTool = null;
    nextActiveCommand = null;
    nextExecutionState = `[✓ PASSED - R${currentRound}]`;

    ctx.taskMap.set(targetTaskId, {
      ...targetTask,
      status: nextStatus,
      assignedAgent: nextAgent,
      executionState: nextExecutionState,
      activeTool: nextActiveTool,
      activeCommand: nextActiveCommand,
      validatorId: validatorId ?? actor,
      updatedAtSeq: seq,
      activeStepIndex: seq,
    });

    if (targetTask.repairForTaskId && ctx.taskMap.has(targetTask.repairForTaskId)) {
      const parentT = ctx.taskMap.get(targetTask.repairForTaskId)!;
      ctx.taskMap.set(targetTask.repairForTaskId, {
        ...parentT,
        status: "satisfied",
        executionState: `[✓ RESOLVED - R${currentRound}]`,
        updatedAtSeq: seq,
      });
    }
  } else if (
    lowerKind === "task-released" ||
    lowerKind === "task:release" ||
    lowerKind === "lease-released"
  ) {
    nextStatus = "ready";
    nextAgent = null;
    nextActiveTool = null;
    nextActiveCommand = null;
    nextExecutionState = "[⏳ READY]";

    ctx.taskMap.set(targetTaskId, {
      ...targetTask,
      status: nextStatus,
      assignedAgent: nextAgent,
      executionState: nextExecutionState,
      activeTool: nextActiveTool,
      activeCommand: nextActiveCommand,
      updatedAtSeq: seq,
      activeStepIndex: seq,
    });
  } else if (lowerKind === "replacement-repairer-assigned" || lowerKind === "assign-repairer") {
    const replacementId = parsePayloadString(payload, [
      "replacement_id",
      "replacementId",
      "repair_assignee",
    ]);
    if (replacementId) {
      nextAgent = replacementId;
      nextStatus = "leased";
      nextExecutionState = `[🔧 REPAIRER ASSIGNED: ${replacementId} (step ${formatSeq(seq)})]`;

      ctx.taskMap.set(targetTaskId, {
        ...targetTask,
        assignedAgent: nextAgent,
        status: nextStatus,
        executionState: nextExecutionState,
        updatedAtSeq: seq,
        activeStepIndex: seq,
      });
    }
  } else {
    ctx.taskMap.set(targetTaskId, {
      ...targetTask,
      status: nextStatus,
      assignedAgent: nextAgent,
      executionState: nextExecutionState,
      activeTool: nextActiveTool,
      activeCommand: nextActiveCommand,
      rejectionReason,
      validatorId,
      round: currentRound,
      attempt: currentAttempt,
      updatedAtSeq: seq,
      activeStepIndex: seq,
    });
  }
}
