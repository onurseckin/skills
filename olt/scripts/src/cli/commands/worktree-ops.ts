import { getHarnessConfig } from "../../core/config/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { loadRun } from "../../engine/store/index.ts";
import {
  cleanupTrackWorktree,
  createTrackWorktree,
  landTrackToMain,
  listTrackWorktrees,
  readWorktreeLedger,
  reclaimOrphanedWorktrees,
  recordReclaim,
} from "../../workflow/worktree/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { boolFlag, textFlag, type Flags } from "../options.ts";

export function worktreeCreateCommand(flags: Flags): Record<string, unknown> {
  const trackId = textFlag(flags, "track", true)!;
  const baseBranch = textFlag(flags, "base-branch", false);
  const repoRoot = textFlag(flags, "repo-root", false);

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
  const force = !boolFlag(flags, "no-force");

  const cleanedRecords: { cleaned: boolean; trackId: string }[] = [];

  if (all) {
    const list = listTrackWorktrees({ repoRoot });
    for (const wt of list) {
      const res = cleanupTrackWorktree({ trackId: wt.trackId, repoRoot, force });
      cleanedRecords.push(res);
    }
  } else {
    const trackId = textFlag(flags, "track", true)!;
    const res = cleanupTrackWorktree({ trackId, repoRoot, force });
    cleanedRecords.push(res);
  }

  const lines = [
    `### Track Worktrees Cleaned (${cleanedRecords.length})`,
    ...cleanedRecords.map((c) => `- Cleaned track \`${c.trackId}\``),
  ];

  return {
    markdown: enforceLineLimit(lines.join("\n")),
    count: cleanedRecords.length,
    cleaned: cleanedRecords,
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

export function worktreeReclaimCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;
  const repoRoot = findRepoRoot(run);
  const config = getHarnessConfig(repoRoot, run);
  const ledger = readWorktreeLedger(loadRun(run).state);
  if (!ledger) {
    throw new HarnessError(
      "INVALID_STATE",
      `${run} has no worktree ledger — worktree isolation was never provisioned for this run`,
    );
  }
  if (!config.worktree_isolation) {
    throw new HarnessError(
      "INVALID_STATE",
      "worktree_isolation is off in this run's current config; reclaim would remove worktrees a live run may still need — turn isolation back on, or remove them by hand",
    );
  }

  const outcome = reclaimOrphanedWorktrees({ repoRoot, ledger });
  const completionResult = loadRun(run).state.completion_result;
  const sealed =
    typeof completionResult === "object" &&
    completionResult !== null &&
    !Array.isArray(completionResult) &&
    completionResult.status === "complete";
  const recorded = outcome.reclaimed_worktree_ids.length > 0 && !sealed;
  if (recorded) recordReclaim(run, actor, outcome);

  const lines = [
    `### Worktrees Reclaimed: \`${run}\``,
    `- **Actor**: ${actor}`,
    `- **Branch**: \`${ledger.harness_branch}\` — left intact; only the worktree directories were removed`,
    `- **Zero-Destructive Git Invariant**: Active — uncommitted working tree diffs and user manual edits preserved`,
    `- **Reclaimed**: ${outcome.reclaimed_worktree_ids.length}`,
    ...outcome.reclaimed_worktree_ids.map((id) => `  - \`${id}\``),
    ...(outcome.reclaimed_worktree_ids.length > 0 && sealed
      ? [
          `- **Note**: this run is already sealed — the directories are gone, but the worktree ledger inside the capsule cannot be updated to say so.`,
        ]
      : []),
  ];
  return {
    markdown: enforceLineLimit(lines.join("\n")),
    run_root: run,
    reclaimed_worktree_ids: outcome.reclaimed_worktree_ids,
    harness_branch: ledger.harness_branch,
    ledger_updated: recorded,
  };
}
