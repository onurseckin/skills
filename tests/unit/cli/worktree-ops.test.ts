import { afterAll, describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterAll(async () => cleanupRoots(roots));

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

  test("reclaims worktrees on git repo with worktree isolation enabled", async () => {
    const { repo, run } = await setupCompiledRun("worktree-reclaim-success", roots, {
      worktree_isolation: true,
    });
    const { spawnSync } = await import("node:child_process");
    spawnSync("git", ["init", "--quiet", "--initial-branch", "main"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "test@test.test"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: repo });
    spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repo });
    await seedLedger(run);

    const result = await execute(["worktree:reclaim", "--run", run, "--actor", "coordinator"]);
    expect(result.run_root).toBe(run);
    expect(result.harness_branch).toBe("harness/worktree-ops-test");
    expect(result.markdown).toBeDefined();
  });

  test("reclaims worktrees on sealed run", async () => {
    const { repo, run } = await setupCompiledRun("worktree-reclaim-sealed", roots, {
      worktree_isolation: true,
    });
    const { spawnSync } = await import("node:child_process");
    spawnSync("git", ["init", "--quiet", "--initial-branch", "main"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "test@test.test"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: repo });
    spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repo });
    transact(run, "test-seed", "seed-worktree-ledger-and-seal", {}, (state) => {
      state.worktree_ledger = {
        harness_branch: "harness/worktree-ops-test",
        base_sha: "0".repeat(40),
        root: ".worktrees",
        worktrees: [],
        assignments: [],
        commits: [],
      };
      state.completion_result = { status: "complete" };
    });

    const result = await execute(["worktree:reclaim", "--run", run, "--actor", "coordinator"]);
    expect(result.run_root).toBe(run);
  });
});
