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
  readonly engine: string;
  readonly healthy: boolean;
  readonly passed: boolean;
  readonly issues: readonly string[];
  readonly repaired: readonly string[];
  readonly findings: readonly DoctorDiagnosticFinding[];
  readonly autoHealed?: readonly string[];
}

export type DoctorCheckResult = DoctorWorktreeHealthReport;

export interface WorktreeHealthOptions {
  readonly repoRoot?: string | undefined;
  readonly autoHeal?: boolean | undefined;
  readonly runner?: GitRunner | undefined;
  readonly baseBranch?: string | undefined;
}

interface ParsedLockFile {
  readonly pid?: number;
  readonly trackId?: string;
  readonly created_at?: string;
  readonly createdAt?: string;
}

function parseTrackLock(lockPath: string): { readonly data: ParsedLockFile | null; readonly isCorrupt: boolean } {
  try {
    if (!existsSync(lockPath)) return { data: null, isCorrupt: false };
    const content = readFileSync(lockPath, "utf8").trim();
    if (!content) return { data: null, isCorrupt: true };
    const data = JSON.parse(content) as ParsedLockFile;
    if (typeof data !== "object" || data === null) return { data: null, isCorrupt: true };
    return { data, isCorrupt: false };
  } catch {
    return { data: null, isCorrupt: true };
  }
}

function isBranchMerged(
  repoRoot: string,
  branch: string,
  baseBranch = "main",
  runner = runGit,
): boolean {
  try {
    const result = runner(repoRoot, ["branch", "--merged", baseBranch]);
    if (result.status !== 0) return false;
    const branches = result.stdout.split("\n").map((b) => b.trim().replace(/^[*+]\s+/, ""));
    return branches.includes(branch);
  } catch {
    return false;
  }
}

function getGitWorktreePaths(repoRoot: string, runner = runGit): readonly string[] {
  try {
    const res = runner(repoRoot, ["worktree", "list", "--porcelain"]);
    if (res.status !== 0) return [];
    return res.stdout
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => resolve(l.slice("worktree ".length).trim()));
  } catch {
    return [];
  }
}

function findPrunableWorktrees(repoRoot: string, runner = runGit): readonly string[] {
  const prunable: string[] = [];
  try {
    const result = runner(repoRoot, ["worktree", "list", "--porcelain"]);
    if (result.status !== 0) return prunable;
    let currentPath = "";
    let isPrunable = false;
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice("worktree ".length).trim();
        isPrunable = false;
      } else if (line.startsWith("prunable")) {
        isPrunable = true;
      } else if (line === "" && currentPath) {
        if (isPrunable || (!existsSync(currentPath) && currentPath.includes(".olt"))) prunable.push(currentPath);
        currentPath = "";
        isPrunable = false;
      }
    }
    if (currentPath && (isPrunable || (!existsSync(currentPath) && currentPath.includes(".olt")))) {
      prunable.push(currentPath);
    }
  } catch {}
  return prunable;
}

