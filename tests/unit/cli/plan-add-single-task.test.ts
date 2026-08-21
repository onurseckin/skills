import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { freshRun } from "./plan-workflow-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("plan:add (single task)", () => {
  test("requires --scope and --gate", async () => {
    const { run } = await freshRun("add-required-flags", roots);
    await expect(
      execute(["plan:add", "--run", run, "--id", "task-1", "--label", "T1", "--actor", "planner"]),
    ).rejects.toThrow(/--scope is required/);
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task-1",
        "--label",
        "T1",
        "--scope",
        "src/a",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/--gate is required/);
  });

  test("registers a task with goal, criteria, priority, effort and requirement-lines", async () => {
    const { run } = await freshRun("add-full-task", roots, [
      "Build the login form",
      "Validate the email field",
      "Show an inline error on failure",
    ]);
    const result = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-login",
      "--label",
      "Login form",
      "--scope",
      "src/login",
      "--gate",
      "bun test src/login",
      "--goal",
      "Ship a working login form",
      "--criteria",
      "Validates email; shows inline error",
      "--priority",
      "80",
      "--effort",
      "3",
      "--requirement-lines",
      "1-2",
      "--actor",
      "planner",
    ]);
    expect(result.total_tasks).toBe(1);
    const task = result.task as { id: string; requirementLines: number[] };
    expect(task.id).toBe("task-login");
    expect(task.requirementLines).toEqual([1, 2]);
  });

  test("--dep-reason must name one of --deps, and a satisfied dependency is accepted", async () => {
    const { run } = await freshRun("add-deps", roots);
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core",
      "--scope",
      "src/core",
      "--gate",
      "bun test src/core",
      "--actor",
      "planner",
    ]);
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task-dependent",
        "--label",
        "Dependent",
        "--scope",
        "src/dependent",
        "--gate",
        "bun test src/dependent",
        "--deps",
        "task-core",
        "--dep-reason",
        "task-unrelated:not the declared dep",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/not in --deps/);

    const result = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-dependent",
      "--label",
      "Dependent",
      "--scope",
      "src/dependent",
      "--gate",
      "bun test src/dependent",
      "--deps",
      "task-core",
      "--dep-reason",
      "task-core:reads task-core's output",
      "--actor",
      "planner",
    ]);
    expect((result.task as { deps: string[] }).deps).toEqual(["task-core"]);
    expect(result.unjustified_dependencies).toBeUndefined();
  });

  test("an unjustified dependency is still registered, with a note naming it", async () => {
    const { run } = await freshRun("add-unjustified-dep", roots);
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core",
      "--scope",
      "src/core",
      "--gate",
      "bun test src/core",
      "--actor",
      "planner",
    ]);
    const result = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-dependent",
      "--label",
      "Dependent",
      "--scope",
      "src/dependent",
      "--gate",
      "bun test src/dependent",
      "--deps",
      "task-core",
      "--actor",
      "planner",
    ]);
    expect(result.unjustified_dependencies).toEqual(["task-core"]);
    expect(String(result.markdown)).toContain("Unjustified dependency");
  });

  test("a malformed --dep-reason missing the colon separator is refused", async () => {
    const { run } = await freshRun("add-dep-reason-malformed", roots);
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core",
      "--scope",
      "src/core",
      "--gate",
      "bun test src/core",
      "--actor",
      "planner",
    ]);
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task-dependent",
        "--label",
        "Dependent",
        "--scope",
        "src/dependent",
        "--gate",
        "bun test src/dependent",
        "--deps",
        "task-core",
        "--dep-reason",
        "task-core reads output with no colon at all",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/--dep-reason must read/);
  });

  test("refuses a duplicate task id in the buffer", async () => {
    const { run } = await freshRun("add-duplicate", roots);
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-1",
      "--label",
      "T1",
      "--scope",
      "src/a",
      "--gate",
      "bun test src/a",
      "--actor",
      "planner",
    ]);
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task-1",
        "--label",
        "T1 again",
        "--scope",
        "src/b",
        "--gate",
        "bun test src/b",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/already exists in planning buffer/);
  });

  test("warns when the gate is broader than the task's own write scope", async () => {
    const { run } = await freshRun("add-gate-breadth", roots);
    const result = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-narrow",
      "--label",
      "Narrow",
      "--scope",
      "src/narrow",
      "--gate",
      "bun test src",
      "--actor",
      "planner",
    ]);
    expect(result.gate_breadth_warning).toBeDefined();
    expect(String(result.markdown)).toContain("Gate breadth");
  });

  test("refuses plan:add once the plan is compiled", async () => {
    const { repo, run } = await freshRun("add-after-compile", roots);
    await mkdir(join(repo, "src/core"), { recursive: true });
    await writeFile(join(repo, "gate-core.ts"), "console.log('ok');\n");
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core",
      "--scope",
      "src/core",
      "--gate",
      "bun gate-core.ts",
      "--actor",
      "planner",
    ]);
    await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test src",
    ]);
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task-late",
        "--label",
        "Late",
        "--scope",
        "src/late",
        "--gate",
        "bun test src/late",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/cannot add tasks to compiled plan/);
  });
});
