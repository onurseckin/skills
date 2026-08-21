import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { freshRun } from "./plan-workflow-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("plan:enhance", () => {
  test("writes an enhanced plan document and reports revision 1 on the first call", async () => {
    const { run } = await freshRun("enhance-first", roots);
    const result = await execute([
      "plan:enhance",
      "--run",
      run,
      "--actor",
      "planner",
      "--summary",
      "This run wires the drawer to the graph store",
      "--observation",
      "The store already exposes a subscribe hook",
      "--todo",
      "Add the state machine tab",
      "--risk",
      "Fixture dataset predates the schema",
      "--open-question",
      "Should the drawer persist across reloads?",
      "--source",
      "src/graph/store.ts",
    ]);
    expect(result.revision).toBe(1);
    const enhanced = result.enhanced_plan as { counts: Record<string, number> };
    expect(enhanced.counts.observations).toBe(1);
    expect(enhanced.counts.todos).toBe(1);
    expect(String(result.markdown)).toContain("enhanced");
  });

  test("a second plan:enhance call increments the revision", async () => {
    const { run } = await freshRun("enhance-revision", roots);
    await execute(["plan:enhance", "--run", run, "--actor", "planner", "--summary", "First pass"]);
    const second = await execute([
      "plan:enhance",
      "--run",
      run,
      "--actor",
      "planner",
      "--summary",
      "Second pass, more informed",
    ]);
    expect(second.revision).toBe(2);
  });
});

describe("plan:status", () => {
  test("reports the uncompiled buffer with is_compiled false", async () => {
    const { run } = await freshRun("status-uncompiled", roots);
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
    const status = await execute(["plan:status", "--run", run]);
    expect(status.is_compiled).toBe(false);
    const tasks = status.tasks as { id: string; gate: string }[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.gate).toBe("bun test src/a");
  });

  test("reports is_compiled true once plan:compile has run", async () => {
    const { repo, run } = await freshRun("status-compiled", roots);
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
    const status = await execute(["plan:status", "--run", run]);
    expect(status.is_compiled).toBe(true);
  });
});
