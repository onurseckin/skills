import { describe, expect, test } from "bun:test";
import { guardPlanRevision } from "../../olt/scripts/src/graph/revision-guard.ts";
import { validPlanningDocuments } from "./fixtures.ts";
import { dependencyMap } from "../../olt/scripts/src/graph/dependency-map.ts";

describe("graph revision guard", () => {
  test("enforces initial revision and sequential increments", () => {
    const { requirements, graph } = validPlanningDocuments();
    const deps = dependencyMap(graph);

    // Initial revision must be 1
    const invalidInitGraph = structuredClone(graph);
    invalidInitGraph.revision = 2;
    expect(() => guardPlanRevision({}, requirements, invalidInitGraph, deps)).toThrow(
      "initial graph revision must be 1",
    );

    // Initial revision 1 succeeds
    expect(() => guardPlanRevision({}, requirements, graph, deps)).not.toThrow();

    // Subsequent revision must increase by exactly 1
    const state = {
      graph: { revision: 1, nodes: graph.nodes, edges: graph.edges },
      requirements,
      tasks: {},
    };
    const invalidNextGraph = structuredClone(graph);
    invalidNextGraph.revision = 3;
    expect(() => guardPlanRevision(state, requirements, invalidNextGraph, deps)).toThrow(
      "graph revision must increase by exactly one",
    );
  });

  test("rejects requirement contract alterations and malformed tasks projection", () => {
    const { requirements, graph } = validPlanningDocuments();
    const deps = dependencyMap(graph);
    const state = {
      graph: { revision: 1, nodes: graph.nodes, edges: graph.edges },
      requirements,
      tasks: "invalid-tasks",
    };

    const nextGraph = structuredClone(graph);
    nextGraph.revision = 2;

    const modifiedReqs = structuredClone(requirements);
    (modifiedReqs.requirements as Record<string, unknown>[])[0].instruction = "Changed instruction";
    expect(() => guardPlanRevision(state, modifiedReqs, nextGraph, deps)).toThrow(
      "cannot change requirement source contracts",
    );

    expect(() => guardPlanRevision(state, requirements, nextGraph, deps)).toThrow(
      "tasks projection must be an object",
    );
  });

  test("validates active and planned task preservation across revisions", () => {
    const { requirements, graph } = validPlanningDocuments();
    const deps = dependencyMap(graph);

    const nextGraph = structuredClone(graph);
    nextGraph.revision = 2;
    // Remove task-1 from nextGraph
    nextGraph.nodes = (nextGraph.nodes as Record<string, unknown>[]).filter(
      (node) => node.id !== "task-1",
    );

    // Active task removed throws error
    const activeState = {
      graph: { revision: 1, nodes: graph.nodes, edges: graph.edges },
      requirements,
      tasks: {
        "task-1": { status: "running", dependencies: [] },
      },
    };
    expect(() => guardPlanRevision(activeState, requirements, nextGraph, deps)).toThrow(
      "plan revision cannot delete active task task-1",
    );

    // Planned task removed without supersession decision throws error
    const plannedState = {
      graph: { revision: 1, nodes: graph.nodes, edges: graph.edges },
      requirements,
      tasks: {
        "task-1": { status: "proposed", dependencies: [] },
      },
    };
    expect(() => guardPlanRevision(plannedState, requirements, nextGraph, deps)).toThrow(
      "plan revision cannot remove planned task task-1 without supersedes explanation",
    );

    // Active task missing from prior graph
    const missingPriorState = {
      graph: { revision: 1, nodes: [], edges: [] },
      requirements,
      tasks: {
        "task-1": { status: "running", dependencies: [] },
      },
    };
    const validNextGraph = structuredClone(graph);
    validNextGraph.revision = 2;
    expect(() => guardPlanRevision(missingPriorState, requirements, validNextGraph, deps)).toThrow(
      "active task task-1 is missing from the prior graph",
    );

    // Active task with invalid dependency history
    const invalidDepsState = {
      graph: { revision: 1, nodes: graph.nodes, edges: graph.edges },
      requirements,
      tasks: {
        "task-1": { status: "running", dependencies: [123] },
      },
    };
    expect(() => guardPlanRevision(invalidDepsState, requirements, validNextGraph, deps)).toThrow(
      "active task task-1 has invalid dependency history",
    );
  });

  test("a done task may gain a sibling gate on its own requirement, but an in-flight task may not", () => {
    // This is the plan:replan scenario a completeness critic drives: a repair task inherits
    // task-1's requirement and gets its own new task-scoped gate. taskGates() selects gates by
    // requirement overlap, so that new gate now also shows up for task-1 even though task-1
    // itself was never touched. A done task must tolerate that; a task still in flight must not.
    const requirements = { requirements: [{ id: "req-1", instruction: "Do it" }] };
    const baseGraph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [
        { id: "node-req-1", type: "requirement", requirement_id: "req-1" },
        { id: "artifact-1", type: "artifact" },
        {
          id: "task-1",
          type: "task",
          requirement_ids: ["req-1"],
          write_scope: ["src/a"],
          resource_scope: [],
          artifact_ids: ["artifact-1"],
          status: "done",
          priority: 50,
          effort: 3,
          created_order: 1,
        },
      ],
      edges: [{ source: "task-1", target: "artifact-1", type: "produces" }],
      gates: [
        {
          id: "gate-1",
          command: ["bun", "gate-1.ts"],
          cwd: ".",
          scope: "task",
          requirement_ids: ["req-1"],
          mandatory: true,
        },
      ],
    };
    const deps1 = dependencyMap(baseGraph);

    const withSiblingGate = structuredClone(baseGraph);
    withSiblingGate.revision = 2;
    withSiblingGate.gates.push({
      id: "gate-repair-1",
      command: ["bun", "repair-1.ts"],
      cwd: ".",
      scope: "task",
      requirement_ids: ["req-1"],
      mandatory: true,
    });

    const doneState = {
      graph: {
        revision: 1,
        nodes: baseGraph.nodes,
        edges: baseGraph.edges,
        gates: baseGraph.gates,
      },
      requirements,
      tasks: { "task-1": { status: "done", dependencies: [] } },
    };
    expect(() => guardPlanRevision(doneState, requirements, withSiblingGate, deps1)).not.toThrow();

    const inFlightState = {
      ...doneState,
      tasks: { "task-1": { status: "running", dependencies: [] } },
    };
    expect(() => guardPlanRevision(inFlightState, requirements, withSiblingGate, deps1)).toThrow(
      "plan revision cannot change active task task-1 gates",
    );

    // A done task's own contract is still frozen: rewriting its write_scope is not a sibling-gate
    // side effect and must still refuse, even though its gate set is allowed to grow.
    const contractChanged = structuredClone(baseGraph);
    contractChanged.revision = 2;
    (contractChanged.nodes.find((n) => n.id === "task-1") as Record<string, unknown>).write_scope =
      ["src/b"];
    expect(() => guardPlanRevision(doneState, requirements, contractChanged, deps1)).toThrow(
      "plan revision cannot change active task task-1 contract",
    );
  });
});
