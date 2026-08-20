import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { execute } from "../../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
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

describe("task:submit commits the assigned worktree (B22.3)", () => {
  test("commits the task's write scope in its worktree, leaving the user's repo untouched", async () => {
    const fixture = await worktreeCapsule(roots, "submit-commit");
    await addTask(fixture, "t1", "src/a");
    await compile(fixture);
    const token = await claim(fixture, "t1", "agent-1");

    const ledgerBefore = readWorktreeLedger(loadRun(fixture.run).state)!;
    const worktreePath = ledgerBefore.worktrees[0]!.path;
    // Simulates what a properly routed agent would have done inside its own worktree — this pass
    // does not yet route agents there itself (see the accompanying report).
    await mkdir(join(worktreePath, "src", "a"), { recursive: true });
    await writeFile(join(worktreePath, "src", "a", "feature.ts"), "export const feature = true;\n");

    // A submission is only accepted against recorded evidence (build-report.ts's resolveChecks) —
    // unrelated to worktree isolation, so the agent records a trivial command first, same as every
    // other CLI-level task:submit fixture in this suite.
    await execute([
      "run:exec",
      "--run",
      fixture.run,
      "--task",
      "t1",
      "--actor",
      "agent-1",
      "--cwd",
      fixture.repo,
      "--",
      "echo",
      "implementer-work",
    ]);

    const result = await execute([
      "task:submit",
      "--run",
      fixture.run,
      "--task",
      "t1",
      "--agent",
      "agent-1",
      "--token",
      token,
      "--summary",
      "Added the feature flag",
      "--files-changed",
      "src/a/feature.ts",
    ]);

    expect(result.worktree_commit_warning).toBeUndefined();

    const state = loadRun(fixture.run).state;
    const tasks = state.tasks as Record<
      string,
      { worktree_commit?: { sha: string; over_limit: boolean } }
    >;
    const commit = tasks.t1!.worktree_commit!;
    expect(commit.sha).toMatch(/^[0-9a-f]{40}$/u);
    expect(commit.over_limit).toBe(false);

    const ledgerAfter = readWorktreeLedger(state)!;
    expect(ledgerAfter.commits).toEqual([
      {
        task_id: "t1",
        worktree_id: "wt-0",
        sha: commit.sha,
        subject: "chore: Task t1",
        changed_lines: expect.any(Number),
        over_limit: false,
        committed_at: expect.any(String),
      },
    ]);

    // The invariant that matters most: the harness never wrote into the user's own working tree.
    expect(existsSync(join(fixture.repo, "src"))).toBe(false);
    expect(git(fixture.repo, ["status", "--short"]).trim()).toBe("");
    expect(git(fixture.repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main");
  });

  test("run:status reports the live worktrees and the harness branch", async () => {
    const fixture = await worktreeCapsule(roots, "submit-status");
    await addTask(fixture, "t1", "src/a");
    await compile(fixture);

    const status = await execute(["run:status", "--run", fixture.run]);
    const worktrees = status.worktrees as { harness_branch: string; worktrees: unknown[] };
    expect(worktrees.harness_branch).toMatch(/^harness\//u);
    expect(worktrees.worktrees.length).toBe(1);
  });
});

// The gap this closes: worktrees were provisioned and assigned (B22.1/B22.2), and task:submit
// already committed into the right one (B22.3) — but nothing ever told the claiming agent which
// directory that was, so it had no way to actually work there instead of the shared repo checkout.
describe("task:claim surfaces the assigned worktree (B22.2 reaching the agent)", () => {
  test("returns the worktree path and puts it in the brief when isolation is on", async () => {
    const fixture = await worktreeCapsule(roots, "claim-routing-on");
    await addTask(fixture, "t1", "src/a");
    await compile(fixture);

    const ledger = readWorktreeLedger(loadRun(fixture.run).state)!;
    const expectedPath = ledger.worktrees[0]!.path;

    const claimed = await execute([
      "task:claim",
      "--run",
      fixture.run,
      "--task",
      "t1",
      "--agent",
      "agent-1",
      "--role",
      "implementer",
      "--lease-seconds",
      "600",
    ]);

    expect(claimed.worktree_path).toBe(expectedPath);
    expect(claimed.worktree_id).toBe(ledger.worktrees[0]!.id);
    expect(String(claimed.markdown)).toContain(expectedPath);
  });

  test("omits the worktree fields when isolation is off (the default)", async () => {
    const fixture = await worktreeCapsule(roots, "claim-routing-off", {
      worktree_isolation: false,
    });
    await addTask(fixture, "t1", "src/a");
    await compile(fixture);

    const claimed = await execute([
      "task:claim",
      "--run",
      fixture.run,
      "--task",
      "t1",
      "--agent",
      "agent-1",
      "--role",
      "implementer",
      "--lease-seconds",
      "600",
    ]);

    expect(claimed.worktree_path).toBeUndefined();
    expect(claimed.worktree_id).toBeUndefined();
  });
});
