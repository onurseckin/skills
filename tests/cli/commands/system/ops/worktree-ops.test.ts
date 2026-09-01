import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { setGitRunnerForTesting } from "../../../../../olt/scripts/src/workflow/worktree/git.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
let restoreGitRunner: (() => void) | undefined;

beforeEach(() => {
  setupVirtualCliFS();
  restoreGitRunner = setGitRunnerForTesting((_cwd, argv) => {
    if (argv[0] === "rev-parse" && argv[1] === "HEAD") {
      return { status: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "" };
    }
    if (argv[0] === "symbolic-ref") {
      return { status: 0, stdout: "main\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  });
});

afterEach(async () => {
  if (restoreGitRunner) {
    restoreGitRunner();
    restoreGitRunner = undefined;
  }
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

function createTestGitRepo(): string {
  const repo = `/virtual/cli/worktree-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  roots.push(repo);
  mkdirSync(join(repo, ".git"), { recursive: true });
  return repo;
}

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

describe("worktree:create", () => {
  test("creates a track worktree with default base branch", async () => {
    const repo = createTestGitRepo();
    const result = await execute([
      "worktree:create",
      "--track",
      "track-alpha",
      "--repo-root",
      repo,
    ]);

    expect(result.track_id).toBe("track-alpha");
    expect(result.branch).toBe("track/track-alpha");
    expect(result.base_branch).toBe("main");
    expect(result.worktree_path).toBe(join(repo, ".olt", "worktrees", "track-alpha"));
    expect(result.lock_path).toBe(join(repo, ".olt", "worktrees", "locks", "track-alpha.lock"));
    expect(result.markdown).toBeDefined();
    expect(existsSync(result.worktree_path as string)).toBe(true);
    expect(existsSync(result.lock_path as string)).toBe(true);
  });

  test("creates a track worktree with custom base branch", async () => {
    const repo = createTestGitRepo();

    const result = await execute([
      "worktree:create",
      "--track",
      "track-custom",
      "--base-branch",
      "custom-base",
      "--repo-root",
      repo,
    ]);

    expect(result.track_id).toBe("track-custom");
    expect(result.base_branch).toBe("custom-base");
    expect(existsSync(result.worktree_path as string)).toBe(true);
  });

  test("fails when track argument is missing or invalid", async () => {
    const repo = createTestGitRepo();
    await expect(execute(["worktree:create", "--repo-root", repo])).rejects.toThrow();
    await expect(
      execute(["worktree:create", "--track", "invalid/track/name", "--repo-root", repo]),
    ).rejects.toThrow();
  });
});

describe("worktree:list", () => {
  test("lists active track worktrees", async () => {
    const repo = createTestGitRepo();
    const emptyList = await execute(["worktree:list", "--repo-root", repo]);
    expect(emptyList.count).toBe(0);
    expect(emptyList.worktrees).toEqual([]);

    await execute(["worktree:create", "--track", "track-one", "--repo-root", repo]);
    await execute(["worktree:create", "--track", "track-two", "--repo-root", repo]);

    const populatedList = await execute(["worktree:list", "--repo-root", repo]);
    expect(populatedList.count).toBe(2);
    const worktrees = populatedList.worktrees as { trackId: string }[];
    expect(worktrees.map((w) => w.trackId).sort()).toEqual(["track-one", "track-two"]);
  });
});

describe("worktree:status", () => {
  test("reports status for specific active and inactive tracks", async () => {
    const repo = createTestGitRepo();
    await execute(["worktree:create", "--track", "track-active", "--repo-root", repo]);

    const activeStatus = await execute([
      "worktree:status",
      "--track",
      "track-active",
      "--repo-root",
      repo,
    ]);
    expect(activeStatus.active).toBe(true);
    expect(activeStatus.worktree).toBeDefined();

    const inactiveStatus = await execute([
      "worktree:status",
      "--track",
      "track-nonexistent",
      "--repo-root",
      repo,
    ]);
    expect(inactiveStatus.active).toBe(false);
    expect(inactiveStatus.track_id).toBe("track-nonexistent");
  });

  test("reports overall status when no track flag provided", async () => {
    const repo = createTestGitRepo();
    await execute(["worktree:create", "--track", "track-status-1", "--repo-root", repo]);

    const overallStatus = await execute(["worktree:status", "--repo-root", repo]);
    expect(overallStatus.active_count).toBe(1);
    expect(overallStatus.worktrees).toBeDefined();
  });
});

describe("worktree:land", () => {
  test("lands a track worktree to main with immediate teardown", async () => {
    const repo = createTestGitRepo();
    await execute(["worktree:create", "--track", "track-land", "--repo-root", repo]);

    const landResult = await execute([
      "worktree:land",
      "--track",
      "track-land",
      "--repo-root",
      repo,
      "--no-release-hook",
    ]);

    expect(landResult.track_id).toBe("track-land");
    expect(landResult.target_branch).toBe("main");
    expect(landResult.cleaned).toBe(true);
    expect(landResult.torn_down).toBe(true);
    expect(landResult.pushed).toBe(false);
    expect(typeof landResult.commit_sha).toBe("string");
    expect(typeof landResult.duration_ms).toBe("number");
    expect(existsSync(join(repo, ".olt", "worktrees", "track-land"))).toBe(false);
    expect(existsSync(join(repo, ".olt", "worktrees", "locks", "track-land.lock"))).toBe(false);
  });

  test("fails when attempting to land nonexistent track", async () => {
    const repo = createTestGitRepo();
    await expect(
      execute(["worktree:land", "--track", "nonexistent-track", "--repo-root", repo]),
    ).rejects.toThrow();
  });
});

describe("worktree:clean", () => {
  test("cleans a single track worktree", async () => {
    const repo = createTestGitRepo();
    await execute(["worktree:create", "--track", "track-clean-single", "--repo-root", repo]);

    const cleanResult = await execute([
      "worktree:clean",
      "--track",
      "track-clean-single",
      "--repo-root",
      repo,
    ]);

    expect(cleanResult.count).toBe(1);
    expect(existsSync(join(repo, ".olt", "worktrees", "track-clean-single"))).toBe(false);
    expect(existsSync(join(repo, ".olt", "worktrees", "locks", "track-clean-single.lock"))).toBe(
      false,
    );
  });

  test("cleans all active track worktrees with --all flag", async () => {
    const repo = createTestGitRepo();
    await execute(["worktree:create", "--track", "track-clean-all-1", "--repo-root", repo]);
    await execute(["worktree:create", "--track", "track-clean-all-2", "--repo-root", repo]);

    const cleanAllResult = await execute(["worktree:clean", "--all", "--repo-root", repo]);
    expect(cleanAllResult.count).toBe(2);
    expect(existsSync(join(repo, ".olt", "worktrees", "track-clean-all-1"))).toBe(false);
    expect(existsSync(join(repo, ".olt", "worktrees", "track-clean-all-2"))).toBe(false);
  });
});

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
    mkdirSync(join(repo, ".git"), { recursive: true });
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
    mkdirSync(join(repo, ".git"), { recursive: true });
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
