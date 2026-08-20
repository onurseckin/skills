import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { formatQueueWaveBrief } from "../../../orchestrating-long-tasks/scripts/src/cli/formatters/queue-formatter.ts";
import { resetHarnessConfigCache } from "../../../orchestrating-long-tasks/scripts/src/config/harness-config.ts";
import {
  readySet,
  recordTopology,
} from "../../../orchestrating-long-tasks/scripts/src/scheduler/index.ts";
import { schedulerState } from "./fixtures.ts";

interface ReadyEntryShape {
  task_id: string;
  label: string | null;
  recorded_wave: number | null;
  write_scope: string[];
}

const roots: string[] = [];
afterEach(async () => {
  resetHarnessConfigCache();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function compiledRun(name: string, maxParallel?: number): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  if (maxParallel !== undefined) {
    await writeFile(
      join(repo, "harness.config.json"),
      JSON.stringify({ default_max_parallel: maxParallel }),
    );
  }
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Alpha work\n\nBeta work\n\nGamma work");

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

  for (const declaration of [
    { id: "t-alpha", scope: "src/alpha", deps: [] as string[] },
    { id: "t-beta", scope: "src/beta", deps: [] },
    { id: "t-gamma", scope: "src/gamma", deps: ["t-alpha"] },
  ]) {
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      declaration.id,
      "--label",
      `Label ${declaration.id}`,
      "--scope",
      declaration.scope,
      "--gate",
      `bun test ${declaration.scope}`,
      "--actor",
      "planner",
      ...(declaration.deps.length > 0 ? ["--deps", declaration.deps.join(",")] : []),
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
  ]);
  return run;
}

describe("queue:wave", () => {
  test("lists every claimable task, where queue:next names only the first", async () => {
    const run = await compiledRun("wave-batch");

    const next = await execute(["queue:next", "--run", run]);
    expect((next.task as { id: string }).id).toBe("t-alpha");

    const wave = await execute(["queue:wave", "--run", run]);
    const entries = wave.wave as ReadyEntryShape[];
    expect(entries.map((entry) => entry.task_id)).toEqual(["t-alpha", "t-beta"]);
    expect(entries[0]!.label).toBe("Label t-alpha");
    expect(entries[0]!.write_scope).toEqual(["src/alpha"]);
    expect(wave.max_parallel).toBe(4);
    expect(String(wave.markdown)).toContain("### Claimable Now: 2/4 conflict-free tasks");
    expect(String(wave.markdown)).toContain("each row is independently claimable now");
  });

  // plan:compile records the topology, so the absent path belongs to capsules compiled before it
  // did; the state fixture stands in for one.
  test("reports an unrecorded topology as absent and never guesses a wave number", () => {
    const selection = readySet(schedulerState(), 4);

    expect(selection.topology_source).toBe("absent");
    expect(selection.topology_revision).toBeNull();
    expect(selection.entries.every((entry) => entry.recorded_wave === null)).toBeTrue();
    expect(
      formatQueueWaveBrief({
        runId: "legacy-run",
        entries: selection.entries.map((entry) => ({
          taskId: entry.task_id,
          label: entry.label,
          priority: entry.priority,
          writeScope: entry.write_scope,
          recordedWave: entry.recorded_wave,
        })),
        maxParallel: selection.max_parallel,
        topologySource: selection.topology_source,
        topologyRevision: selection.topology_revision,
      }),
    ).toContain("not recorded for this capsule");
  });

  test("annotates each task with the wave plan:compile recorded", async () => {
    const run = await compiledRun("wave-recorded");
    recordTopology(run, "planner", { default_max_parallel: 4 });

    const wave = await execute(["queue:wave", "--run", run]);
    expect(wave.topology_source).toBe("recorded");
    expect(wave.topology_revision).toBe(1);
    expect((wave.wave as ReadyEntryShape[]).map((entry) => entry.recorded_wave)).toEqual([1, 1]);
    expect(String(wave.markdown)).toContain("recorded at graph revision 1");
  });

  test("--max-parallel overrides the configured cap", async () => {
    const run = await compiledRun("wave-cap");

    const wave = await execute(["queue:wave", "--run", run, "--max-parallel", "1"]);
    expect((wave.wave as ReadyEntryShape[]).map((entry) => entry.task_id)).toEqual(["t-alpha"]);
    expect(wave.max_parallel).toBe(1);
  });

  test("the configured default_max_parallel drives the wave and the queue summary", async () => {
    const run = await compiledRun("wave-config", 7);

    const wave = await execute(["queue:wave", "--run", run]);
    expect(wave.max_parallel).toBe(7);

    const list = await execute(["queue:list", "--run", run]);
    expect(list.max_parallel).toBe(7);
    expect(String(list.markdown)).toContain("0/7 active lanes utilized");
  });

  test("an exhausted queue returns an empty wave instead of an error", async () => {
    const run = await compiledRun("wave-empty");
    await execute(["queue:pop", "--run", run, "--agent", "worker-alpha"]);
    await execute(["queue:pop", "--run", run, "--agent", "worker-beta"]);

    const wave = await execute(["queue:wave", "--run", run]);
    expect(wave.wave).toEqual([]);
    expect(String(wave.markdown)).toContain("### Queue Status:");
  });
});
