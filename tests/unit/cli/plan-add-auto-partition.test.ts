import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { freshRun } from "./plan-workflow-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("plan:add --auto-partition", () => {
  test("refuses combining --auto-partition with --scope/--gate/--deps/--dep-reason", async () => {
    const { run } = await freshRun("auto-partition-exclusive", roots);
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task",
        "--label",
        "Task",
        "--auto-partition",
        "src/**/*.ts",
        "--gate-template",
        "bun test {scope}",
        "--scope",
        "src/whatever",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/cannot be combined with --scope/);
  });

  test("--gate-template must contain the {scope} placeholder", async () => {
    const { run } = await freshRun("auto-partition-bad-template", roots);
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task",
        "--label",
        "Task",
        "--auto-partition",
        "src/**/*.ts",
        "--gate-template",
        "bun test everything",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/must contain the literal placeholder \{scope\}/);
  });

  test("--group-by must be file or directory", async () => {
    const { run } = await freshRun("auto-partition-bad-groupby", roots);
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task",
        "--label",
        "Task",
        "--auto-partition",
        "src/**/*.ts",
        "--gate-template",
        "bun test {scope}",
        "--group-by",
        "package",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/must be 'file' or 'directory'/);
  });

  test("enumerates matching files and registers one task per match, defaulting group-by to file", async () => {
    const { repo, run } = await freshRun("auto-partition-basic", roots);
    await mkdir(join(repo, "src/area-a"), { recursive: true });
    await mkdir(join(repo, "src/area-b"), { recursive: true });
    await writeFile(join(repo, "src/area-a/one.ts"), "export const one = 1;\n");
    await writeFile(join(repo, "src/area-b/two.ts"), "export const two = 2;\n");

    const result = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-scope",
      "--label",
      "Scoped work",
      "--auto-partition",
      "src/**/*.ts",
      "--gate-template",
      "bun test {scope}",
      "--actor",
      "planner",
    ]);
    const autoPartition = result.auto_partition as { generated_task_ids: string[] };
    expect(autoPartition.generated_task_ids.length).toBe(2);
    expect(result.total_tasks).toBe(2);
    expect(String(result.markdown)).toContain("area-a");
  });

  test("refuses an auto-partition generated task id that already exists in the buffer", async () => {
    const { repo, run } = await freshRun("auto-partition-duplicate", roots);
    await mkdir(join(repo, "src/area-a"), { recursive: true });
    await writeFile(join(repo, "src/area-a/one.ts"), "export const one = 1;\n");
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-scope",
      "--label",
      "Scoped work",
      "--auto-partition",
      "src/**/*.ts",
      "--gate-template",
      "bun test {scope}",
      "--actor",
      "planner",
    ]);
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task-scope",
        "--label",
        "Scoped work again",
        "--auto-partition",
        "src/**/*.ts",
        "--gate-template",
        "bun test {scope}",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/already exists in planning buffer/);
  });

  test("refuses plan:add --auto-partition once the plan is compiled", async () => {
    const { repo, run } = await freshRun("auto-partition-after-compile", roots);
    await mkdir(join(repo, "src/core"), { recursive: true });
    await mkdir(join(repo, "src/area-a"), { recursive: true });
    await writeFile(join(repo, "src/area-a/one.ts"), "export const one = 1;\n");
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
        "task-scope",
        "--label",
        "Scoped work",
        "--auto-partition",
        "src/**/*.ts",
        "--gate-template",
        "bun test {scope}",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/cannot add tasks to compiled plan/);
  });
});
