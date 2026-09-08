import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { isProcessAlive } from "./lock-cleaner.ts";
import { computeDoctorEnginePassed, type DoctorDiagnosticFinding } from "./types.ts";

import { safeRmSync } from "../../core/shared/safe-fs/index.ts";
import {
  cleanupTrackWorktree,
  destroyOrchestratorWorktree,
  listTrackWorktrees,
} from "../../workflow/worktree/manager.ts";
import { runGit, type GitRunner } from "../../workflow/worktree/git-ops.ts";
import {
  findPrunableWorktrees,
  getGitWorktreePaths,
  isBranchMerged,
  parseTrackLock,
  reconcileUntrackedWorktrees,
} from "./worktree-health-helpers.ts";

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
  readonly tasks?: Readonly<Record<string, unknown>> | null | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
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
  const baseBranch = options.baseBranch ?? "main";
  const issues: string[] = [];
  const repaired: string[] = [];
  const findings: DoctorDiagnosticFinding[] = [];
  const worktreesDir = join(repoRoot, ".olt", "worktrees");
  const locksDir = join(worktreesDir, "locks");

  const addFinding = (
    code: string,
    severity: "WARN" | "ERROR",
    issue: string,
    details?: Record<string, unknown>,
  ) => {
    issues.push(issue);
    findings.push({
      code,
      severity,
      engine: "checkWorktreeHealth",
      message: issue,
      details,
    });
  };

  const gitPaths = new Set(getGitWorktreePaths(repoRoot, runner));
  const rawTrackWorktrees = listTrackWorktrees({ repoRoot, runner });
  const activeTrackWorktrees = rawTrackWorktrees.filter((wt) => {
    const hasMeta = existsSync(join(wt.worktreePath, ".worktree-meta.json"));
    const hasLock = existsSync(wt.lockPath) || existsSync(join(locksDir, `${wt.trackId}.lock`));
    return hasMeta || hasLock || gitPaths.has(resolve(wt.worktreePath));
  });

  for (const wt of activeTrackWorktrees) {
    let isDead = false;
    let lockPid: number | undefined;
    const lockPath = wt.lockPath || join(locksDir, `${wt.trackId}.lock`);

    if (existsSync(lockPath)) {
      const { data: lockData, isCorrupt } = parseTrackLock(lockPath);
      if (isCorrupt) {
        addFinding(
          "WORKTREE_CORRUPTED_METADATA",
          "WARN",
          `Corrupted lock file for worktree '${wt.trackId}'`,
          { trackId: wt.trackId, lockPath },
        );
      } else if (lockData?.pid) {
        lockPid = lockData.pid;
        if (!isProcessAlive(lockPid)) {
          isDead = true;
          const isOrch = wt.tier === "orchestrator" || wt.trackId.startsWith("orch-");
          const entityLabel = isOrch ? "orchestrator" : "track";
          addFinding(
            "WORKTREE_DEAD_PID_LOCK",
            "ERROR",
            `Dead agent PID ${lockPid} holding ${entityLabel} worktree '${wt.trackId}'`,
            { trackId: wt.trackId, lockPid, lockPath },
          );
        }
      }
    }

    const merged = isBranchMerged(repoRoot, wt.branch, baseBranch, runner);
    if (merged) {
      addFinding(
        "WORKTREE_MERGED_NOT_CLEANED",
        "WARN",
        `Track branch '${wt.branch}' for '${wt.trackId}' is merged into ${baseBranch} but not cleaned up`,
        { trackId: wt.trackId, branch: wt.branch },
      );
    } else if (isDead) {
      addFinding(
        "WORKTREE_UNMERGED_DEAD_AGENT_BRANCH",
        "ERROR",
        `Unmerged branch '${wt.branch}' held by dead agent PID ${lockPid ?? "unknown"} in worktree '${wt.trackId}'`,
        { trackId: wt.trackId, branch: wt.branch, lockPid },
      );
    }

    if (autoHeal && (isDead || merged)) {
      try {
        if (wt.tier === "orchestrator" || wt.trackId.startsWith("orch-")) {
          destroyOrchestratorWorktree({
            domain: wt.domain ?? wt.trackId.replace(/^orch-/, ""),
            repoRoot,
            force: true,
            runner,
          });
        } else {
          cleanupTrackWorktree({
            trackId: wt.trackId,
            repoRoot,
            force: true,
            runner,
          });
        }
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

  const trackOnlyActive = activeTrackWorktrees.filter(
    (wt) => wt.tier !== "orchestrator" && !wt.trackId.startsWith("orch-"),
  );
  const trackOnlyRaw = rawTrackWorktrees.filter(
    (wt) => wt.tier !== "orchestrator" && !wt.trackId.startsWith("orch-"),
  );
  reconcileUntrackedWorktrees(trackOnlyActive, trackOnlyRaw, options, addFinding);

  if (existsSync(locksDir)) {
    try {
      for (const file of readdirSync(locksDir)) {
        if (!file.endsWith(".lock")) continue;
        const lockPath = join(locksDir, file);
        const { data: lockData, isCorrupt } = parseTrackLock(lockPath);
        const trackId = file.replace(/\.lock$/, "");
        const isOrphan = !activeTrackWorktrees.some((w) => w.trackId === trackId);
        if (isCorrupt) {
          addFinding("WORKTREE_CORRUPTED_METADATA", "WARN", `Corrupted orphaned lock '${file}'`, {
            file,
            lockPath,
          });
          if (autoHeal) {
            try {
              unlinkSync(lockPath);
              repaired.push(`Removed corrupted lock '${file}'`);
            } catch {}
          }
        } else if (isOrphan && lockData?.pid && !isProcessAlive(lockData.pid)) {
          addFinding(
            "WORKTREE_ORPHANED_LOCK",
            "WARN",
            `Orphaned lock '${file}' with dead PID ${lockData.pid}`,
            { file, lockPath, pid: lockData.pid },
          );
          if (autoHeal) {
            try {
              unlinkSync(lockPath);
              repaired.push(`Removed orphaned lock '${file}'`);
            } catch {}
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
        try {
          if (!statSync(itemPath).isDirectory()) continue;
        } catch {
          continue;
        }
        if (!activeTrackWorktrees.some((w) => w.trackId === item)) {
          addFinding(
            "WORKTREE_ORPHANED_DIR",
            "WARN",
            `Orphaned directory in .olt/worktrees: '${item}'`,
            { item, itemPath },
          );
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

  const prunable = findPrunableWorktrees(repoRoot, runner);
  for (const prunablePath of prunable) {
    addFinding(
      "WORKTREE_PRUNABLE_GIT_ENTRY",
      "WARN",
      `Stale or prunable git worktree entry at '${prunablePath}'`,
      { path: prunablePath },
    );
  }

  if (autoHeal) {
    try {
      runner(repoRoot, ["worktree", "prune"]);
      if (prunable.length > 0)
        repaired.push(`Pruned ${prunable.length} stale git worktree entries`);
    } catch {}
  }

  const cleanupFailed = findings.some((f) => f.code === "WORKTREE_CLEANUP_FAILED");
  const isHealthy = autoHeal ? !cleanupFailed : issues.length === 0;
  const isPassed = autoHeal ? !cleanupFailed : computeDoctorEnginePassed(findings);

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
