import { getHarnessConfig } from "../../core/config/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { loadRun } from "../../engine/store/index.ts";
import { readWorktreeLedger } from "../../workflow/worktree/ledger.ts";
import { reclaimOrphanedWorktrees, recordReclaim } from "../../workflow/worktree/reclaim.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type Flags } from "../options.ts";

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
