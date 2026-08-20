import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planAddCommand,
  planCompileCommand,
  planInitCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/plan.ts";
import { readTopology } from "../../../orchestrating-long-tasks/scripts/src/contracts/topology.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";

const PROMPT = "Rebuild the drawer\nWire the store\nShip the fixture";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function compiledRun(name: string, maxParallel: number): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, PROMPT);
  await writeFile(
    join(repo, "harness.config.json"),
    JSON.stringify({ default_max_parallel: maxParallel }),
  );
  const init = await planInitCommand({ repo, run: name, "prompt-file": promptPath });
  const run = init.run_root as string;
  for (const suffix of ["a", "b", "c"]) {
    planAddCommand({
      run,
      id: `task-${suffix}`,
      label: `Task ${suffix.toUpperCase()}`,
      scope: `src/${suffix}`,
      gate: `bun test tests/${suffix}`,
      actor: "planner",
    });
  }
  return run;
}

describe("plan:compile reports the topology it recorded", () => {
  test("waves in the brief are the recorded waves, capped by max_parallel", async () => {
    const run = await compiledRun("compile-brief-capped", 2);
    const result = planCompileCommand({
      run,
      actor: "planner",
      "completion-gate": "bun test tests",
    });
    const markdown = String(result.markdown);

    const topology = readTopology(loadRun(run).state);
    expect(topology).not.toBeNull();
    expect(topology!.max_parallel).toBe(2);
    expect(topology!.waves).toEqual([
      { wave: 1, task_ids: ["task-a", "task-b"] },
      { wave: 2, task_ids: ["task-c"] },
    ]);

    // Every wave the record holds, and no wave it does not: the old dependency-only analysis put all
    // three tasks in a single wave 0 because it never saw the parallelism cap.
    expect(markdown).toContain("**Recorded Waves**: 2 (topology revision 1, max_parallel 2)");
    expect(markdown).toContain("**Wave 1 (Ready Now)**: `task-a`, `task-b` (2 parallel lanes)");
    expect(markdown).toContain("**Wave 2 (Queued)**: `task-c` (1 parallel lane)");
    expect(markdown).not.toContain("Wave 0");
    expect(markdown).not.toContain("UNSCHEDULED");
  });

  test("a wider cap is reported as the single wave the scheduler recorded", async () => {
    const run = await compiledRun("compile-brief-wide", 4);
    const result = planCompileCommand({
      run,
      actor: "planner",
      "completion-gate": "bun test tests",
    });
    const markdown = String(result.markdown);

    const topology = readTopology(loadRun(run).state);
    expect(topology!.waves).toEqual([{ wave: 1, task_ids: ["task-a", "task-b", "task-c"] }]);
    expect(markdown).toContain("**Recorded Waves**: 1 (topology revision 1, max_parallel 4)");
    expect(markdown).toContain(
      "**Wave 1 (Ready Now)**: `task-a`, `task-b`, `task-c` (3 parallel lanes)",
    );
  });
});
