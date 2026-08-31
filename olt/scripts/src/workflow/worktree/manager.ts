import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
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
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const STALE_LOCK_THRESHOLD_MS = 60_000;
const IN_FLIGHT_LOCK_GRACE_MS = 2000;

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
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

function acquireTrackLock(
  lockPath: string,
  trackId: string,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
): void {
  mkdirSync(dirname(lockPath), { recursive: true });
  const startTime = Date.now();
  let backoffMs = 10;
  while (true) {
    if (existsSync(lockPath)) {
      try {
        const raw = readFileSync(lockPath, "utf-8");
        const fileStat = statSync(lockPath);
        let isStale = false;
        try {
          const payload: LockPayload = JSON.parse(raw);
          const age = Date.now() - new Date(payload.createdAt).getTime();
          if (
            !isProcessAlive(payload.pid) ||
            (Number.isFinite(age) && age > STALE_LOCK_THRESHOLD_MS)
          ) {
            isStale = true;
          }
        } catch {
          if (Date.now() - fileStat.mtimeMs > IN_FLIGHT_LOCK_GRACE_MS) {
            isStale = true;
          }
        }
        if (isStale) {
          try {
            unlinkSync(lockPath);
          } catch {}
        }
      } catch {}
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
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `Track worktree lock for '${trackId}' could not be acquired within ${timeoutMs}ms`,
        );
      }
      sleepSync(Math.min(backoffMs, timeoutMs - elapsed));
      backoffMs = Math.min(backoffMs * 2, 100);
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

export function createTrackWorktree(trackId: string): string;
export function createTrackWorktree(options: CreateWorktreeOptions): TrackWorktreeInfo;
export function createTrackWorktree(
  trackIdOrOptions: string | CreateWorktreeOptions,
): string | TrackWorktreeInfo {
  const options: CreateWorktreeOptions =
    typeof trackIdOrOptions === "string" ? { trackId: trackIdOrOptions } : trackIdOrOptions;

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
    writeFileSync(
      join(worktreePath, ".worktree-meta.json"),
      JSON.stringify(info, null, 2),
      "utf-8",
    );
    return typeof trackIdOrOptions === "string" ? worktreePath : info;
  } catch (error) {
    releaseTrackLock(lockPath);
    throw error;
  }
}

export function destroyTrackWorktree(trackId: string): void;
export function destroyTrackWorktree(options: CleanupWorktreeOptions): {
  cleaned: boolean;
  trackId: string;
};
export function destroyTrackWorktree(
  trackIdOrOptions: string | CleanupWorktreeOptions,
): void | { cleaned: boolean; trackId: string } {
  const options: CleanupWorktreeOptions =
    typeof trackIdOrOptions === "string" ? { trackId: trackIdOrOptions } : trackIdOrOptions;

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
    try {
      pruneWorktrees(repo, runner);
    } catch {}
    if (shouldDeleteBranch && branchExists(repo, branch, runner)) {
      try {
        gitDeleteBranch(repo, branch, runner);
      } catch {}
    }
    try {
      pruneWorktrees(repo, runner);
    } catch {}
  } finally {
    if (existsSync(worktreePath)) {
      try {
        safeRmSync(worktreePath, {
          allowedRoots: [worktreesRoot],
          allowGitRepositoryDeletion: true,
          missingOk: true,
        });
      } catch {}
    }
    releaseTrackLock(lockPath);
  }

  if (typeof trackIdOrOptions === "string") return;
  return { cleaned: true, trackId: options.trackId };
}

export const cleanupTrackWorktree = destroyTrackWorktree;

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
        const parsed: TrackWorktreeInfo = JSON.parse(readFileSync(metaPath, "utf-8"));
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
