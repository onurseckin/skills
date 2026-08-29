import type { DynamicTaskState, SproutedRepairPair } from "./types.ts";

export function createSproutedRepairBranch(
  targetTask: DynamicTaskState,
  targetTaskId: string,
  currentRound: number,
  seq: number,
  rejectionReason: string | null,
): {
  repairTask: DynamicTaskState;
  validatorTask: DynamicTaskState;
  repairPair: SproutedRepairPair;
  nextRound: number;
} {
  const nextRound = currentRound + 1;
  const baseCleanId = targetTask.id.replace(/-repair-r\d+$/, "");
  const repairTaskId = `${baseCleanId}-repair-r${nextRound}`;
  const validatorTaskId = `val-${baseCleanId.replace(/^val-/, "")}-r${nextRound}`;

  const repairLabel = `${targetTask.label.replace(/ \(R\d+ Repair\)$/, "")} (R${nextRound} Repair)`;
  const validatorLabel = `Validator for ${targetTask.label.replace(/ \(R\d+ Repair\)$/, "")} (R${nextRound})`;

  const repairTask: DynamicTaskState = {
    id: repairTaskId,
    label: repairLabel,
    status: "ready",
    role: "repairer",
    dependencies: [targetTaskId],
    writeScope: targetTask.writeScope,
    assignedAgent: null,
    origin: "repair_branch",
    createdAtSeq: seq,
    updatedAtSeq: seq,
    round: nextRound,
    attempt: 1,
    executionState: `[⏳ READY - R${nextRound} Repair]`,
    activeTool: null,
    activeCommand: null,
    activeStepIndex: seq,
    repairForTaskId: targetTaskId,
    sproutedChildren: [],
  };

  const validatorTask: DynamicTaskState = {
    id: validatorTaskId,
    label: validatorLabel,
    status: "proposed",
    role: "validator",
    dependencies: [repairTaskId],
    writeScope: targetTask.writeScope,
    assignedAgent: null,
    origin: "repair_branch",
    createdAtSeq: seq,
    updatedAtSeq: seq,
    round: nextRound,
    attempt: 1,
    executionState: `[⏳ PROPOSED - R${nextRound} Validator]`,
    activeTool: null,
    activeCommand: null,
    activeStepIndex: seq,
    sproutedChildren: [],
  };

  const repairPair: SproutedRepairPair = {
    rejectedTaskId: targetTaskId,
    round: nextRound,
    repairTaskId,
    validatorTaskId,
    reason: rejectionReason,
  };

  return { repairTask, validatorTask, repairPair, nextRound };
}
