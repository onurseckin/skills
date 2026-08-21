import { isWorktreeLedgerState, type WorktreeLedgerState } from "../../contracts/worktree.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";

export const WORKTREE_LEDGER_KEY = "worktree_ledger";

export function readWorktreeLedger(state: JsonObject): WorktreeLedgerState | null {
  const raw = state[WORKTREE_LEDGER_KEY];
  if (raw === undefined) return null;
  if (!isWorktreeLedgerState(raw)) {
    throw new HarnessError("INTEGRITY", "state.worktree_ledger is present but malformed");
  }
  return raw;
}

export function writeWorktreeLedger(draft: JsonObject, ledger: WorktreeLedgerState): void {
  draft[WORKTREE_LEDGER_KEY] = structuredClone(ledger);
}

export function findAssignedWorktree(
  ledger: WorktreeLedgerState,
  taskId: string,
): { worktreePath: string; worktreeId: string } | null {
  const assignment = [...ledger.assignments].reverse().find((entry) => entry.task_id === taskId);
  if (!assignment) return null;
  const worktree = ledger.worktrees.find((entry) => entry.id === assignment.worktree_id);
  if (!worktree) return null;
  return { worktreePath: worktree.path, worktreeId: worktree.id };
}
