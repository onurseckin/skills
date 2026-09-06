import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import {
  cleanupTrackWorktree,
  createOrchestratorWorktree,
  createTrackWorktree,
  destroyOrchestratorWorktree,
  isProcessAlive,
  landTrackToMain,
  listTrackWorktrees,
  resolveRepo,
} from "../../workflow/worktree/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { boolFlag, textFlag, type Flags } from "../options.ts";

export function worktreeCreateCommand(flags: Flags): Record<string, unknown> {
  const tier = textFlag(flags, "tier", false);
  const orchestratorDomain = textFlag(flags, "orchestrator", false);
  const trackId = textFlag(flags, "track", false);
  const baseBranch = textFlag(flags, "base-branch", false);
  const repoRoot = textFlag(flags, "repo-root", false);

  if (tier === "orchestrator" || orchestratorDomain !== undefined) {
    const domain = orchestratorDomain ?? trackId;
    if (!domain) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Missing required domain for orchestrator worktree (--orchestrator <domain> or --track <domain>)",
      );
    }
    const record = createOrchestratorWorktree({ domain, baseBranch, repoRoot });
    const lines = [
      `### Orchestrator Worktree Created: \`${record.domain}\``,
      `- **Worktree Path**: \`${record.worktreePath}\``,
      `- **Branch**: \`${record.branch}\``,
      `- **Base Branch**: \`${record.baseBranch}\``,
      `- **Lock File**: \`${record.lockPath}\``,
      `- **Created At**: ${record.createdAt}`,
    ];
    return {
      markdown: enforceLineLimit(lines.join("\n")),
      tier: "orchestrator",
      domain: record.domain,
      track_id: record.trackId,
      worktree_path: record.worktreePath,
      branch: record.branch,
      base_branch: record.baseBranch,
      lock_path: record.lockPath,
    };
  }

  if (!trackId) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing required flag: --track");
  }

  const record = createTrackWorktree({ trackId, baseBranch, repoRoot });

  const lines = [
    `### Track Worktree Created: \`${record.trackId}\``,
    `- **Worktree Path**: \`${record.worktreePath}\``,
    `- **Branch**: \`${record.branch}\``,
    `- **Base Branch**: \`${record.baseBranch}\``,
    `- **Lock File**: \`${record.lockPath}\``,
    `- **Created At**: ${record.createdAt}`,
  ];

  return {
    markdown: enforceLineLimit(lines.join("\n")),
    track_id: record.trackId,
    worktree_path: record.worktreePath,
    branch: record.branch,
    base_branch: record.baseBranch,
    lock_path: record.lockPath,
  };
}

export function worktreeLandCommand(flags: Flags): Record<string, unknown> {
  const trackId = textFlag(flags, "track", true)!;
  const remote = textFlag(flags, "remote", false);
  const targetBranch = textFlag(flags, "target-branch", false);
  const repoRoot = textFlag(flags, "repo-root", false);
  const releaseHook = !boolFlag(flags, "no-release-hook");

  const result = landTrackToMain({
    trackId,
    remote,
    targetBranch,
    repoRoot,
    releaseHook,
  });

  const lines = [
    `### Track Worktree Landed: \`${result.trackId}\``,
    `- **Commit SHA**: \`${result.commitSha}\``,
    `- **Target Branch**: \`${result.targetBranch}\``,
    `- **Pushed**: ${result.pushed ? "Yes" : "No"}`,
    `- **Cleaned**: ${result.cleaned ? "Yes" : "No"}`,
    `- **Duration**: ${result.durationMs}ms`,
  ];

  return {
    markdown: enforceLineLimit(lines.join("\n")),
    track_id: result.trackId,
    commit_sha: result.commitSha,
    target_branch: result.targetBranch,
    pushed: result.pushed,
    cleaned: result.cleaned,
    torn_down: result.cleaned,
    duration_ms: result.durationMs,
  };
}

export function worktreeListCommand(flags: Flags): Record<string, unknown> {
  const repoRoot = textFlag(flags, "repo-root", false);
  const worktrees = listTrackWorktrees({ repoRoot });

  const lines = [
    `### Active Track Worktrees (${worktrees.length})`,
    ...worktrees.map((wt) => `- \`${wt.trackId}\` (\`${wt.branch}\`) -> \`${wt.worktreePath}\``),
  ];

  return {
    markdown: enforceLineLimit(lines.join("\n")),
    count: worktrees.length,
    worktrees,
  };
}

