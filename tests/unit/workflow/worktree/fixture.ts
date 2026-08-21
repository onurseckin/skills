import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { resetHarnessConfigCache } from "../../../../orchestrating-long-tasks/scripts/src/config/harness-config.ts";

export interface WorktreeFixture {
  repo: string;
  run: string;
}

export async function cleanupRoots(roots: string[]): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

function git(repo: string, argv: readonly string[]): void {
  const result = spawnSync("git", [...argv], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${argv.join(" ")}: ${result.stderr}`);
}

/**
 * A real repo plus a real capsule with `worktree_isolation` turned on — the config's own default is
 * off (see harness-config.ts), so every worktree test opts in explicitly rather than relying on it.
 */
export async function worktreeCapsule(
  roots: string[],
  name: string,
  config: Record<string, unknown> = {},
): Promise<WorktreeFixture> {
  resetHarnessConfigCache();
  const repo = await mkdtemp(join(tmpdir(), `harness-worktree-${name}-`));
  roots.push(repo);
  // A per-fixture worktree root, cleaned up alongside the repo: the default root (a fixed sibling
  // of the OS tmpdir) is intentionally shared across a whole real-world machine, which is exactly
  // wrong for a test suite that reuses run ids like `provision-basic` across process runs and would
  // otherwise collide with a previous run's leftover `git worktree` metadata.
  const worktreeRoot = await mkdtemp(join(tmpdir(), `harness-worktree-root-${name}-`));
  roots.push(worktreeRoot);
  await writeFile(
    join(repo, "harness.config.json"),
    JSON.stringify({ worktree_isolation: true, worktree_root: worktreeRoot, ...config }),
  );
  git(repo, ["init", "--quiet", "--initial-branch", "main"]);
  git(repo, ["config", "user.email", "harness@example.test"]);
  git(repo, ["config", "user.name", "Harness Test"]);
  await writeFile(join(repo, ".gitignore"), ".capsules/\nprompt.txt\nharness.config.json\n");
  await writeFile(join(repo, "prompt.txt"), "Build the thing.\nCover the thing with tests.\n");
  await writeFile(join(repo, "one.txt"), "one\n");
  await writeFile(join(repo, "two.txt"), "two\n");
  git(repo, ["add", ".gitignore", "one.txt", "two.txt"]);
  git(repo, ["commit", "--quiet", "-m", "base"]);

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run-id",
    name,
    "--prompt-file",
    join(repo, "prompt.txt"),
  ]);
  const run = String(init.run_root);
  return { repo, run };
}

/**
 * A3-gate-discrimination refuses two disjoint-scope tasks sharing byte-identical gate argv (it
 * proves neither task actually ran). Deriving the gate's path segment from the task's own write
 * scope keeps every task's gate genuinely its own — two tasks only ever collide here if they also
 * share a scope, in which case they are not disjoint and the rail does not apply to them anyway.
 */
function gateForScope(scope: string): string {
  const slug = scope.split("/").filter(Boolean).join("-");
  return `bun test tests/unit/thing-${slug}.test.ts`;
}

export async function addTask(
  fixture: WorktreeFixture,
  id: string,
  scope: string,
  deps?: string,
): Promise<void> {
  const depIds = deps === undefined ? [] : deps.split(",").filter(Boolean);
  await execute([
    "plan:add",
    "--run",
    fixture.run,
    "--id",
    id,
    "--label",
    `Task ${id}`,
    "--scope",
    scope,
    "--gate",
    gateForScope(scope),
    "--actor",
    "coordinator",
    ...(depIds.length === 0 ? [] : ["--deps", deps as string]),
    ...depIds.flatMap((dep) => ["--dep-reason", `${dep}:fixture-declared ordering dependency`]),
  ]);
}

export async function compile(fixture: WorktreeFixture): Promise<Record<string, unknown>> {
  return execute([
    "plan:compile",
    "--run",
    fixture.run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);
}

export async function claim(
  fixture: WorktreeFixture,
  taskId: string,
  agent: string,
): Promise<string> {
  const claimed = await execute([
    "task:claim",
    "--run",
    fixture.run,
    "--task",
    taskId,
    "--agent",
    agent,
    "--role",
    "implementer",
    "--lease-seconds",
    "600",
  ]);
  return String(claimed.token);
}
