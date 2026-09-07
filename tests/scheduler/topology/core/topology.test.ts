import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { isTopologyRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { computeTopology } from "../../../../olt/scripts/src/engine/scheduler/topology/topology.ts";
import { topologyState } from "../../fixtures.ts";

function decision(
  topology: ReturnType<typeof computeTopology>,
  taskId: string,
): (typeof topology.decisions)[number] {
  const found = topology.decisions.find((entry) => entry.task_id === taskId);
  if (!found) throw new Error(`no decision recorded for ${taskId}`);
  return found;
}

describe("computeTopology", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
    vfs.reset();
  });
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

  test("serializes tasks with disjoint write_scope but conflicting resource_scope into separate waves", () => {
    const state = topologyState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks["t-alpha"]!.write_scope = ["src/alpha.ts"];
    tasks["t-alpha"]!.resource_scope = ["gpu:cluster-1"];
    tasks["t-beta"]!.write_scope = ["src/beta.ts"];
    tasks["t-beta"]!.resource_scope = ["gpu:cluster-1"];

    const topology = computeTopology(state, { default_max_parallel: 4 });
    const alpha = decision(topology, "t-alpha");
    const beta = decision(topology, "t-beta");
    expect(alpha.wave).toBe(1);
    expect(beta.wave).toBe(2);
    expect(beta.reason).toBe("write_scope_conflict");
    expect(beta.serialized_after).toContain("t-alpha");
  });

  test("handles empty plan tasks map cleanly producing empty waves and decisions", () => {
    const state = topologyState();
    state.tasks = {};

    const topology = computeTopology(state, { default_max_parallel: 4 });
    expect(topology.waves).toEqual([]);
    expect(topology.decisions).toEqual([]);
    expect(isTopologyRecord(topology)).toBeTrue();
  });

  test("packs all independent tasks into wave 1 when default_max_parallel is large", () => {
    const state = topologyState();
    const topology = computeTopology(state, { default_max_parallel: 100 });
    expect(topology.max_parallel).toBe(100);
    expect(topology.waves[0]?.task_ids).toContain("t-alpha");
    expect(topology.waves[0]?.task_ids).toContain("t-beta");
  });

  test("attributes reason to dependency when a task both depends on prerequisite and overlaps scope", () => {
    const state = topologyState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks["t-gamma"]!.write_scope = ["src/gamma", "src/beta/extra"];

    const topology = computeTopology(state, { default_max_parallel: 4 });
    const gamma = decision(topology, "t-gamma");
    expect(gamma.reason).toBe("dependency");
    expect(gamma.serialized_after).toEqual(["t-alpha", "t-beta"]);
  });
});

describe("derived rationale", () => {
  test("names dependencies and scope overlaps separately", () => {
    const state = topologyState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;

    tasks["t-gamma"]!.write_scope = ["src/gamma", "src/beta/extra"];

    const topology = computeTopology(state, { default_max_parallel: 4 });
    const gamma = decision(topology, "t-gamma");

    expect(gamma.serialized_after).toEqual(["t-alpha", "t-beta"]);
    expect(gamma.rationale).toBe("wave 2: depends on t-alpha; write scope overlaps t-beta");
  });
});
