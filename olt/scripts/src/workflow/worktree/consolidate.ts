import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  WorktreeConsolidationRecord,
  WorktreeLedgerState,
} from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { safeRmSync } from "../../core/shared/safe-fs/index.ts";
import { transact } from "../../engine/store/index.ts";
import {
  addWorktreeForBranch,
  deleteBranch,
  diffStat,
  mergeBranch,
  pruneWorktrees,
  rebaseOnto,
  removeWorktree,
  runGit,
  type GitRunner,
} from "./git-ops.ts";
import { git } from "./git.ts";
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
  let rebased = false;
  let rebaseConflictPaths: string[] | undefined;
  const removedWorktreeIds: string[] = [];
  let stat = "0 files changed";

  try {
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

    const rebaseTarget =
      ledger.base_branch ?? (input.rebaseOnComplete ? ledger.base_sha : undefined);
    const canRebase =
      mergeConflict === undefined && input.rebaseOnComplete && rebaseTarget !== undefined;
    if (canRebase) {
      const outcome = rebaseOnto(scratchPath, rebaseTarget, runner);
      if (outcome === null) rebased = true;
      else rebaseConflictPaths = outcome.conflictPaths;
    }

    if (mergeConflict !== undefined || rebaseConflictPaths !== undefined) {
      try {
        git(scratchPath, ["reset", ledger.base_sha], runner);
      } catch {}
    }

    stat = diffStat(scratchPath, ledger.base_sha, "HEAD", runner);
    const finished = mergeConflict === undefined && rebaseConflictPaths === undefined;

    if (finished) {
      try {
        pruneWorktrees(repoRoot, runner);
      } catch {}

      for (const worktree of ledger.worktrees) {
        try {
          removeWorktree(repoRoot, worktree.path, runner);
        } catch {}
        try {
          deleteBranch(repoRoot, worktree.branch, runner);
        } catch {}
        removedWorktreeIds.push(worktree.id);
      }

      try {
        pruneWorktrees(repoRoot, runner);
      } catch {}
    }
  } finally {
    try {
      removeWorktree(repoRoot, scratchPath, runner);
    } catch {
      safeRmSync(scratchPath, {
        allowedRoots: [ledger.root],
        allowGitRepositoryDeletion: true,
        missingOk: true,
      });
    }
    try {
      pruneWorktrees(repoRoot, runner);
    } catch {}
  }

  const rebaseTarget = ledger.base_branch ?? (input.rebaseOnComplete ? ledger.base_sha : undefined);
  return {
    harness_branch: ledger.harness_branch,
    merged_worktree_ids: mergedWorktreeIds,
    ...(mergeConflict === undefined ? {} : { merge_conflict: mergeConflict }),
    rebased,
    ...(rebaseTarget === undefined ? {} : { rebase_target: rebaseTarget }),
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
    try {
      removeWorktree(repoRoot, worktree.path, runner);
      reclaimed.push(worktree.id);
    } catch {
      try {
        safeRmSync(worktree.path, {
          allowedRoots: [ledger.root],
          allowGitRepositoryDeletion: true,
          missingOk: true,
        });
        reclaimed.push(worktree.id);
      } catch {}
    }
  }
  pruneWorktrees(repoRoot, runner);
  return { reclaimed_worktree_ids: reclaimed };
}

export function recordReclaim(
  runRoot: string,
  actor: string,
  result: ReclaimWorktreesResult,
  transactFn: typeof transact = transact,
): void {
  transactFn(
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
