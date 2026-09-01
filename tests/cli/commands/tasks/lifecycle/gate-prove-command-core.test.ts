import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { revokeSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { spawnSync } from "node:child_process";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];

function git(repo: string, argv: readonly string[]): void {
  spawnSync("git", [...argv], { cwd: repo });
}

function clearCallerSession(run?: string, agentId = "worker-1"): void {
  revokeSessionGrant({ runRoot: run, agentId, pid: process.pid, ppid: process.ppid });
}

beforeEach(() => {
  setupVirtualCliFS();
  clearCallerSession();
});

afterEach(async () => {
  clearCallerSession();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

async function compiledSingleTaskRun(
  name: string,
  gate: string,
): Promise<{ repo: string; run: string }> {
  setupVirtualCliFS();
  const repo = `/virtual/cli/gate-prove-cmd-${name}-${Math.random().toString(36).slice(2)}`;
  roots.push(repo);
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), ".olt/capsules/\nprompt.txt\n");
  writeFileSync(join(repo, "README.md"), "hi\n");

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
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    "coordinator",
    "--role",
    "coordinator",
    "--host",
    "antigravity",
  ]);
  return { repo, run };
}

describe("gate:prove - Core Falsifiability Proofs", () => {
  test("proves task gate falsifiable and reports no prior proof on first call", async () => {
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
    expect(Array.isArray(result.gate_proofs)).toBe(true);
  });

  test("second proof against unchanged gate reports prior proof as unchanged", async () => {
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

  test("proof that regresses to not-falsifiable is reported against prior proof", async () => {
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
  });

  test("rejects an unknown task id", async () => {
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
});
