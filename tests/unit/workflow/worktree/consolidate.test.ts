import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  consolidateWorktrees,
  recordConsolidation,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/consolidate.ts";
import type { WorktreeLedgerState } from "../../../../orchestrating-long-tasks/scripts/src/contracts/worktree.ts";
import { loadRun } from "../../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { readWorktreeLedger } from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/ledger.ts";
import { addTask, claim, cleanupRoots, compile, worktreeCapsule } from "./fixture.ts";

function git(repo: string, argv: readonly string[]): string {
  const result = spawnSync("git", [...argv], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${argv.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

const roots: string[] = [];
afterEach(() => cleanupRoots(roots));

describe("consolidateWorktrees (B22.4, end-to-end via the CLI)", () => {
  test("merges every worktree's sub-phase commits onto the harness branch and removes the worktrees", async () => {
    const { execute } =
      await import("../../../../orchestrating-long-tasks/scripts/src/cli/execute.ts");
    const fixture = await worktreeCapsule(roots, "consolidate-basic");
    await addTask(fixture, "t1", "src/a");
    await addTask(fixture, "t2", "src/b");
    await compile(fixture);

    const token1 = await claim(fixture, "t1", "agent-1");
    const token2 = await claim(fixture, "t2", "agent-2");
    const ledgerBefore = readWorktreeLedger(loadRun(fixture.run).state)!;
    const wt1 = ledgerBefore.worktrees.find(
      (w) => w.id === ledgerBefore.assignments.find((a) => a.task_id === "t1")!.worktree_id,
    )!;
    const wt2 = ledgerBefore.worktrees.find(
      (w) => w.id === ledgerBefore.assignments.find((a) => a.task_id === "t2")!.worktree_id,
    )!;
    expect(wt1.id).not.toBe(wt2.id);

    await mkdir(join(wt1.path, "src", "a"), { recursive: true });
    await writeFile(join(wt1.path, "src", "a", "feature.ts"), "export const a = 1;\n");
    await mkdir(join(wt2.path, "src", "b"), { recursive: true });
    await writeFile(join(wt2.path, "src", "b", "feature.ts"), "export const b = 2;\n");

    for (const [taskId, agent, token, file] of [
      ["t1", "agent-1", token1, "src/a/feature.ts"],
      ["t2", "agent-2", token2, "src/b/feature.ts"],
    ] as const) {
      await execute([
        "run:exec",
        "--run",
        fixture.run,
        "--task",
        taskId,
        "--actor",
        agent,
        "--cwd",
        fixture.repo,
        "--",
        "echo",
        "work",
      ]);
      await execute([
        "task:submit",
        "--run",
        fixture.run,
        "--task",
        taskId,
        "--agent",
        agent,
        "--token",
        token,
        "--summary",
        `Added ${file}`,
        "--files-changed",
        file,
      ]);
    }

    const ledger = readWorktreeLedger(loadRun(fixture.run).state)!;
    expect(ledger.commits.length).toBe(2);
    expect(ledger.base_branch).toBe("main");

    const runId = basename(fixture.run);
    const result = consolidateWorktrees({
      repoRoot: fixture.repo,
      runId,
      ledger,
      rebaseOnComplete: false,
    });

    expect(result.merge_conflict).toBeUndefined();
    expect(result.rebased).toBe(false);
    expect(new Set(result.merged_worktree_ids)).toEqual(new Set([wt1.id, wt2.id]));
    expect(new Set(result.removed_worktree_ids)).toEqual(new Set([wt1.id, wt2.id]));
    expect(result.commit_count).toBe(2);

    // Both files landed on the shared branch, and neither per-task worktree nor the scratch
    // worktree this function used internally are left behind.
    expect(git(fixture.repo, ["show", `${ledger.harness_branch}:src/a/feature.ts`]).trim()).toBe(
      "export const a = 1;",
    );
    expect(git(fixture.repo, ["show", `${ledger.harness_branch}:src/b/feature.ts`]).trim()).toBe(
      "export const b = 2;",
    );
    expect(existsSync(wt1.path)).toBe(false);
    expect(existsSync(wt2.path)).toBe(false);
    expect(existsSync(join(ledger.root, runId, "consolidate"))).toBe(false);

    // The invariant B22.1 exists for: none of this ever touched the user's own checkout.
    expect(git(fixture.repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main");
    expect(git(fixture.repo, ["status", "--short"]).trim()).toBe("");

    recordConsolidation(fixture.run, "critic-1", result);
    const after = readWorktreeLedger(loadRun(fixture.run).state)!;
    expect(after.consolidation).toEqual(result);
    expect(after.worktrees).toEqual([]);
  });
});

describe("consolidateWorktrees (B22.4, direct git edge cases)", () => {
  async function rawRepo(name: string): Promise<{ repo: string; sha: string }> {
    const repo = await mkdtemp(join(tmpdir(), `harness-consolidate-${name}-`));
    roots.push(repo);
    git(repo, ["init", "--quiet", "--initial-branch", "main"]);
    git(repo, ["config", "user.email", "harness@example.test"]);
    git(repo, ["config", "user.name", "Harness Test"]);
    await writeFile(join(repo, "one.txt"), "base\n");
    git(repo, ["add", "one.txt"]);
    git(repo, ["commit", "--quiet", "-m", "base"]);
    const sha = git(repo, ["rev-parse", "HEAD"]).trim();
    return { repo, sha };
  }

  function ledgerFor(
    root: string,
    harnessBranch: string,
    sha: string,
    worktreeIds: string[],
  ): WorktreeLedgerState {
    return {
      harness_branch: harnessBranch,
      base_sha: sha,
      base_branch: "main",
      root,
      worktrees: worktreeIds.map((id) => ({
        id,
        path: join(root, "run", id),
        branch: `${harnessBranch}--${id}`,
        base_sha: sha,
        created_at: new Date().toISOString(),
      })),
      assignments: worktreeIds.map((id, index) => ({
        task_id: `t-${index}`,
        worktree_id: id,
        wave: 1,
      })),
      commits: worktreeIds.map((id, index) => ({
        task_id: `t-${index}`,
        worktree_id: id,
        sha: sha, // Placeholder — only `worktree_id` matters to `consolidateWorktrees`'s own logic.
        subject: `chore: task t-${index}`,
        changed_lines: 1,
        over_limit: false,
        committed_at: new Date().toISOString(),
      })),
    };
  }

  test("rebases the harness branch onto the base branch's current tip", async () => {
    const { repo, sha } = await rawRepo("rebase");
    const root = await mkdtemp(join(tmpdir(), "harness-consolidate-root-"));
    roots.push(root);
    const harnessBranch = "harness/rebase-run";
    git(repo, ["branch", harnessBranch, sha]);
    const ledger = ledgerFor(root, harnessBranch, sha, ["wt-0"]);
    const wt0 = ledger.worktrees[0]!;
    git(repo, ["worktree", "add", "-b", wt0.branch, wt0.path, sha]);
    await writeFile(join(wt0.path, "two.txt"), "wt0\n");
    git(wt0.path, ["add", "two.txt"]);
    git(wt0.path, ["commit", "--quiet", "-m", "add two.txt"]);

    // The user kept working on main after the run was provisioned — B22.1's whole premise.
    await writeFile(join(repo, "unrelated.txt"), "advanced\n");
    git(repo, ["add", "unrelated.txt"]);
    git(repo, ["commit", "--quiet", "-m", "advance main"]);

    const result = consolidateWorktrees({
      repoRoot: repo,
      runId: "run",
      ledger,
      rebaseOnComplete: true,
    });

    expect(result.rebased).toBe(true);
    expect(result.rebase_target).toBe("main");
    expect(result.rebase_conflict_paths).toBeUndefined();
    expect(result.merge_conflict).toBeUndefined();
    expect(result.removed_worktree_ids).toEqual(["wt-0"]);
    expect(git(repo, ["show", `${harnessBranch}:unrelated.txt`]).trim()).toBe("advanced");
    expect(git(repo, ["show", `${harnessBranch}:two.txt`]).trim()).toBe("wt0");
    expect(existsSync(wt0.path)).toBe(false);
  });

  test("stops on a merge conflict between two worktree branches, leaving both worktrees intact", async () => {
    const { repo, sha } = await rawRepo("conflict");
    const root = await mkdtemp(join(tmpdir(), "harness-consolidate-root-"));
    roots.push(root);
    const harnessBranch = "harness/conflict-run";
    git(repo, ["branch", harnessBranch, sha]);
    const ledger = ledgerFor(root, harnessBranch, sha, ["wt-0", "wt-1"]);
    const [wt0, wt1] = ledger.worktrees as [
      WorktreeLedgerState["worktrees"][0],
      WorktreeLedgerState["worktrees"][0],
    ];
    git(repo, ["worktree", "add", "-b", wt0.branch, wt0.path, sha]);
    git(repo, ["worktree", "add", "-b", wt1.branch, wt1.path, sha]);
    // Both worktrees edit the SAME file the same way a cross-wave scope collision would (assign.ts
    // only guards concurrent waves against each other, never the whole run) — this is the case
    // B22.4's STOP-on-conflict rule exists for.
    await writeFile(join(wt0.path, "one.txt"), "wt0 change\n");
    git(wt0.path, ["add", "one.txt"]);
    git(wt0.path, ["commit", "--quiet", "-m", "wt0 edits one.txt"]);
    await writeFile(join(wt1.path, "one.txt"), "wt1 change\n");
    git(wt1.path, ["add", "one.txt"]);
    git(wt1.path, ["commit", "--quiet", "-m", "wt1 edits one.txt"]);

    const result = consolidateWorktrees({
      repoRoot: repo,
      runId: "run",
      ledger,
      rebaseOnComplete: false,
    });

    expect(result.merge_conflict).toEqual({
      worktree_id: "wt-1",
      branch: wt1.branch,
      paths: ["one.txt"],
    });
    expect(result.merged_worktree_ids).toEqual(["wt-0"]);
    expect(result.removed_worktree_ids).toEqual([]);
    expect(result.rebased).toBe(false);
    // Nothing force-resolved, nothing cleaned up — both worktrees are still there to inspect.
    expect(existsSync(wt0.path)).toBe(true);
    expect(existsSync(wt1.path)).toBe(true);
    expect(git(repo, ["status", "--short"]).trim()).toBe("");
    // The user's own checkout (main) was never touched by any of this.
    expect(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main");
  });
});
