import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConsolidationRecord, WorktreeLedgerState } from "../../contracts/worktree.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { transact } from "../../store/index.ts";
import {
  addWorktreeForBranch,
  deleteBranch,
  diffStat,
  mergeBranch,
  rebaseOnto,
  removeWorktree,
  runGit,
  type GitRunner,
} from "./git-ops.ts";
import { readWorktreeLedger, writeWorktreeLedger } from "./ledger.ts";

export interface ConsolidateWorktreesInput {
  repoRoot: string;
  runId: string;
  ledger: WorktreeLedgerState;
  rebaseOnComplete: boolean;
  runner?: GitRunner;
  now?: Date;
}

export function consolidateWorktrees(
  input: ConsolidateWorktreesInput,
): WorktreeConsolidationRecord {
  const { repoRoot, ledger } = input;
  const runner = input.runner ?? runGit;
  const now = (input.now ?? new Date()).toISOString();
  const scratchPath = join(ledger.root, input.runId, "consolidate");
  mkdirSync(join(ledger.root, input.runId), { recursive: true });
  addWorktreeForBranch(repoRoot, scratchPath, ledger.harness_branch, runner);

  const mergedWorktreeIds: string[] = [];
  let mergeConflict: WorktreeConsolidationRecord["merge_conflict"];
  for (const worktree of ledger.worktrees) {
    const hasCommits = ledger.commits.some((commit) => commit.worktree_id === worktree.id);
    if (!hasCommits) continue;
    const outcome = mergeBranch(
      scratchPath,
      worktree.branch,
      `chore: merge ${worktree.id} sub-phase commits into ${ledger.harness_branch}`,
      runner,
    );
    if (outcome) {
      mergeConflict = {
        worktree_id: worktree.id,
        branch: worktree.branch,
        paths: outcome.conflictPaths,
      };
      break;
    }
    mergedWorktreeIds.push(worktree.id);
  }

  let rebased = false;
  let rebaseConflictPaths: string[] | undefined;
  const canRebase =
    mergeConflict === undefined && input.rebaseOnComplete && ledger.base_branch !== undefined;
  if (canRebase) {
    const outcome = rebaseOnto(scratchPath, ledger.base_branch!, runner);
    if (outcome === null) rebased = true;
    else rebaseConflictPaths = outcome.conflictPaths;
  }

  const stat = diffStat(scratchPath, ledger.base_sha, "HEAD", runner);
  const finished = mergeConflict === undefined && rebaseConflictPaths === undefined;

  const removedWorktreeIds: string[] = [];
  if (finished) {
    for (const worktree of ledger.worktrees) {
      removeWorktree(repoRoot, worktree.path, runner);
      deleteBranch(repoRoot, worktree.branch, runner);
      removedWorktreeIds.push(worktree.id);
    }
  }
  removeWorktree(repoRoot, scratchPath, runner);

  return {
    harness_branch: ledger.harness_branch,
    merged_worktree_ids: mergedWorktreeIds,
    ...(mergeConflict === undefined ? {} : { merge_conflict: mergeConflict }),
    rebased,
    ...(ledger.base_branch === undefined ? {} : { rebase_target: ledger.base_branch }),
    ...(rebaseConflictPaths === undefined ? {} : { rebase_conflict_paths: rebaseConflictPaths }),
    removed_worktree_ids: removedWorktreeIds,
    commit_count: ledger.commits.length,
    diffstat: stat,
    consolidated_at: now,
  };
}

export function recordConsolidation(
  runRoot: string,
  actor: string,
  result: WorktreeConsolidationRecord,
  transactFn: typeof transact = transact,
): void {
  transactFn(
    runRoot,
    actor,
    "worktrees-consolidated",
    { harness_branch: result.harness_branch, rebased: result.rebased },
    (draft) => {
      const ledger = readWorktreeLedger(draft);
      if (!ledger) throw new HarnessError("INVALID_STATE", "no worktree ledger to consolidate");
      const remaining = ledger.worktrees.filter(
        (worktree) => !result.removed_worktree_ids.includes(worktree.id),
      );
      writeWorktreeLedger(draft, { ...ledger, worktrees: remaining, consolidation: result });
    },
  );
}
