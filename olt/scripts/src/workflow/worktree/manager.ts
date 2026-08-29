import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { safeRmSync } from "../../core/shared/safe-fs/index.ts";
import {
  branchExists,
  deleteBranch as gitDeleteBranch,
  pruneWorktrees,
  removeWorktree,
  runGit,
  type GitRunner,
} from "./git-ops.ts";
import { git } from "./git.ts";

export interface TrackWorktreeInfo {
  trackId: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  lockPath: string;
  createdAt: string;
  status: "active" | "cleaned";
}

export interface CreateWorktreeOptions {
  trackId: string;
  baseBranch?: string | undefined;
  repoRoot?: string | undefined;
  lockTimeoutMs?: number | undefined;
  runner?: GitRunner | undefined;
  now?: Date | undefined;
}

export interface CleanupWorktreeOptions {
  trackId: string;
  repoRoot?: string | undefined;
  force?: boolean | undefined;
  deleteBranch?: boolean | undefined;
  runner?: GitRunner | undefined;
}

export interface ListWorktreesOptions {
  repoRoot?: string | undefined;
  runner?: GitRunner | undefined;
}

interface LockPayload {
  trackId: string;
  pid: number;
  createdAt: string;
}

const TRACK_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveRepo(repoRoot?: string): string {
  if (repoRoot) return resolve(repoRoot);
  try {
    return findRepoRoot(process.cwd());
  } catch {
    return resolve(process.cwd());
  }
}

function acquireTrackLock(lockPath: string, trackId: string, timeoutMs = 5000): void {
  const lockDir = dirname(lockPath);
  mkdirSync(lockDir, { recursive: true });

  const startTime = Date.now();
  while (true) {
    if (existsSync(lockPath)) {
      try {
        const raw = readFileSync(lockPath, "utf-8");
        const payload: LockPayload = JSON.parse(raw);
        if (!isProcessAlive(payload.pid)) {
          try {
            unlinkSync(lockPath);
          } catch {}
        }
      } catch {
        try {
          unlinkSync(lockPath);
        } catch {}
      }
    }

    try {
      const payload: LockPayload = {
        trackId,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(lockPath, JSON.stringify(payload), { flag: "wx" });
      return;
    } catch {
      if (Date.now() - startTime >= timeoutMs) {
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `Track worktree lock for '${trackId}' could not be acquired within ${timeoutMs}ms`,
        );
      }
    }
  }
}

function releaseTrackLock(lockPath: string): void {
  if (existsSync(lockPath)) {
    try {
      unlinkSync(lockPath);
    } catch {}
  }
}

export function createTrackWorktree(options: CreateWorktreeOptions): TrackWorktreeInfo {
  if (!options.trackId || !TRACK_ID_REGEX.test(options.trackId)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid trackId: '${options.trackId}'. Must contain only alphanumeric characters, dashes, or underscores.`,
    );
  }

  const repo = resolveRepo(options.repoRoot);
  const worktreesRoot = join(repo, ".olt", "worktrees");
  const worktreePath = join(worktreesRoot, options.trackId);
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

  const lockPath = join(worktreesRoot, "locks", `${options.trackId}.lock`);
  acquireTrackLock(lockPath, options.trackId, options.lockTimeoutMs);

  const runner = options.runner ?? runGit;
  const baseBranch = options.baseBranch ?? "main";
  const branch = `track/${options.trackId}`;
  const createdAt = (options.now ?? new Date()).toISOString();

  try {
    mkdirSync(worktreesRoot, { recursive: true });
    if (branchExists(repo, branch, runner)) {
      git(repo, ["worktree", "add", worktreePath, branch], runner);
    } else {
      git(repo, ["worktree", "add", "-b", branch, worktreePath, baseBranch], runner);
    }

    const info: TrackWorktreeInfo = {
      trackId: options.trackId,
      worktreePath,
      branch,
      baseBranch,
      lockPath,
      createdAt,
      status: "active",
    };

    mkdirSync(worktreePath, { recursive: true });
    const metaPath = join(worktreePath, ".worktree-meta.json");
    writeFileSync(metaPath, JSON.stringify(info, null, 2), "utf-8");
    return info;
  } catch (error) {
    releaseTrackLock(lockPath);
    throw error;
  }
}

export function cleanupTrackWorktree(options: CleanupWorktreeOptions): {
  cleaned: boolean;
  trackId: string;
} {
  const repo = resolveRepo(options.repoRoot);
  const worktreesRoot = join(repo, ".olt", "worktrees");
  const worktreePath = join(worktreesRoot, options.trackId);
  const lockPath = join(worktreesRoot, "locks", `${options.trackId}.lock`);
  const runner = options.runner ?? runGit;
  const shouldDeleteBranch = options.deleteBranch ?? true;
  const branch = `track/${options.trackId}`;

  try {
    if (existsSync(worktreePath)) {
      try {
        removeWorktree(repo, worktreePath, runner);
      } catch {
        safeRmSync(worktreePath, {
          allowedRoots: [worktreesRoot],
          allowGitRepositoryDeletion: true,
          missingOk: true,
        });
      }
    }

    if (shouldDeleteBranch && branchExists(repo, branch, runner)) {
      gitDeleteBranch(repo, branch, runner);
    }

    pruneWorktrees(repo, runner);
  } finally {
    if (existsSync(worktreePath)) {
      safeRmSync(worktreePath, {
        allowedRoots: [worktreesRoot],
        allowGitRepositoryDeletion: true,
        missingOk: true,
      });
    }
    releaseTrackLock(lockPath);
  }

  return { cleaned: true, trackId: options.trackId };
}

export function listTrackWorktrees(options?: ListWorktreesOptions): readonly TrackWorktreeInfo[] {
  const repo = resolveRepo(options?.repoRoot);
  const worktreesRoot = join(repo, ".olt", "worktrees");
  if (!existsSync(worktreesRoot)) return [];

  const entries = readdirSync(worktreesRoot, { withFileTypes: true });
  const results: TrackWorktreeInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "locks") continue;
    const trackId = entry.name;
    const worktreePath = join(worktreesRoot, trackId);
    const metaPath = join(worktreePath, ".worktree-meta.json");
    const lockPath = join(worktreesRoot, "locks", `${trackId}.lock`);

    if (existsSync(metaPath)) {
      try {
        const raw = readFileSync(metaPath, "utf-8");
        const parsed: TrackWorktreeInfo = JSON.parse(raw);
        results.push(parsed);
        continue;
      } catch {}
    }

    results.push({
      trackId,
      worktreePath,
      branch: `track/${trackId}`,
      baseBranch: "main",
      lockPath,
      createdAt: new Date().toISOString(),
      status: "active",
    });
  }

  return results;
}
