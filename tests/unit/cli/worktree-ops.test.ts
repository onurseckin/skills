import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function seedLedger(run: string): Promise<void> {
  transact(run, "test-seed", "seed-worktree-ledger-for-test", {}, (state) => {
    state.worktree_ledger = {
      harness_branch: "harness/worktree-ops-test",
      base_sha: "0".repeat(40),
      root: ".worktrees",
      worktrees: [],
      assignments: [],
      commits: [],
    };
  });
}

// worktree:reclaim's reclaim step always shells out to real `git worktree prune` regardless of
// whether any worktree needs removing (git-ops.ts's pruneWorktrees has no CLI-exposed injection
// seam here), so its success path genuinely requires a real git repository and a real subprocess —
// a legitimate integration-only surface; see the summary's findings. These tests cover every
// branch worktree-ops.ts itself decides before reaching that call.
describe("worktree:reclaim", () => {
  test("refuses a run with no worktree ledger at all", async () => {
    const { run } = await setupCompiledRun("worktree-reclaim-no-ledger", roots);
    await expect(
      execute(["worktree:reclaim", "--run", run, "--actor", "coordinator"]),
    ).rejects.toThrow(/has no worktree ledger — worktree isolation was never provisioned/);
  });

  test("refuses when worktree_isolation is off in the run's current config", async () => {
    const { run } = await setupCompiledRun("worktree-reclaim-isolation-off", roots);
    await seedLedger(run);
    await expect(
      execute(["worktree:reclaim", "--run", run, "--actor", "coordinator"]),
    ).rejects.toThrow(/worktree_isolation is off in this run's current config/);
  });
});
