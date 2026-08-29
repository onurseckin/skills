import { existsSync, statSync, unlinkSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { isProcessAlive } from "./lock-cleaner.ts";
import type { DoctorDiagnosticFinding, GitIndexIntegrityReport } from "./types.ts";

export interface GitIndexCheckOptions {
  readonly repoRoot?: string | undefined;
}

export interface AutoHealGitStateOptions {
  readonly repoRoot?: string | undefined;
  readonly stageModified?: boolean | undefined;
  readonly cleanIndexLock?: boolean | undefined;
}

/**
 * Checks Git index integrity, detecting stale .git/index.lock, uncommitted artifacts, and stash health.
 */
export function checkGitIndexIntegrity(
  options: GitIndexCheckOptions = {},
): GitIndexIntegrityReport {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const findings: DoctorDiagnosticFinding[] = [];
  const gitDir = join(repoRoot, ".git");

  if (!existsSync(gitDir)) {
    return {
      healthy: true,
      staleIndexLockPresent: false,
      uncommittedArtifacts: [],
      stashCorrupted: false,
      findings: [],
    };
  }

  let staleIndexLockPresent = false;
  let staleIndexLockPath: string | undefined;
  let deadLockPid: number | undefined;

  // 1. Check for .git/index.lock
  const indexLockPath = join(gitDir, "index.lock");
  if (existsSync(indexLockPath)) {
    staleIndexLockPath = indexLockPath;
    try {
      const stats = statSync(indexLockPath);
      const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;

      let lockPid: number | undefined;
      try {
        const content = readFileSync(indexLockPath, "utf-8").trim();
        const parsed = Number.parseInt(content, 10);
        if (Number.isInteger(parsed) && parsed > 0) {
          lockPid = parsed;
        }
      } catch {
        // Unparseable PID
      }

      if (lockPid !== undefined) {
        if (!isProcessAlive(lockPid)) {
          deadLockPid = lockPid;
          staleIndexLockPresent = true;
        }
      } else if (ageSeconds > 120) {
        // Lock older than 2 minutes without active PID
        staleIndexLockPresent = true;
      }

      if (staleIndexLockPresent) {
        findings.push({
          code: "GIT_STALE_INDEX_LOCK_DETECTED",
          severity: "ERROR",
          engine: "checkGitIndexIntegrity",
          message: `Stale .git/index.lock detected${deadLockPid ? ` (dead PID ${deadLockPid})` : ` (age ${Math.round(ageSeconds)}s)`}`,
          details: { indexLockPath, ageSeconds, deadLockPid },
        });
      }
    } catch {
      // Ignore stat error
    }
  }

  // 2. Check for unstaged modifications
  const uncommittedArtifacts: string[] = [];
  try {
    const statusResult = spawnSync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 5000,
    });
    if (statusResult.status === 0 && statusResult.stdout) {
      const lines = statusResult.stdout.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const file = line.slice(3).trim();
        if (file) uncommittedArtifacts.push(file);
      }
    }
  } catch {
    // Git status probe failed
  }

  // 3. Check stash integrity
  let stashCorrupted = false;
  try {
    const stashResult = spawnSync("git", ["stash", "list"], {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 5000,
    });
    if (stashResult.status !== 0 && stashResult.status !== null) {
      const stderr = stashResult.stderr || "";
      if (
        !stderr.includes("not a git repository") &&
        !stderr.includes("does not have any commits") &&
        !stderr.includes("You do not have the initial commit")
      ) {
        stashCorrupted = true;
        findings.push({
          code: "GIT_STASH_CORRUPTION_DETECTED",
          severity: "ERROR",
          engine: "checkGitIndexIntegrity",
          message: `Git stash verification failed: ${stderr || "non-zero exit code"}`,
        });
      }
    }
  } catch {
    // Stash check failed
  }

  const healthy = findings.filter((f) => f.severity === "ERROR").length === 0;

  return {
    healthy,
    staleIndexLockPresent,
    ...(staleIndexLockPath ? { staleIndexLockPath } : {}),
    ...(deadLockPid ? { deadLockPid } : {}),
    uncommittedArtifacts,
    stashCorrupted,
    findings,
  };
}

/**
 * Automatically repairs Git index lock issues and auto-stages uncommitted artifacts (`git add -A`)
 * for sub-domain completion reflog safety.
 */
export function autoHealGitState(options: AutoHealGitStateOptions = {}): {
  readonly indexLockCleaned: boolean;
  readonly stagedFiles: readonly string[];
} {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const cleanIndexLock = options.cleanIndexLock ?? true;
  const stageModified = options.stageModified ?? true;

  let indexLockCleaned = false;
  const stagedFiles: string[] = [];

  const gitDir = join(repoRoot, ".git");
  if (!existsSync(gitDir)) {
    return { indexLockCleaned, stagedFiles };
  }

  // 1. Clean dead .git/index.lock
  if (cleanIndexLock) {
    const indexLockPath = join(gitDir, "index.lock");
    if (existsSync(indexLockPath)) {
      try {
        const stats = statSync(indexLockPath);
        const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;
        let shouldUnlink = false;

        try {
          const content = readFileSync(indexLockPath, "utf-8").trim();
          const parsed = Number.parseInt(content, 10);
          if (Number.isInteger(parsed) && parsed > 0) {
            if (!isProcessAlive(parsed)) {
              shouldUnlink = true;
            }
          }
        } catch {
          // Ignore
        }

        if (ageSeconds > 120 || shouldUnlink) {
          unlinkSync(indexLockPath);
          indexLockCleaned = true;
        }
      } catch {
        // Ignore unlink error
      }
    }
  }

  // 2. Auto-stage changes for reflog safety
  if (stageModified) {
    try {
      const addResult = spawnSync("git", ["add", "-A"], {
        cwd: repoRoot,
        encoding: "utf-8",
        timeout: 10000,
      });
      if (addResult.status === 0) {
        const statusResult = spawnSync("git", ["diff", "--cached", "--name-only"], {
          cwd: repoRoot,
          encoding: "utf-8",
          timeout: 5000,
        });
        if (statusResult.status === 0 && statusResult.stdout) {
          const lines = statusResult.stdout
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          stagedFiles.push(...lines);
        }
      }
    } catch {
      // Ignore git add failure
    }
  }

  return { indexLockCleaned, stagedFiles };
}
