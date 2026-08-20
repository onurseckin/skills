import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { loadRun } from "../../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { readWorktreeLedger } from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/ledger.ts";
import {
  reclaimOrphanedWorktrees,
  recordReclaim,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/reclaim.ts";
import { addTask, cleanupRoots, compile, worktreeCapsule } from "./fixture.ts";

const roots: string[] = [];
afterEach(() => cleanupRoots(roots));

describe("reclaimOrphanedWorktrees (B22.6)", () => {
  test("removes an abandoned run's worktree directories but leaves the branches intact", async () => {
    const fixture = await worktreeCapsule(roots, "reclaim-basic");
    await addTask(fixture, "t1", "src/a");
    await addTask(fixture, "t2", "src/b");
    await compile(fixture);

    const ledgerBefore = readWorktreeLedger(loadRun(fixture.run).state)!;
    expect(ledgerBefore.worktrees.length).toBe(2);
    for (const worktree of ledgerBefore.worktrees) expect(existsSync(worktree.path)).toBe(true);

    const outcome = reclaimOrphanedWorktrees({ repoRoot: fixture.repo, ledger: ledgerBefore });
    expect(new Set(outcome.reclaimed_worktree_ids)).toEqual(
      new Set(ledgerBefore.worktrees.map((w) => w.id)),
    );
    for (const worktree of ledgerBefore.worktrees) expect(existsSync(worktree.path)).toBe(false);

    // The branches — the only place an abandoned run's work still exists — are never touched.
    const { spawnSync } = await import("node:child_process");
    const branchList = spawnSync("git", ["branch", "--list", `harness/${basename(fixture.run)}*`], {
      cwd: fixture.repo,
      encoding: "utf8",
    }).stdout;
    for (const worktree of ledgerBefore.worktrees) expect(branchList).toContain(worktree.branch);
    expect(branchList).toContain(ledgerBefore.harness_branch);

    recordReclaim(fixture.run, "coordinator", outcome);
    const ledgerAfter = readWorktreeLedger(loadRun(fixture.run).state)!;
    expect(ledgerAfter.worktrees).toEqual([]);
  });

  test("skips a directory a human already removed by hand, without erroring", async () => {
    const fixture = await worktreeCapsule(roots, "reclaim-manual-rm");
    await addTask(fixture, "t1", "src/a");
    await compile(fixture);

    const ledger = readWorktreeLedger(loadRun(fixture.run).state)!;
    const worktree = ledger.worktrees[0]!;
    // Simulates a human deleting the checkout directly instead of through the harness.
    rmSync(worktree.path, { recursive: true, force: true });

    const outcome = reclaimOrphanedWorktrees({ repoRoot: fixture.repo, ledger });
    // Nothing to remove through git (the directory was already gone); `pruneWorktrees` inside the
    // function is what clears git's own now-stale administrative record for it.
    expect(outcome.reclaimed_worktree_ids).toEqual([]);
  });
});
