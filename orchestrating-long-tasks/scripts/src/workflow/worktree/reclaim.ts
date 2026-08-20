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

/**
 * B22.6: the manual counterpart to `recover`/`task:release`, but for worktrees instead of leases —
 * an abandoned run's worktree directories are freed for reuse WITHOUT touching the branches they
 * point to. A crashed run "leaves its branch and worktrees intact for inspection" (B22.6); this is
 * the explicit act that ends that inspection window, once a human has actually looked and decided
 * the run is not being resumed.
 *
 * Branches — `harness_branch` and every per-task `wt-N` branch — are left alone on purpose. The
 * worktree directory is disposable scratch; the branch is the only place an abandoned run's actual
 * work still exists. Deleting it here would be exactly the implicit, unrequested destruction B22.6
 * refuses ("cleanup is explicit, never implicit on failure") — a human who wants the branch gone too
 * can delete it directly, having already looked.
 */
export function reclaimOrphanedWorktrees(input: ReclaimWorktreesInput): ReclaimWorktreesResult {
  const { repoRoot, ledger } = input;
  const runner = input.runner ?? runGit;
  const reclaimed: string[] = [];
  for (const worktree of ledger.worktrees) {
    // A directory a human already removed by hand (not through this command) leaves only git's own
    // administrative record behind — `pruneWorktrees` below clears that, `removeWorktree` has
    // nothing left to do and would only fail on a path that is no longer there.
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
