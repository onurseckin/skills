import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { readTopology } from "../../orchestrating-long-tasks/scripts/src/contracts/topology.ts";
import { loadRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";

const PROMPT = "Rebuild the drawer\n\nWire the store\nShip the fixture";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function initialisedRun(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, PROMPT);
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    `${name}-run`,
    "--prompt-file",
    promptPath,
  ]);
  return init.run_root as string;
}

function addTask(
  run: string,
  id: string,
  lines?: string,
  criteria?: string,
): Promise<Record<string, unknown>> {
  return execute([
    "plan:add",
    "--run",
    run,
    "--id",
    id,
    "--label",
    `Label ${id}`,
    "--scope",
    `src/${id}`,
    "--gate",
    `bun test tests/${id}`,
    "--actor",
    "planner",
    ...(lines === undefined ? [] : ["--requirement-lines", lines]),
    ...(criteria === undefined ? [] : ["--criteria", criteria]),
  ]);
}

describe("plan:add --requirement-lines", () => {
  test("binds the task to the declared prompt lines", async () => {
    const run = await initialisedRun("bind-explicit");

    const added = await addTask(run, "task-a", "3-4");
    expect((added.task as { requirementLines?: number[] }).requirementLines).toEqual([3, 4]);
    expect(String(added.markdown)).toContain("**Prompt Binding**: Declared prompt lines 3, 4");

    await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    const requirements = loadRun(run).state.requirements as {
      requirements: { id: string; source_lines: number[]; source_excerpt: string }[];
    };
    expect(requirements.requirements[0]).toMatchObject({
      id: "req-a",
      source_lines: [3, 4],
      source_excerpt: "Wire the store\nShip the fixture",
    });
  });

  test("warns in the add brief when the binding is left to position", async () => {
    const run = await initialisedRun("bind-positional-brief");

    const added = await addTask(run, "task-a");
    expect(String(added.markdown)).toContain("⚠️ Positional fallback");
  });

  test("rejects a spec the prompt cannot honour", async () => {
    const run = await initialisedRun("bind-invalid");

    await expect(addTask(run, "task-a", "2")).rejects.toThrow("references blank prompt line 2");
    await expect(addTask(run, "task-a", "9")).rejects.toThrow(
      "references line 9, outside the 4-line prompt",
    );
  });
});

describe("plan:compile", () => {
  test("warns in the brief when positional gluing fires, and stays silent when it does not", async () => {
    const run = await initialisedRun("compile-warn");
    await addTask(run, "task-a", "3-4", "Store subscribes to the drawer state");
    await addTask(run, "task-b", undefined, "Fixture ships with the drawer wired");

    const compiled = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compiled.warnings).toEqual([
      "task task-b was glued to prompt line 1 by position, not by declaration; pass --requirement-lines to bind it to the lines it actually implements",
    ]);
    expect(String(compiled.markdown)).toContain("⚠️ [PROMPT BINDING]: task task-b was glued");

    const bound = await initialisedRun("compile-bound");
    await addTask(bound, "task-a", "1", "Drawer rebuild lands with a passing gate");
    await addTask(bound, "task-b", "3-4", "Store and fixture wiring lands with a passing gate");
    const clean = await execute([
      "plan:compile",
      "--run",
      bound,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(clean.warnings).toEqual([]);
    expect(String(clean.markdown)).not.toContain("PROMPT BINDING");
  });

  test("records the topology decision so the queue does not re-derive it", async () => {
    const run = await initialisedRun("compile-topology");
    await addTask(run, "task-a", "1");
    await addTask(run, "task-b", "3-4");

    const compiled = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    // The brief reports the record, not a second derivation: one wave holding both tasks.
    expect(String(compiled.markdown)).toContain(
      "**Recorded Waves**: 1 (topology revision 1, max_parallel 4)",
    );
    expect(String(compiled.markdown)).toContain(
      "**Wave 1 (Ready Now)**: `task-a`, `task-b` (2 parallel lanes)",
    );

    const loaded = loadRun(run);
    const topology = readTopology(loaded.state);
    expect(topology).not.toBeNull();
    expect(topology!.revision).toBe(1);
    expect(topology!.waves).toEqual([{ wave: 1, task_ids: ["task-a", "task-b"] }]);
    expect(topology!.decisions.map((decision) => decision.evidence_class)).toEqual([
      "derived",
      "derived",
    ]);
    expect(loaded.events.filter((event) => event.kind === "topology-recorded")).toHaveLength(1);

    const wave = await execute(["queue:wave", "--run", run]);
    expect(wave.topology_source).toBe("recorded");
    expect(wave.topology_revision).toBe(1);
  });
});
