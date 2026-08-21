import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { latestGateProof } from "../../../orchestrating-long-tasks/scripts/src/graph/gate-proof.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, argv: readonly string[]): void {
  const result = spawnSync("git", [...argv], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${argv.join(" ")}: ${result.stderr}`);
}

/** A real, committed, gitignore-respecting repository with a compiled one-task plan — narrow scope
 *  and a scoped gate so `plan:compile`'s C1 audit has nothing to block on; `gate:prove` is what this
 *  test exists to exercise. */
async function compiledSingleTaskRun(
  name: string,
  gate: string,
): Promise<{ repo: string; run: string }> {
  const repo = mkdtempSync(join(tmpdir(), `gate-prove-cli-${name}-`));
  roots.push(repo);
  git(repo, ["init", "--quiet", "--initial-branch", "main"]);
  git(repo, ["config", "user.email", "harness@example.test"]);
  git(repo, ["config", "user.name", "Harness Test"]);
  writeFileSync(join(repo, ".gitignore"), ".capsules/\nprompt.txt\n");
  writeFileSync(join(repo, "README.md"), "hi\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "--quiet", "-m", "base"]);

  writeFileSync(join(repo, "prompt.txt"), "Add a feature file.\n");
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

  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-1",
    "--label",
    "Add feature file",
    "--scope",
    "feature.ts",
    "--gate",
    gate,
    "--actor",
    "planner",
  ]);
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "coordinator",
    "--completion-gate",
    "bun test tests",
  ]);
  return { repo, run };
}

describe("gate:prove (CLI wiring)", () => {
  test("proves a task's gate falsifiable and records it as a capsule event", async () => {
    const { repo, run } = await compiledSingleTaskRun("falsifiable", "test -f feature.ts");
    // The task's real, uncommitted work: exactly what its write scope declared.
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");

    const result = await execute([
      "gate:prove",
      "--run",
      run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
    ]);
    expect(result.falsifiable).toBe(true);
    expect(result.exit_code).not.toBe(0);

    const state = loadRun(run).state;
    const proof = latestGateProof(state, "task-1", ["test", "-f", "feature.ts"]);
    expect(proof?.falsifiable).toBe(true);
    expect(proof?.actor).toBe("coordinator");

    // The real repository must come back exactly as the task left it — gate:prove proves on a copy.
    expect(existsSync(join(repo, "feature.ts"))).toBe(true);
  });

  test("proves a task's gate NOT falsifiable — the exact shape FORENSICS.md found", async () => {
    // A gate that checks a file outside the task's own write scope: identical to the DSA forensics'
    // whole-repo `bun run typecheck` in the one way that matters — it cannot see this task's work.
    const { run } = await compiledSingleTaskRun("not-falsifiable", "test -f README.md");
    const result = await execute([
      "gate:prove",
      "--run",
      run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
    ]);
    expect(result.falsifiable).toBe(false);
    expect(result.exit_code).toBe(0);

    const state = loadRun(run).state;
    expect(latestGateProof(state, "task-1", ["test", "-f", "README.md"])?.falsifiable).toBe(false);
  });

  test("refuses an unknown task", async () => {
    const { run } = await compiledSingleTaskRun("unknown-task", "test -f feature.ts");
    await expect(
      execute(["gate:prove", "--run", run, "--task", "task-missing", "--actor", "coordinator"]),
    ).rejects.toThrow();
  });

  test("refuses a task that has not been through plan:compile", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gate-prove-cli-uncompiled-"));
    roots.push(repo);
    git(repo, ["init", "--quiet", "--initial-branch", "main"]);
    git(repo, ["config", "user.email", "harness@example.test"]);
    git(repo, ["config", "user.name", "Harness Test"]);
    writeFileSync(join(repo, ".gitignore"), ".capsules/\nprompt.txt\n");
    writeFileSync(join(repo, "README.md"), "hi\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--quiet", "-m", "base"]);
    writeFileSync(join(repo, "prompt.txt"), "Add a feature file.\n");
    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run-id",
      "uncompiled",
      "--prompt-file",
      join(repo, "prompt.txt"),
    ]);
    const run = String(init.run_root);
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-1",
      "--label",
      "Add feature file",
      "--scope",
      "feature.ts",
      "--gate",
      "test -f feature.ts",
      "--actor",
      "planner",
    ]);
    await expect(
      execute(["gate:prove", "--run", run, "--task", "task-1", "--actor", "coordinator"]),
    ).rejects.toThrow();
  });
});
