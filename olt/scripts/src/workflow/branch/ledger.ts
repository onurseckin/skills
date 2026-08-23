import { isBranchRecord, type BranchRecord, type BranchSubTask } from "../../contracts/branch.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";

export const BRANCH_LEDGER_KEY = "branches";

export function readBranchLedger(state: JsonObject): BranchRecord[] {
  const raw = state[BRANCH_LEDGER_KEY];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new HarnessError("INTEGRITY", "state.branches must be an array of branch records");
  }
  return raw.map((entry, index) => {
    if (!isBranchRecord(entry)) {
      throw new HarnessError("INTEGRITY", `state.branches[${index}] is not a branch record`);
    }
    return entry;
  });
}

export function writeBranchLedger(draft: JsonObject, ledger: readonly BranchRecord[]): void {
  draft[BRANCH_LEDGER_KEY] = [...ledger];
}

export function findBranch(
  ledger: readonly BranchRecord[],
  branchId: string,
): BranchRecord | undefined {
  return ledger.find((branch) => branch.id === branchId);
}

export function requireBranch(ledger: readonly BranchRecord[], branchId: string): BranchRecord {
  const branch = findBranch(ledger, branchId);
  if (!branch) throw new HarnessError("INVALID_ARGUMENT", `unknown branch: ${branchId}`);
  return branch;
}

export function requireSubTask(branch: BranchRecord, subTaskId: string): BranchSubTask {
  const subTask = branch.sub_tasks.find((entry) => entry.id === subTaskId);
  if (!subTask) {
    throw new HarnessError("INVALID_ARGUMENT", `branch ${branch.id} has no sub-task ${subTaskId}`);
  }
  return subTask;
}

export interface SubTaskLocation {
  branch: BranchRecord;
  subTask: BranchSubTask;
}

export function locateSubTask(
  ledger: readonly BranchRecord[],
  subTaskId: string,
): SubTaskLocation | undefined {
  for (const branch of ledger) {
    const subTask = branch.sub_tasks.find((entry) => entry.id === subTaskId);
    if (subTask) return { branch, subTask };
  }
  return undefined;
}

export function branchesForParent(
  ledger: readonly BranchRecord[],
  parentTaskId: string,
): BranchRecord[] {
  return ledger.filter((branch) => branch.parent_task_id === parentTaskId);
}