export function checkWorktreeHealth(
  optionsOrRepoRoot?: string | WorktreeHealthOptions,
): DoctorWorktreeHealthReport {
  const options: WorktreeHealthOptions =
    typeof optionsOrRepoRoot === "string" ? { repoRoot: optionsOrRepoRoot } : (optionsOrRepoRoot ?? {});
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const runner = options.runner ?? runGit;
  const autoHeal = options.autoHeal ?? false;
  const baseBranch = options.baseBranch ?? "main";

  const issues: string[] = [];
  const repaired: string[] = [];
  const findings: DoctorDiagnosticFinding[] = [];
  const worktreesDir = join(repoRoot, ".olt", "worktrees");
  const locksDir = join(worktreesDir, "locks");

  const gitPaths = new Set(getGitWorktreePaths(repoRoot, runner));
  const rawTrackWorktrees = listTrackWorktrees({ repoRoot, runner });
  const activeTrackWorktrees = rawTrackWorktrees.filter((wt) => {
    const hasMeta = existsSync(join(wt.worktreePath, ".worktree-meta.json"));
    const hasLock = existsSync(wt.lockPath) || existsSync(join(locksDir, `${wt.trackId}.lock`));
    const inGit = gitPaths.has(resolve(wt.worktreePath));
    return hasMeta || hasLock || inGit;
  });

  for (const wt of activeTrackWorktrees) {
    let isDead = false;
    let lockPid: number | undefined;
    const lockPath = wt.lockPath || join(locksDir, `${wt.trackId}.lock`);

    if (existsSync(lockPath)) {
      const { data: lockData, isCorrupt } = parseTrackLock(lockPath);
      if (isCorrupt) {
        const issue = `Corrupted lock file for worktree '${wt.trackId}'`;
        issues.push(issue);
        findings.push({ code: "WORKTREE_CORRUPTED_METADATA", severity: "WARN", engine: "checkWorktreeHealth", message: issue, details: { trackId: wt.trackId, lockPath } });
      } else if (lockData?.pid) {
        lockPid = lockData.pid;
        if (!isProcessAlive(lockPid)) {
          isDead = true;
          const issue = `Dead agent PID ${lockPid} holding track worktree '${wt.trackId}'`;
          issues.push(issue);
          findings.push({ code: "WORKTREE_DEAD_PID_LOCK", severity: "ERROR", engine: "checkWorktreeHealth", message: issue, details: { trackId: wt.trackId, lockPid, lockPath } });
        }
      }
    }

    const merged = isBranchMerged(repoRoot, wt.branch, baseBranch, runner);
    if (merged) {
      const issue = `Track branch '${wt.branch}' for '${wt.trackId}' is merged into ${baseBranch} but not cleaned up`;
      issues.push(issue);
      findings.push({ code: "WORKTREE_MERGED_NOT_CLEANED", severity: "WARN", engine: "checkWorktreeHealth", message: issue, details: { trackId: wt.trackId, branch: wt.branch } });
    } else if (isDead) {
      const issue = `Unmerged branch '${wt.branch}' held by dead agent PID ${lockPid ?? "unknown"} in worktree '${wt.trackId}'`;
      issues.push(issue);
      findings.push({ code: "WORKTREE_UNMERGED_DEAD_AGENT_BRANCH", severity: "ERROR", engine: "checkWorktreeHealth", message: issue, details: { trackId: wt.trackId, branch: wt.branch, lockPid } });
    }

    if (autoHeal && (isDead || merged)) {
      try {
        cleanupTrackWorktree({ trackId: wt.trackId, repoRoot, force: true, runner });
        repaired.push(`Cleaned up worktree '${wt.trackId}'`);
      } catch (err) {
        findings.push({ code: "WORKTREE_CLEANUP_FAILED", severity: "ERROR", engine: "checkWorktreeHealth", message: `Failed to auto-heal worktree '${wt.trackId}': ${String(err)}`, details: { trackId: wt.trackId } });
      }
    }
  }

  if (existsSync(locksDir)) {
    try {
      for (const file of readdirSync(locksDir)) {
        if (!file.endsWith(".lock")) continue;
        const lockPath = join(locksDir, file);
        const { data: lockData, isCorrupt } = parseTrackLock(lockPath);
        const trackId = file.replace(/\.lock$/, "");
        const isOrphan = !activeTrackWorktrees.some((w) => w.trackId === trackId);
        if (isCorrupt) {
          const issue = `Corrupted orphaned lock '${file}'`;
          issues.push(issue);
          findings.push({ code: "WORKTREE_CORRUPTED_METADATA", severity: "WARN", engine: "checkWorktreeHealth", message: issue, details: { file, lockPath } });
          if (autoHeal) {
            try { unlinkSync(lockPath); repaired.push(`Removed corrupted lock '${file}'`); } catch {}
          }
        } else if (isOrphan && lockData?.pid && !isProcessAlive(lockData.pid)) {
          const issue = `Orphaned lock '${file}' with dead PID ${lockData.pid}`;
          issues.push(issue);
          findings.push({ code: "WORKTREE_ORPHANED_LOCK", severity: "WARN", engine: "checkWorktreeHealth", message: issue, details: { file, lockPath, pid: lockData.pid } });
          if (autoHeal) {
            try { unlinkSync(lockPath); repaired.push(`Removed orphaned lock '${file}'`); } catch {}
          }
        }
      }
    } catch {}
  }

  if (existsSync(worktreesDir)) {
    try {
      for (const item of readdirSync(worktreesDir)) {
        if (item === "locks" || item.startsWith(".")) continue;
        const itemPath = join(worktreesDir, item);
        try { if (!statSync(itemPath).isDirectory()) continue; } catch { continue; }
        if (!activeTrackWorktrees.some((w) => w.trackId === item)) {
          const issue = `Orphaned directory in .olt/worktrees: '${item}'`;
          issues.push(issue);
          findings.push({ code: "WORKTREE_ORPHANED_DIR", severity: "WARN", engine: "checkWorktreeHealth", message: issue, details: { item, itemPath } });
          if (autoHeal) {
            try {
              safeRmSync(itemPath, { allowedRoots: [worktreesDir], allowGitRepositoryDeletion: true, missingOk: true });
              repaired.push(`Removed orphaned worktree dir '${item}'`);
            } catch {}
          }
        }
      }
    } catch {}
  }

  const prunable = findPrunableWorktrees(repoRoot, runner);
  for (const prunablePath of prunable) {
    const issue = `Stale or prunable git worktree entry at '${prunablePath}'`;
    issues.push(issue);
    findings.push({ code: "WORKTREE_PRUNABLE_GIT_ENTRY", severity: "WARN", engine: "checkWorktreeHealth", message: issue, details: { path: prunablePath } });
  }

  if (autoHeal) {
    try {
      runner(repoRoot, ["worktree", "prune"]);
      if (prunable.length > 0) repaired.push(`Pruned ${prunable.length} stale git worktree entries`);
    } catch {}
  }

  const cleanupFailed = findings.some((f) => f.code === "WORKTREE_CLEANUP_FAILED");
  const isHealthy = autoHeal ? !cleanupFailed : issues.length === 0;
  const isPassed = autoHeal ? !cleanupFailed : findings.filter((f) => f.severity === "ERROR").length === 0;

  return {
    name: "worktree_health",
    engine: "checkWorktreeHealth",
    healthy: isHealthy,
    passed: isPassed,
    issues,
    repaired,
    findings,
    autoHealed: repaired,
  };
}

export function autoHealWorktreeState(
  options: WorktreeHealthOptions = {},
): DoctorWorktreeHealthReport {
  return checkWorktreeHealth({ ...options, autoHeal: true });
}
