import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { isProcessAlive } from "./lock-cleaner.ts";
import type { DoctorDiagnosticFinding } from "./types.ts";
import { safeRmSync } from "../../core/shared/safe-fs/index.ts";
import {
  cleanupTrackWorktree,
  listTrackWorktrees,
  type TrackWorktreeInfo,
} from "../../workflow/worktree/manager.ts";
import { runGit, type GitRunner } from "../../workflow/worktree/git-ops.ts";

export interface DoctorWorktreeHealthReport {
  readonly name: string;
  readonly healthy: boolean;
  readonly issues: readonly string[];
  readonly repaired: readonly string[];
  readonly findings: readonly DoctorDiagnosticFinding[];
}

export interface WorktreeHealthOptions {
  readonly repoRoot?: string | undefined;
  readonly autoHeal?: boolean | undefined;
  readonly runner?: GitRunner | undefined;
}

interface ParsedLockFile {
  readonly pid?: number;
  readonly trackId?: string;
  readonly created_at?: string;
}

function parseTrackLock(lockPath: string): ParsedLockFile | null {
  try {
    if (!existsSync(lockPath)) return null;
    const content = readFileSync(lockPath, "utf8").trim();
    return JSON.parse(content) as ParsedLockFile;
  } catch {
    return null;
  }
}

function isBranchMerged(
  repoRoot: string,
  branch: string,
  baseBranch = "main",
  runner = runGit,
): boolean {
  const result = runner(repoRoot, ["branch", "--merged", baseBranch]);
  if (result.status !== 0) return false;
  const branches = result.stdout.split("\n").map((b) => b.trim().replace(/^[*+]\s+/, ""));
  return branches.includes(branch);
}

export function checkWorktreeHealth(
  optionsOrRepoRoot?: string | WorktreeHealthOptions,
): DoctorWorktreeHealthReport {
  const options: WorktreeHealthOptions =
    typeof optionsOrRepoRoot === "string"
      ? { repoRoot: optionsOrRepoRoot }
      : (optionsOrRepoRoot ?? {});

  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const runner = options.runner ?? runGit;
  const autoHeal = options.autoHeal ?? false;

  const issues: string[] = [];
  const repaired: string[] = [];
  const findings: DoctorDiagnosticFinding[] = [];

  const worktreesDir = join(repoRoot, ".olt", "worktrees");
  const locksDir = join(worktreesDir, "locks");

  const activeTrackWorktrees: readonly TrackWorktreeInfo[] = listTrackWorktrees({
    repoRoot,
    runner,
  });

  for (const wt of activeTrackWorktrees) {
    let isDead = false;
    let lockPid: number | undefined;

    if (existsSync(wt.lockPath)) {
      const lockData = parseTrackLock(wt.lockPath);
      if (lockData?.pid) {
        lockPid = lockData.pid;
        if (!isProcessAlive(lockPid)) {
          isDead = true;
          const issue = `Dead agent PID ${lockPid} holding track worktree '${wt.trackId}'`;
          issues.push(issue);
          findings.push({
            code: "WORKTREE_DEAD_PID_LOCK",
            severity: "ERROR",
            engine: "checkWorktreeHealth",
            message: issue,
            details: { trackId: wt.trackId, lockPid, lockPath: wt.lockPath },
          });
        }
      }
    }

    const merged = isBranchMerged(repoRoot, wt.branch, "main", runner);
    if (merged) {
      const issue = `Track branch '${wt.branch}' for '${wt.trackId}' is merged into main but not cleaned up`;
      issues.push(issue);
      findings.push({
        code: "WORKTREE_MERGED_NOT_CLEANED",
        severity: "WARN",
        engine: "checkWorktreeHealth",
        message: issue,
        details: { trackId: wt.trackId, branch: wt.branch },
      });
    }

    if (autoHeal && (isDead || merged)) {
      try {
        cleanupTrackWorktree({
          trackId: wt.trackId,
          repoRoot,
          force: true,
          runner,
        });
        repaired.push(`Cleaned up worktree '${wt.trackId}'`);
      } catch (err) {
        findings.push({
          code: "WORKTREE_CLEANUP_FAILED",
          severity: "ERROR",
          engine: "checkWorktreeHealth",
          message: `Failed to auto-heal worktree '${wt.trackId}': ${String(err)}`,
          details: { trackId: wt.trackId },
        });
      }
    }
  }

  if (existsSync(locksDir)) {
    try {
      const lockFiles = readdirSync(locksDir);
      for (const file of lockFiles) {
        if (!file.endsWith(".lock")) continue;
        const lockPath = join(locksDir, file);
        const lockData = parseTrackLock(lockPath);
        if (lockData?.pid && !isProcessAlive(lockData.pid)) {
          const trackId = file.replace(/\.lock$/, "");
          if (!activeTrackWorktrees.some((w) => w.trackId === trackId)) {
            const issue = `Orphaned lock '${file}' with dead PID ${lockData.pid}`;
            issues.push(issue);
            findings.push({
              code: "WORKTREE_ORPHANED_LOCK",
              severity: "WARN",
              engine: "checkWorktreeHealth",
              message: issue,
              details: { file, lockPath, pid: lockData.pid },
            });
            if (autoHeal) {
              try {
                unlinkSync(lockPath);
                repaired.push(`Removed orphaned lock '${file}'`);
              } catch {}
            }
          }
        }
      }
    } catch {}
  }

  if (existsSync(worktreesDir)) {
    try {
      const items = readdirSync(worktreesDir);
      for (const item of items) {
        if (item === "locks" || item.startsWith(".")) continue;
        const itemPath = join(worktreesDir, item);
        try {
          if (!statSync(itemPath).isDirectory()) continue;
        } catch {
          continue;
        }
        if (!activeTrackWorktrees.some((w) => w.trackId === item)) {
          const issue = `Orphaned directory in .olt/worktrees: '${item}'`;
          issues.push(issue);
          findings.push({
            code: "WORKTREE_ORPHANED_DIR",
            severity: "WARN",
            engine: "checkWorktreeHealth",
            message: issue,
            details: { item, itemPath },
          });
          if (autoHeal) {
            try {
              safeRmSync(itemPath, {
                allowedRoots: [worktreesDir],
                allowGitRepositoryDeletion: true,
                missingOk: true,
              });
              repaired.push(`Removed orphaned worktree dir '${item}'`);
            } catch {}
          }
        }
      }
    } catch {}
  }

  if (autoHeal) {
    try {
      runner(repoRoot, ["worktree", "prune"]);
    } catch {}
  }

  return {
    name: "worktree_health",
    healthy: issues.length === 0 || (autoHeal && repaired.length >= issues.length),
    issues,
    repaired,
    findings,
  };
}

export function autoHealWorktreeState(
  options: WorktreeHealthOptions = {},
): DoctorWorktreeHealthReport {
  return checkWorktreeHealth({ ...options, autoHeal: true });
}