export function worktreeCleanCommand(flags: Flags): Record<string, unknown> {
  const all = boolFlag(flags, "all");
  const repoRoot = textFlag(flags, "repo-root", false);
  const force = boolFlag(flags, "force");
  const orchestratorDomain = textFlag(flags, "orchestrator", false);
  const tier = textFlag(flags, "tier", false);

  const cleanedRecords: { cleaned: boolean; trackId: string }[] = [];
  const skippedRecords: { skipped: boolean; trackId: string; reason: string }[] = [];

  const repo = resolveRepo(repoRoot);
  const locksDir = join(repo, ".olt", "worktrees", "locks");

  const getActiveHoldingPid = (trackId: string): number | null => {
    const lockPath = join(locksDir, `${trackId}.lock`);
    if (!existsSync(lockPath)) return null;
    try {
      const raw = readFileSync(lockPath, "utf-8");
      const payload = JSON.parse(raw);
      const pid = payload?.pid;
      if (typeof pid === "number" && pid > 0 && isProcessAlive(pid) && pid !== process.pid) {
        return pid;
      }
    } catch {}
    return null;
  };

  if (all) {
    const list = listTrackWorktrees({ repoRoot });
    for (const wt of list) {
      if (!force) {
        const activePid = getActiveHoldingPid(wt.trackId);
        if (activePid !== null) {
          skippedRecords.push({
            skipped: true,
            trackId: wt.trackId,
            reason: `Active process PID ${activePid} holds worktree lock`,
          });
          continue;
        }
      }
      if (wt.tier === "orchestrator" || wt.trackId.startsWith("orch-")) {
        const res = destroyOrchestratorWorktree({
          domain: wt.domain ?? wt.trackId.replace(/^orch-/, ""),
          repoRoot,
          force,
        });
        cleanedRecords.push({ cleaned: res.cleaned, trackId: res.trackId });
      } else {
        const res = cleanupTrackWorktree({ trackId: wt.trackId, repoRoot, force });
        cleanedRecords.push(res);
      }
    }
  } else if (tier === "orchestrator" || orchestratorDomain !== undefined) {
    const rawDomain = orchestratorDomain ?? textFlag(flags, "track", true)!;
    const domain = rawDomain.startsWith("orch-") ? rawDomain.slice(5) : rawDomain;
    const trackId = `orch-${domain}`;
    if (!force) {
      const activePid = getActiveHoldingPid(trackId);
      if (activePid !== null) {
        throw new HarnessError(
          "WORKTREE_ACTIVE",
          `Cannot teardown worktree ${trackId}: held by active process PID ${activePid}`,
        );
      }
    }
    const res = destroyOrchestratorWorktree({ domain, repoRoot, force });
    cleanedRecords.push({ cleaned: res.cleaned, trackId: res.trackId });
  } else {
    const trackId = textFlag(flags, "track", true)!;
    if (!force) {
      const activePid = getActiveHoldingPid(trackId);
      if (activePid !== null) {
        throw new HarnessError(
          "WORKTREE_ACTIVE",
          `Cannot teardown worktree ${trackId}: held by active process PID ${activePid}`,
        );
      }
    }
    const res = cleanupTrackWorktree({ trackId, repoRoot, force });
    cleanedRecords.push(res);
  }

  const lines = [
    `### Worktrees Cleaned (${cleanedRecords.length})`,
    ...cleanedRecords.map((c) => `- Cleaned \`${c.trackId}\``),
    ...(skippedRecords.length > 0
      ? [
          `### Worktrees Skipped (${skippedRecords.length})`,
          ...skippedRecords.map((s) => `- Skipped active \`${s.trackId}\` (${s.reason})`),
        ]
      : []),
  ];

  return {
    markdown: enforceLineLimit(lines.join("\n")),
    count: cleanedRecords.length,
    cleaned: cleanedRecords,
    skipped: skippedRecords,
  };
}

export function worktreeStatusCommand(flags: Flags): Record<string, unknown> {
  const trackId = textFlag(flags, "track", false);
  const repoRoot = textFlag(flags, "repo-root", false);
  const worktrees = listTrackWorktrees({ repoRoot });

  if (trackId) {
    const match = worktrees.find((w) => w.trackId === trackId);
    if (!match) {
      return {
        markdown: enforceLineLimit(`Track worktree \`${trackId}\` is not active.`),
        active: false,
        track_id: trackId,
      };
    }
    return {
      markdown: enforceLineLimit(
        `Track worktree \`${trackId}\` is active at \`${match.worktreePath}\`.`,
      ),
      active: true,
      worktree: match,
    };
  }

  return {
    markdown: enforceLineLimit(`Total active track worktrees: ${worktrees.length}`),
    active_count: worktrees.length,
    worktrees,
  };
}

export { worktreeReclaimCommand } from "./worktree-reclaim-ops.ts";
