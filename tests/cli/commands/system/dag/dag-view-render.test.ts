import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import type { DagViewResult } from "../../../../../olt/scripts/src/cli/commands/dag-view.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
  roots.length = 0;
});

async function createBaseRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-dag-render-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(
    promptPath,
    "Build multi-tier system with backend, frontend, database, and documentation components.",
  );

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, run: init.run_root as string };
}

describe("dag:view CLI command execution - Render & Wave Layout", () => {
  test("renders empty buffer message when no tasks are declared", async () => {
    const { run } = await createBaseRun("empty-buffer");

    const result = (await execute(["dag", "--run", run])) as unknown as DagViewResult;

    expect(result.total_tasks).toBe(0);
    expect(result.is_compiled).toBe(false);
    expect(result.waves).toEqual([]);
    expect(result.ascii_dag).toContain("No tasks declared in planning buffer/graph");
    expect(result.markdown).toContain("Draft (Planning Buffer)");
    expect(result.markdown).toContain("Total Tasks**: 0");
  });

  test("renders draft DAG for uncompiled plan in planning buffer", async () => {
    const { run } = await createBaseRun("uncompiled-draft");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-auth",
      "--label",
      "Authentication Module",
      "--scope",
      "src/auth",
      "--gate",
      "bun test auth",
      "--actor",
      "planner",
    ]);

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-api",
      "--label",
      "API Routes",
      "--scope",
      "src/api",
      "--gate",
      "bun test api",
      "--deps",
      "task-auth",
      "--dep-reason",
      "task-auth:API routes depend on authentication middleware",
      "--actor",
      "planner",
    ]);

    const result = (await execute(["dag", "--run", run])) as unknown as DagViewResult;

    expect(result.total_tasks).toBe(2);
    expect(result.is_compiled).toBe(false);
    expect(result.graph_revision).toBeNull();
    expect(result.waves.length).toBe(2);
    expect(result.waves[0]?.taskIds).toEqual(["task-auth"]);
    expect(result.waves[1]?.taskIds).toEqual(["task-api"]);
    expect(result.ascii_dag).toContain("WAVE 1");
    expect(result.ascii_dag).toContain("(○ READY) task-auth");
    expect(result.ascii_dag).toContain("WAVE 2");
    expect(result.ascii_dag).toContain("(⏳ BLOCKED) task-api");
    expect(result.ascii_dag).toContain("▼");
  });

  test("renders multi-wave DAG and computes critical path on compiled graphs", async () => {
    const { run, repo } = await createBaseRun("compiled-multi-wave");

    await mkdir(join(repo, "src/a"), { recursive: true });
    await mkdir(join(repo, "src/b"), { recursive: true });
    await mkdir(join(repo, "src/c"), { recursive: true });
    await mkdir(join(repo, "src/d"), { recursive: true });

    await writeFile(join(repo, "gate-a.ts"), "console.log('gate-a');\n");
    await writeFile(join(repo, "gate-b.ts"), "console.log('gate-b');\n");
    await writeFile(join(repo, "gate-c.ts"), "console.log('gate-c');\n");
    await writeFile(join(repo, "gate-d.ts"), "console.log('gate-d');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-1",
      "--label",
      "Foundational Models",
      "--scope",
      "src/a",
      "--gate",
      "bun gate-a.ts",
      "--requirement-lines",
      "1",
      "--actor",
      "planner",
    ]);

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-2",
      "--label",
      "Independent Utility",
      "--scope",
      "src/b",
      "--gate",
      "bun gate-b.ts",
      "--requirement-lines",
      "1",
      "--actor",
      "planner",
    ]);

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-3",
      "--label",
      "Controller Layer",
      "--scope",
      "src/c",
      "--gate",
      "bun gate-c.ts",
      "--deps",
      "task-1",
      "--dep-reason",
      "task-1:Controller imports models",
      "--requirement-lines",
      "1",
      "--actor",
      "planner",
    ]);

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-4",
      "--label",
      "End-to-End Integration",
      "--scope",
      "src/d",
      "--gate",
      "bun gate-d.ts",
      "--deps",
      "task-3",
      "--dep-reason",
      "task-3:E2E integration exercises controllers",
      "--requirement-lines",
      "1",
      "--actor",
      "planner",
    ]);

    await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);

    await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
      "--accept-audit",
      "A4-false-barrier:test fixture creates topological waves on purpose",
    ]);

    const result = (await execute(["dag", "--run", run, "--detailed"])) as unknown as DagViewResult;

    expect(result.total_tasks).toBe(4);
    expect(result.is_compiled).toBe(true);
    expect(result.graph_revision).toBe(1);
    expect(result.critical_path_length).toBe(3);
    expect(result.waves.length).toBe(3);

    expect(result.waves[0]?.wave).toBe(1);
    expect(result.waves[0]?.taskIds.sort()).toEqual(["task-1", "task-2"]);
    expect(result.waves[0]?.laneCount).toBe(2);

    expect(result.waves[1]?.wave).toBe(2);
    expect(result.waves[1]?.taskIds).toEqual(["task-3"]);

    expect(result.waves[2]?.wave).toBe(3);
    expect(result.waves[2]?.taskIds).toEqual(["task-4"]);

    expect(result.ascii_dag).toContain("Scope:  src/a");
    expect(result.ascii_dag).toContain("Deps:   task-1");
    expect(result.ascii_dag).toContain("Deps:   task-3");
  });
});
