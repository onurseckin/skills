import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTopology } from "../../../olt/scripts/src/contracts/topology.ts";
import { recordTopology } from "../../../olt/scripts/src/scheduler/index.ts";
import { initRun, loadRun, transact } from "../../../olt/scripts/src/store/index.ts";
import { queueCapsuleState } from "./fixtures.ts";
import { legacyPreLedgerCapsule } from "../../support/legacy-capsule-fixture.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function compiledRun(name: string): string {
  const repo = mkdtempSync(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
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

describe("topology persistence", () => {
  test("recordTopology writes state.topology through the hash chain", () => {
    const run = compiledRun("topology-record");

    const { topology } = recordTopology(run, "planner", { default_max_parallel: 4 });
    expect(topology.waves).toEqual([
      { wave: 1, task_ids: ["t-alpha", "t-beta"] },
      { wave: 2, task_ids: ["t-gamma"] },
    ]);

    const reloaded = loadRun(run);
    expect(readTopology(reloaded.state)).toEqual(topology);

    const events = readFileSync(join(run, "events.jsonl"), "utf-8")
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

  test("recordTopology replaces the previous record without touching other state", () => {
    const run = compiledRun("topology-replace");
    recordTopology(run, "planner", { default_max_parallel: 4 });

    const { topology: narrow } = recordTopology(run, "coordinator", { default_max_parallel: 1 });

    const state = loadRun(run).state;
    expect(readTopology(state)).toEqual(narrow);
    expect(readTopology(state)?.waves).toHaveLength(3);
    expect(Object.keys(state.tasks as Record<string, unknown>)).toHaveLength(3);
  });

  test("capsules written before topology existed still load and report no record", () => {
    const loaded = loadRun(legacyPreLedgerCapsule(import.meta.path));

    expect(loaded.manifest.schema).toBe("harness.manifest");
    expect(Object.keys(loaded.state.tasks as Record<string, unknown>)).toHaveLength(3);
    expect(readTopology(loaded.state)).toBeNull();
  });
});
