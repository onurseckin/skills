import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const gitRoots: string[] = [];
afterAll(() => {
  for (const root of gitRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function git(repo: string, argv: readonly string[]): void {
  const result = spawnSync("git", [...argv], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (result.status !== 0) throw new Error(`git ${argv.join(" ")}: ${result.stderr}`);
}

/** A real, committed, gitignore-respecting repository with a compiled one-task plan. */
async function compiledSingleTaskRun(
  name: string,
  gate: string,
): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), `gate-prove-cmd-${name}-`)));
  gitRoots.push(repo);
  git(repo, ["init", "--quiet", "--initial-branch", "main"]);
  git(repo, ["config", "user.email", "harness@example.test"]);
  git(repo, ["config", "user.name", "Harness Test"]);
  writeFileSync(join(repo, ".gitignore"), ".olt/capsules/\nprompt.txt\n");
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
  await execute(["plan:brainstorm", "--run", run, "--actor", "coordinator"]);
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

describe("gate:prove (command layer)", () => {
  test("proves a task's gate falsifiable and reports no prior proof on the first call", async () => {
    const { repo, run } = await compiledSingleTaskRun("falsifiable", "test -f feature.ts");
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
    expect(result.task_id).toBe("task-1");
    expect(result.previous_falsifiable).toBeNull();
    expect(String(result.markdown)).toContain("### Gate Proof: `task-1`");
    expect(String(result.markdown)).toContain("PROVEN FALSIFIABLE");
    expect(String(result.markdown)).toContain(
      "- **Prior proof**: none recorded for this exact gate.",
    );
    expect(Array.isArray(result.gate_proofs)).toBe(true);
  });

  test("a second proof against an unchanged gate reports the prior proof as unchanged", async () => {
    const { repo, run } = await compiledSingleTaskRun("unchanged", "test -f feature.ts");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    await execute(["gate:prove", "--run", run, "--task", "task-1", "--actor", "coordinator"]);

    const second = await execute([
      "gate:prove",
      "--run",
      run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
    ]);
    expect(second.falsifiable).toBe(true);
    expect(second.previous_falsifiable).toBe(true);
    expect(String(second.markdown)).toContain("unchanged — also falsifiable.");
  });

  test("a proof that regresses to not-falsifiable is reported against the prior falsifiable proof", async () => {
    const { repo, run } = await compiledSingleTaskRun("regressed", "test -f feature.ts");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    const first = await execute([
      "gate:prove",
      "--run",
      run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
    ]);
    expect(first.falsifiable).toBe(true);

    // Committing feature.ts to HEAD means the next revert-to-base restores it instead of deleting
    // it, so the same gate now passes against the reverted tree: a genuine regression.
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--quiet", "-m", "feature landed"]);
    const second = await execute([
      "gate:prove",
      "--run",
      run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
    ]);
    expect(second.falsifiable).toBe(false);
    expect(second.previous_falsifiable).toBe(true);
    expect(String(second.markdown)).toContain("**REGRESSED**");
    expect(String(second.markdown)).toContain("was falsifiable, now not falsifiable");
  });

  test("rejects an unknown task id", async () => {
    // gateProveCommand's "unknown task" check runs right after loadRun, before it ever touches
    // Git — any compiled run will do, so this uses the plain-directory fixture instead of a real
    // Git repository.
    const { run } = await setupCompiledRun("gate-prove-unknown-task", roots);
    await expect(
      execute([
        "gate:prove",
        "--run",
        run,
        "--task",
        "task-does-not-exist",
        "--actor",
        "coordinator",
      ]),
    ).rejects.toThrow("unknown task task-does-not-exist");
  });

  // A task not yet run through plan:compile is not in state.tasks at all (plan:add only stages it
  // in the uncompiled graph draft), so readPlanBindings never yields a binding for it and
  // gate-prove.ts's "unknown task" branch fires first — see the "rejects an unknown task id" test
  // above. The dedicated "no compiled task-scope gate" and "no write scope" branches below it
  // guard invariants plan:compile enforces on every task it accepts (a required --gate becomes a
  // matching task-scope gate entry; --scope always yields a non-empty write scope), so they were
  // not reachable through any compiled state this suite could construct; see summary findings.

  test("defaults --base to the sha task:claim recorded, not HEAD, once the task's own work has landed", async () => {
    const { repo, run } = await compiledSingleTaskRun("claimed-base", "test -f feature.ts");
    const shaAtClaim = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    }).stdout.trim();

    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "antigravity",
    ]);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);

    // Simulate the task's own work landing on HEAD before gate:prove ever runs (worktree isolation
    // with commit-per-subphase does exactly this) — the incoherence C3b exists to close: reverting
    // to a stale "HEAD" default would be a no-op here, since feature.ts is already committed.
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--quiet", "-m", "feature landed"]);

    const result = await execute([
      "gate:prove",
      "--run",
      run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
    ]);
    expect(result.base).toBe(shaAtClaim);
    expect(result.falsifiable).toBe(true);
  });

  test("accepts an explicit --base ref and an integer --timeout-ms / --max-files", async () => {
    const { repo, run } = await compiledSingleTaskRun("explicit-base", "test -f feature.ts");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    const result = await execute([
      "gate:prove",
      "--run",
      run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
      "--base",
      "HEAD",
      "--timeout-ms",
      "60000",
      "--max-files",
      "10000",
    ]);
    expect(result.base).toBe("HEAD");
    expect(result.falsifiable).toBe(true);
  });
});
