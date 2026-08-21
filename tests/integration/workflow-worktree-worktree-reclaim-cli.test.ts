import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { readWorktreeLedger } from "../../orchestrating-long-tasks/scripts/src/workflow/worktree/ledger.ts";
import { HarnessError } from "../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  addTask,
  cleanupRoots,
  compile,
  worktreeCapsule,
} from "../unit/workflow/worktree/fixture.ts";

const roots: string[] = [];
afterEach(() => cleanupRoots(roots));

describe("worktree:reclaim (B22.6)", () => {
  test("frees an abandoned run's worktrees through the CLI", async () => {
    const fixture = await worktreeCapsule(roots, "reclaim-cli");
    await addTask(fixture, "t1", "src/a");
    await addTask(fixture, "t2", "src/b");
    await compile(fixture);
    const before = readWorktreeLedger(loadRun(fixture.run).state)!;

    const result = await execute([
      "worktree:reclaim",
      "--run",
      fixture.run,
      "--actor",
      "coordinator",
    ]);

    expect(new Set(result.reclaimed_worktree_ids as string[])).toEqual(
      new Set(before.worktrees.map((w) => w.id)),
    );
    for (const worktree of before.worktrees) expect(existsSync(worktree.path)).toBe(false);
    expect(readWorktreeLedger(loadRun(fixture.run).state)!.worktrees).toEqual([]);
  });

  test("still removes directories for an already-sealed run, without touching its terminal ledger", async () => {
    const fixture = await worktreeCapsule(roots, "reclaim-cli-sealed");
    await addTask(fixture, "t1", "src/a");
    await compile(fixture);
    const before = readWorktreeLedger(loadRun(fixture.run).state)!;

    // Simulate a run sealed while a consolidation conflict left worktrees behind (run:complete
    // itself never blocks on that — see consolidate.ts) without driving the full completion
    // flow: write the terminal marker directly onto the same state shape completeRun produces.
    const { transact } = await import("../../orchestrating-long-tasks/scripts/src/store/index.ts");
    transact(fixture.run, "test-harness", "test-seal", {}, (draft) => {
      draft.completion_result = { status: "complete" };
    });

    const result = await execute([
      "worktree:reclaim",
      "--run",
      fixture.run,
      "--actor",
      "coordinator",
    ]);

    expect(result.reclaimed_worktree_ids).toEqual([before.worktrees[0]!.id]);
    expect(result.ledger_updated).toBe(false);
    expect(existsSync(before.worktrees[0]!.path)).toBe(false);
    // The ledger itself could not be updated (the run is terminal) — still lists the worktree
    // that is, physically, already gone. `ledger_updated: false` is what tells a caller that.
    expect(readWorktreeLedger(loadRun(fixture.run).state)!.worktrees).toEqual(before.worktrees);
  });

  test("refuses when the run was never provisioned", async () => {
    const fixture = await worktreeCapsule(roots, "reclaim-cli-unprovisioned", {
      worktree_isolation: false,
    });
    await addTask(fixture, "t1", "src/a");
    await compile(fixture);

    await expect(
      execute(["worktree:reclaim", "--run", fixture.run, "--actor", "coordinator"]),
    ).rejects.toThrow(HarnessError);
  });
});
