import { existsSync } from "node:fs";
import type { WorktreeLedgerState } from "../../contracts/worktree.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { transact } from "../../store/index.ts";
import { readWorktreeLedger, writeWorktreeLedger } from "./ledger.ts";
import { pruneWorktrees, removeWorktree, runGit, type GitRunner } from "./git-ops.ts";

export interface ReclaimWorktreesInput {
  repoRoot: string;
  ledger: WorktreeLedgerState;
  runner?: GitRunner;
}

export interface ReclaimWorktreesResult {
  reclaimed_worktree_ids: string[];
}

export function reclaimOrphanedWorktrees(input: ReclaimWorktreesInput): ReclaimWorktreesResult {
  const { repoRoot, ledger } = input;
  const runner = input.runner ?? runGit;
  const reclaimed: string[] = [];
  for (const worktree of ledger.worktrees) {
    if (!existsSync(worktree.path)) continue;
    removeWorktree(repoRoot, worktree.path, runner);
    reclaimed.push(worktree.id);
  }
  pruneWorktrees(repoRoot, runner);
  return { reclaimed_worktree_ids: reclaimed };
}

export function recordReclaim(
  runRoot: string,
  actor: string,
  result: ReclaimWorktreesResult,
): void {
  transact(
    runRoot,
    actor,
    "worktrees-reclaimed",
    { reclaimed_worktree_ids: result.reclaimed_worktree_ids },
    (draft) => {
      const ledger = readWorktreeLedger(draft);
      if (!ledger) throw new HarnessError("INVALID_STATE", "no worktree ledger to reclaim");
      const remaining = ledger.worktrees.filter(
        (worktree) => !result.reclaimed_worktree_ids.includes(worktree.id),
      );
      writeWorktreeLedger(draft, { ...ledger, worktrees: remaining });
    },
  );
}
