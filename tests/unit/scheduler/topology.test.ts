import { describe, expect, test } from "bun:test";
import { isTopologyRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import { computeTopology } from "../../../olt/scripts/src/engine/scheduler/topology.ts";
import { topologyState } from "./fixtures.ts";

function decision(
  topology: ReturnType<typeof computeTopology>,
  taskId: string,
): (typeof topology.decisions)[number] {
  const found = topology.decisions.find((entry) => entry.task_id === taskId);
  if (!found) throw new Error(`no decision recorded for ${taskId}`);
  return found;
}

describe("computeTopology", () => {
  test("packs conflict-free waves and carries the graph revision", () => {
    const topology = computeTopology(topologyState(), { default_max_parallel: 4 });

    expect(topology.revision).toBe(3);
    expect(topology.max_parallel).toBe(4);
    expect(topology.waves).toEqual([
      { wave: 1, task_ids: ["t-alpha", "t-beta"] },
      { wave: 2, task_ids: ["t-beta-sub", "t-gamma"] },
    ]);
    expect(isTopologyRecord(topology)).toBeTrue();
  });

  test("names the reason that actually serialized each task", () => {
    const topology = computeTopology(topologyState(), { default_max_parallel: 4 });

    expect(decision(topology, "t-alpha")).toEqual({
      task_id: "t-alpha",
      wave: 1,
      parallel_with: ["t-beta"],
      serialized_after: [],
      reason: "priority_capacity",
      rationale: "wave 1: no dependency or scope conflict; ranked into a slot of max_parallel 4",
      evidence_class: "derived",
    });
    expect(decision(topology, "t-beta-sub")).toEqual({
      task_id: "t-beta-sub",
      wave: 2,
      parallel_with: ["t-gamma"],
      serialized_after: ["t-beta"],
      reason: "write_scope_conflict",
      rationale: "wave 2: write scope overlaps t-beta",
      evidence_class: "derived",
    });
    expect(decision(topology, "t-gamma")).toEqual({
      task_id: "t-gamma",
      wave: 2,
      parallel_with: ["t-beta-sub"],
      serialized_after: ["t-alpha"],
      reason: "dependency",
      rationale: "wave 2: depends on t-alpha",
      evidence_class: "derived",
    });
  });

  test("max_parallel caps the wave width", () => {
    const topology = computeTopology(topologyState(), { default_max_parallel: 1 });

    expect(topology.max_parallel).toBe(1);
    expect(topology.waves).toEqual([
      { wave: 1, task_ids: ["t-alpha"] },
      { wave: 2, task_ids: ["t-beta"] },
      { wave: 3, task_ids: ["t-beta-sub"] },
      { wave: 4, task_ids: ["t-gamma"] },
    ]);
    expect(decision(topology, "t-beta").reason).toBe("priority_capacity");
    expect(decision(topology, "t-beta").serialized_after).toEqual([]);
  });

  test("a supplied rationale is agent_reported and a blank one is never accepted", () => {
    const topology = computeTopology(
      topologyState(),
      { default_max_parallel: 4 },
      { rationales: { "t-gamma": "gamma waits for the alpha migration", "t-beta": "   " } },
    );

    expect(decision(topology, "t-gamma").rationale).toBe("gamma waits for the alpha migration");
    expect(decision(topology, "t-gamma").evidence_class).toBe("agent_reported");
    expect(decision(topology, "t-beta").evidence_class).toBe("derived");
    expect(decision(topology, "t-beta").rationale).toContain("wave 1");
  });

  test("tasks the scheduler can never make eligible stay out of the record", () => {
    const state = topologyState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks["t-beta"]!.status = "blocked";
    tasks["t-beta-sub"]!.status = "blocked";

    const topology = computeTopology(state, { default_max_parallel: 4 });
    expect(topology.waves).toEqual([
      { wave: 1, task_ids: ["t-alpha"] },
      { wave: 2, task_ids: ["t-gamma"] },
    ]);
    expect(topology.decisions.map((entry) => entry.task_id)).toEqual(["t-alpha", "t-gamma"]);
  });

  test("refuses to invent a revision, a plan or a parallelism cap", () => {
    expect(() => computeTopology({}, { default_max_parallel: 4 })).toThrow(
      "a plan must be applied before topology is recorded",
    );
    const noRevision = topologyState();
    delete (noRevision.graph as Record<string, unknown>).revision;
    expect(() => computeTopology(noRevision, { default_max_parallel: 4 })).toThrow(
      "graph revision is required to record topology",
    );
    expect(() => computeTopology(topologyState(), { default_max_parallel: 0 })).toThrow(
      "default_max_parallel must be a positive integer",
    );
  });

  test("re-validates tasks after cloning, in case a live getter changed shape mid-call", () => {
    // computeTopology re-checks `tasks` on the *cloned* state (line 68), not only on the
    // original — structuredClone re-reads every own property, so a stateful `tasks` getter that
    // was a valid record when first inspected (line 57) can still hand back something else by
    // the time the clone captures it. A plain object literal can never do this; only a getter
    // can, which is exactly the gap the second check exists to close.
    const base = topologyState();
    let reads = 0;
    const state = {
      graph: base.graph,
      requirements: base.requirements,
      get tasks() {
        reads += 1;
        return reads === 1 ? base.tasks : ["not", "a", "record"];
      },
    };
    expect(() => computeTopology(state, { default_max_parallel: 4 })).toThrow(
      "a plan must be applied before topology is recorded",
    );
  });

  test("a retry_ready task is dispatchable again without conflicting with itself", () => {
    const state = topologyState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks["t-alpha"]!.status = "retry_ready";

    const topology = computeTopology(state, { default_max_parallel: 4 });
    expect(topology.waves[0]?.task_ids).toContain("t-alpha");
  });
});

describe("derived rationale", () => {
  test("names dependencies and scope overlaps separately", () => {
    const state = topologyState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    // t-gamma already depends on t-alpha; widening its scope makes it overlap t-beta too.
    tasks["t-gamma"]!.write_scope = ["src/gamma", "src/beta/extra"];

    const topology = computeTopology(state, { default_max_parallel: 4 });
    const gamma = decision(topology, "t-gamma");

    expect(gamma.serialized_after).toEqual(["t-alpha", "t-beta"]);
    expect(gamma.rationale).toBe("wave 2: depends on t-alpha; write scope overlaps t-beta");
  });
});
