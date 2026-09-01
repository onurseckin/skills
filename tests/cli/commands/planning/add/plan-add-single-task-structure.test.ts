import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";
import { freshRun } from "../../fixtures/plan-workflow-fixture.ts";

const roots: string[] = [];

describe("plan:add (single task) - Structure & Invariants", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
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
    await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);
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
