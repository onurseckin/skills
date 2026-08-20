import { resolve } from "node:path";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun } from "../../store/index.ts";
import { readWorktreeLedger } from "../../workflow/worktree/ledger.ts";
import { reclaimOrphanedWorktrees, recordReclaim } from "../../workflow/worktree/reclaim.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type Flags } from "../options.ts";

/**
 * B22.6: reclaims an abandoned run's worktree directories — the same reasoning as `recover` for
 * stale leases, but nothing here is time-based. A run that crashed mid-way leaves its worktrees
 * intact deliberately (B22.6: "cleanup is explicit, never implicit on failure"), so this only ever
 * runs when a human decided, after looking, that the run is not being resumed.
 */
export function worktreeReclaimCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;
  const repoRoot = resolve(run, "..", "..");
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
  // A terminal run (completed, most likely after a consolidation conflict left worktrees behind —
  // see consolidate.ts) can never accept another `transact` write, the same guarantee B22.4's own
  // reordering respects. The physical removal above still happened and is real; only the ledger's
  // record of it is skipped, same idiom the rest of the codebase uses to read this off state
  // directly (no shared helper exists for it — see complete-run.ts's own inline check).
  //
  // `loadRun` returns `RunState` (contracts/capsule.ts), which leaves `completion_result` untyped
  // on the `JsonObject` index signature — unlike `WorkflowState` (workflow/types.ts), it carries no
  // narrower field, so `.status` needs the same manual narrowing transaction.ts's `isTerminal` uses.
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
