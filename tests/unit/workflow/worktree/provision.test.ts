import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { addTask, cleanupRoots, compile, worktreeCapsule } from "./fixture.ts";
import { getHarnessConfig } from "../../../../orchestrating-long-tasks/scripts/src/config/harness-config.ts";
import { provisionWorktrees } from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/provision.ts";
import { readTopology } from "../../../../orchestrating-long-tasks/scripts/src/contracts/topology.ts";
import { loadRun } from "../../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { readWorktreeLedger } from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/ledger.ts";
import { HarnessError } from "../../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";

function git(repo: string, argv: readonly string[]): string {
  const result = spawnSync("git", [...argv], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${argv.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

const roots: string[] = [];
afterEach(() => cleanupRoots(roots));

describe("provisionWorktrees (via plan:compile)", () => {
  test("provisions a branch and one worktree per task in the widest wave, outside the repo", async () => {
    const fixture = await worktreeCapsule(roots, "provision-basic");
    await addTask(fixture, "t1", "src/a");
    await addTask(fixture, "t2", "src/b");
    const result = await compile(fixture);

    expect(git(fixture.repo, ["branch", "--list", `harness/${basename(fixture.run)}`]).trim()).not.toBe("");
    // The harness branch is a plain ref, never checked out — the repo's own HEAD is untouched.
    expect(git(fixture.repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main");
    expect(git(fixture.repo, ["status", "--short"]).trim()).toBe("");

    const ledger = result.worktree_ledger as { worktrees: { path: string }[]; assignments: unknown[] };
    expect(ledger.worktrees.length).toBe(2);
    for (const worktree of ledger.worktrees) {
      expect(existsSync(worktree.path)).toBe(true);
      expect(worktree.path.startsWith(fixture.repo)).toBe(false);
      expect(git(worktree.path, ["rev-parse", "--is-inside-work-tree"]).trim()).toBe("true");
    }
    expect(ledger.assignments).toEqual([
      { task_id: "t1", worktree_id: "wt-0", wave: 1 },
      { task_id: "t2", worktree_id: "wt-1", wave: 1 },
    ]);
  });

  test("a task serialized into a later wave reuses an earlier worktree instead of growing the pool", async () => {
    const fixture = await worktreeCapsule(roots, "provision-reuse");
    await addTask(fixture, "t1", "src/a");
    await addTask(fixture, "t2", "src/b");
    await addTask(fixture, "t3", "src/c", "t1");
    const result = await compile(fixture);
    const ledger = result.worktree_ledger as { worktrees: unknown[]; assignments: { worktree_id: string }[] };
    expect(ledger.worktrees.length).toBe(2);
    expect(ledger.assignments.at(-1)?.worktree_id).toBe("wt-0");
  });

  test("a second provisioning call against the same topology creates nothing new", async () => {
    const fixture = await worktreeCapsule(roots, "provision-idempotent");
    await addTask(fixture, "t1", "src/a");
    await compile(fixture);

    const before = git(fixture.repo, ["worktree", "list", "--porcelain"]);
    const loaded = loadRun(fixture.run);
    const topology = readTopology(loaded.state)!;
    const config = getHarnessConfig(fixture.repo, fixture.run);
    const tasksById = new Map([["t1", { write_scope: ["src/a"] }]]);
    const second = provisionWorktrees({
      runRoot: fixture.run,
      repoRoot: fixture.repo,
      runId: basename(fixture.run),
      actor: "test",
      topology,
      tasksById,
      config,
    });
    expect(git(fixture.repo, ["worktree", "list", "--porcelain"])).toBe(before);
    expect(second.ledger).toEqual(readWorktreeLedger(loadRun(fixture.run).state));
  });

  test("refuses a worktree_root that resolves inside the repository", async () => {
    const fixture = await worktreeCapsule(roots, "provision-unsafe-root");
    await addTask(fixture, "t1", "src/a");
    const insideRepo = `${basename(fixture.repo)}/inside-repo-worktrees`;
    expect(() =>
      provisionWorktrees({
        runRoot: fixture.run,
        repoRoot: fixture.repo,
        runId: basename(fixture.run),
        actor: "test",
        topology: { revision: 1, max_parallel: 4, decisions: [], waves: [{ wave: 1, task_ids: ["t1"] }] },
        tasksById: new Map([["t1", { write_scope: ["src/a"] }]]),
        config: { worktree_isolation: true, worktree_root: insideRepo, branch_prefix: "harness/" },
      }),
    ).toThrow(HarnessError);
    // Sanity: the resolved path really would have landed inside the repo, proving the guard fired
    // for the right reason rather than an unrelated failure.
    expect(resolve(dirname(fixture.repo), insideRepo).startsWith(fixture.repo)).toBe(true);
  });

  test("worktree_isolation off (the default) provisions nothing", async () => {
    const fixture = await worktreeCapsule(roots, "provision-disabled", { worktree_isolation: false });
    await addTask(fixture, "t1", "src/a");
    const result = await compile(fixture);
    expect(result.worktree_ledger).toBeUndefined();
    expect(readWorktreeLedger(loadRun(fixture.run).state)).toBeNull();
  });
});
