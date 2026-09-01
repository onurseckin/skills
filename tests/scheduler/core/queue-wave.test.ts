import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  queueListCommand,
  queueNextCommand,
  queuePopCommand,
  queueWaveCommand,
} from "../../../olt/scripts/src/cli/commands/queue.ts";
import { formatQueueWaveBrief } from "../../../olt/scripts/src/cli/formatters/queue-formatter.ts";
import { resetHarnessConfigCache } from "../../../olt/scripts/src/core/config/index.ts";
import { readySet, recordTopology } from "../../../olt/scripts/src/engine/scheduler/index.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../../reporting/browser/browser-virtual-fs.ts";
import { queueCapsuleState, schedulerState } from "../fixtures.ts";

interface ReadyEntryShape {
  task_id: string;
  label: string | null;
  recorded_wave: number | null;
  write_scope: string[];
}

function compiledRun(name: string, maxParallel?: number): string {
  const repo = tempDir(`harness-${name}`);
  if (maxParallel !== undefined) {
    fs.writeFileSync(
      join(repo, "harness.config.json"),
      JSON.stringify({ default_max_parallel: maxParallel }),
    );
  }
  const runRoot = initRun(
    repo,
    `${name}-run`,
    new TextEncoder().encode("Fixture prompt"),
    "file",
    true,
  );
  transact(runRoot, "planner", "plan-applied", {}, (draft) => {
    const seed = queueCapsuleState();
    draft.graph = seed.graph;
    draft.requirements = seed.requirements;
    draft.tasks = seed.tasks;
  });
  return runRoot;
}

describe("queue:wave", () => {
  beforeEach(() => {
    setupVirtualBrowserFS();
  });

  afterEach(() => {
    resetHarnessConfigCache();
    cleanupVirtualBrowserFS();
  });

  test("lists every claimable task, where queue:next names only the first", () => {
    const run = compiledRun("wave-batch", 4);

    const next = queueNextCommand({ run });
    expect((next.task as { id: string }).id).toBe("t-alpha");

    const wave = queueWaveCommand({ run });
    const entries = wave.wave as ReadyEntryShape[];
    expect(entries.map((entry) => entry.task_id)).toEqual(["t-alpha", "t-beta"]);
    expect(entries[0]!.label).toBe("Label t-alpha");
    expect(entries[0]!.write_scope).toEqual(["src/alpha"]);
    expect(wave.max_parallel).toBe(4);
    expect(String(wave.markdown)).toContain("### Claimable Now: 2/4 conflict-free tasks");
    expect(String(wave.markdown)).toContain("each row is independently claimable now");
  });

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

  test("annotates each task with the wave plan:compile recorded", () => {
    const run = compiledRun("wave-recorded");
    recordTopology(run, "planner", { default_max_parallel: 4 });

    const wave = queueWaveCommand({ run });
    expect(wave.topology_source).toBe("recorded");
    expect(wave.topology_revision).toBe(1);
    expect((wave.wave as ReadyEntryShape[]).map((entry) => entry.recorded_wave)).toEqual([1, 1]);
    expect(String(wave.markdown)).toContain("recorded at graph revision 1");
  });

  test("a task recorded into a later wave dispatches alongside an earlier one once capacity allows it", () => {
    const run = compiledRun("wave-not-a-barrier");
    const { topology } = recordTopology(run, "planner", { default_max_parallel: 1 });
    expect(topology.waves.slice(0, 2)).toEqual([
      { wave: 1, task_ids: ["t-alpha"] },
      { wave: 2, task_ids: ["t-beta"] },
    ]);

    const wave = queueWaveCommand({ run, "max-parallel": "4" });
    const entries = wave.wave as ReadyEntryShape[];
    expect(entries.map((entry) => entry.task_id)).toEqual(["t-alpha", "t-beta"]);
    expect(entries.map((entry) => entry.recorded_wave)).toEqual([1, 2]);
  });

  test("--max-parallel overrides the configured cap", () => {
    const run = compiledRun("wave-cap");

    const wave = queueWaveCommand({ run, "max-parallel": "1" });
    expect((wave.wave as ReadyEntryShape[]).map((entry) => entry.task_id)).toEqual(["t-alpha"]);
    expect(wave.max_parallel).toBe(1);
  });

  test("the configured default_max_parallel drives the wave and the queue summary", () => {
    const run = compiledRun("wave-config", 7);

    const wave = queueWaveCommand({ run });
    expect(wave.max_parallel).toBe(7);

    const list = queueListCommand({ run });
    expect(list.max_parallel).toBe(7);
    expect(String(list.markdown)).toContain("0/7 active lanes utilized");
  });

  test("an exhausted queue returns an empty wave instead of an error", async () => {
    const run = compiledRun("wave-empty");
    await queuePopCommand({ run, agent: "worker-alpha" });
    await queuePopCommand({ run, agent: "worker-beta" });

    const wave = queueWaveCommand({ run });
    expect(wave.wave).toEqual([]);
    expect(String(wave.markdown)).toContain("### Queue Status:");
  });
});
