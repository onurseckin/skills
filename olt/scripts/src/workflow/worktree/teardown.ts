import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { safeRmSync } from "../../core/shared/safe-fs/index.ts";
import {
  branchExists,
  deleteBranch,
  pruneWorktrees,
  removeWorktree,
  runGit,
  type GitRunner,
} from "./git-ops.ts";
import { isProcessAlive, readLockPayload, releaseWorktreeLock } from "./lock.ts";

export const IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]+$/;

export interface TeardownOptions {
  repo: string;
  worktreePath: string;
  branch: string;
  lockPath: string;
  deleteBranch: boolean;
  force: boolean;
  runner?: GitRunner | undefined;
}

export function resolveRepo(repoRoot?: string): string {
  if (repoRoot) return resolve(repoRoot);
  try {
    return findRepoRoot(process.cwd());
  } catch {
    return resolve(process.cwd());
  }
}

export function assertSafeWorktreePath(worktreePath: string, worktreesRoot: string): void {
  const normalizedWorktreesRoot = resolve(worktreesRoot);
  const normalizedWorktreePath = resolve(worktreePath);
  if (
    normalizedWorktreePath !== normalizedWorktreesRoot &&
    !normalizedWorktreePath.startsWith(normalizedWorktreesRoot + sep)
  ) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Worktree path '${normalizedWorktreePath}' resolves outside '.olt/worktrees'`,
    );
  }
}

export function teardownWorktree(target: string, options: TeardownOptions): void {
  if (existsSync(options.lockPath)) {
    const payload = readLockPayload(options.lockPath);
    if (payload && typeof payload.pid === "number") {
      if (payload.pid !== process.pid && isProcessAlive(payload.pid) && !options.force) {
        throw new HarnessError(
          "WORKTREE_ACTIVE",
          `Cannot teardown active worktree '${target}': held by living process PID ${payload.pid}`,
        );
      }
    }
  }

  const runner = options.runner ?? runGit;
  const worktreesRoot = join(options.repo, ".olt", "worktrees");

  try {
    if (existsSync(options.worktreePath)) {
      try {
        removeWorktree(options.repo, options.worktreePath, runner);
      } catch {
        safeRmSync(options.worktreePath, {
          allowedRoots: [worktreesRoot],
          allowGitRepositoryDeletion: true,
          missingOk: true,
        });
      }
    }
    try {
      pruneWorktrees(options.repo, runner);
    } catch {}
    if (options.deleteBranch && branchExists(options.repo, options.branch, runner)) {
      try {
        deleteBranch(options.repo, options.branch, runner);
      } catch {}
    }
    try {
      pruneWorktrees(options.repo, runner);
    } catch {}
  } finally {
    if (existsSync(options.worktreePath)) {
      try {
        safeRmSync(options.worktreePath, {
          allowedRoots: [worktreesRoot],
          allowGitRepositoryDeletion: true,
          missingOk: true,
        });
      } catch {}
    }
    releaseWorktreeLock(options.lockPath);
  }
}
