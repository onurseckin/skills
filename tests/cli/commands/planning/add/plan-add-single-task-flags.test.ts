import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { freshRun } from "../../fixtures/plan-workflow-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("plan:add (single task) - Flags & Validation", () => {
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
        "src/core",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/--gate is required/);
  });

  test("rejects unknown options", async () => {
    const { run } = await freshRun("add-unknown-flags", roots);
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
        "src/core",
        "--gate",
        "bun test src/core",
        "--not-a-flag",
        "true",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/unknown option: --not-a-flag/);
  });

  test("adds a valid single task and updates draft buffer", async () => {
    const { run } = await freshRun("add-valid-single", roots);
    const result = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core functionality",
      "--scope",
      "src/core",
      "--gate",
      "bun test src/core",
      "--actor",
      "planner",
    ]);

    expect(result.run_root).toBe(run);
    expect((result.task as { id: string }).id).toBe("task-core");
    expect(String(result.markdown)).toContain("### Task Registered: task-core");
  });

  test("a dependency without a justification is flagged in unjustified_dependencies", async () => {
    const { run } = await freshRun("add-dep-unjustified", roots);
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
});
