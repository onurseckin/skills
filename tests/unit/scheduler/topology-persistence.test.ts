import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { readTopology } from "../../../orchestrating-long-tasks/scripts/src/contracts/topology.ts";
import { recordTopology } from "../../../orchestrating-long-tasks/scripts/src/scheduler/index.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function compiledRun(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Alpha work\n\nBeta work\n\nNested beta work\n\nGamma work");

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    `${name}-run`,
    "--prompt-file",
    promptPath,
  ]);
  const run = init.run_root as string;

  const declarations = [
    { id: "t-alpha", scope: "src/alpha", deps: [] as string[] },
    { id: "t-beta", scope: "src/beta", deps: [] },
    { id: "t-gamma", scope: "src/gamma", deps: ["t-alpha"] },
  ];
  for (const declaration of declarations) {
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      declaration.id,
      "--label",
      declaration.id,
      "--scope",
      declaration.scope,
      "--gate",
      `bun test ${declaration.scope}`,
      "--actor",
      "planner",
      ...(declaration.deps.length > 0 ? ["--deps", declaration.deps.join(",")] : []),
      ...declaration.deps.flatMap((dep) => [
        "--dep-reason",
        `${dep}:fixture-declared ordering dependency`,
      ]),
    ]);
  }
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
    "--accept-audit",
    "A4-false-barrier:t-gamma's ordering is this fixture's whole point, not a real read/write relationship",
  ]);
  return run;
}

describe("topology persistence", () => {
  test("recordTopology writes state.topology through the hash chain", async () => {
    const run = await compiledRun("topology-record");

    const { topology } = recordTopology(run, "planner", { default_max_parallel: 4 });
    expect(topology.waves).toEqual([
      { wave: 1, task_ids: ["t-alpha", "t-beta"] },
      { wave: 2, task_ids: ["t-gamma"] },
    ]);

    const reloaded = loadRun(run);
    expect(readTopology(reloaded.state)).toEqual(topology);

    const events = (await readFile(join(run, "events.jsonl"), "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string; payload: Record<string, unknown> });
    const recorded = events.at(-1)!;
    expect(recorded.kind).toBe("topology-recorded");
    expect(recorded.payload).toEqual({
      revision: 1,
      wave_count: 2,
      task_count: 3,
      max_parallel: 4,
    });
    expect(reloaded.state.event_head).toBe((events.at(-1) as unknown as { hash: string }).hash);
  });

  test("recordTopology replaces the previous record without touching other state", async () => {
    const run = await compiledRun("topology-replace");
    recordTopology(run, "planner", { default_max_parallel: 4 });

    const { topology: narrow } = recordTopology(run, "coordinator", { default_max_parallel: 1 });

    const state = loadRun(run).state;
    expect(readTopology(state)).toEqual(narrow);
    expect(readTopology(state)?.waves).toHaveLength(3);
    expect(Object.keys(state.tasks as Record<string, unknown>)).toHaveLength(3);
  });

  test("capsules written before topology existed still load and report no record", () => {
    const capsule = join(
      import.meta.dir,
      "..",
      "..",
      "..",
      ".capsules",
      "2026-08-17-skills-documentation-elevation",
    );
    const loaded = loadRun(capsule);

    expect(loaded.manifest.schema).toBe("harness.manifest");
    expect(Object.keys(loaded.state.tasks as Record<string, unknown>)).toHaveLength(3);
    expect(readTopology(loaded.state)).toBeNull();
  });
});
