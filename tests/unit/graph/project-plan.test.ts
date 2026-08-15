import { describe, expect, test } from "bun:test";
import { projectPlan } from "../../../orchestrating-long-tasks/scripts/src/graph/project-plan.ts";
import { validPlanningDocuments } from "./fixtures.ts";
import { dependencyMap } from "../../../orchestrating-long-tasks/scripts/src/graph/dependency-map.ts";

describe("graph project plan", () => {
  test("initial projection establishes tasks, requirements, dependencies, and history", () => {
    const { requirements, graph } = validPlanningDocuments();
    const deps = dependencyMap(graph);
    const state: Record<string, unknown> = {
      revision: 0,
      plan_history: [],
    };

    projectPlan(state, requirements, graph, deps);
    expect(state.graph).toBeObject();
    expect(state.requirements).toBeObject();
    expect(state.task_order).toEqual(["task-1", "task-2"]);
    expect(
      (state.tasks as Record<string, { dependencies: string[] }>)["task-2"].dependencies,
    ).toEqual(["task-1"]);
  });

  test("preserves existing requirement runtime and task runtime across revisions", () => {
    const { requirements, graph } = validPlanningDocuments();
    const deps = dependencyMap(graph);
    const state: Record<string, unknown> = {
      revision: 1,
      plan_history: [],
      graph: { revision: 1 },
      requirements: {
        requirements: [
          {
            id: "R-001",
            status: "satisfied",
            evidence: [{ kind: "test" }],
            authority_status: "granted",
            authority_history: [{ decision: "grant" }],
          },
        ],
      },
      tasks: {
        "task-1": {
          id: "task-1",
          status: "done",
          lease: { agent_id: "a1" },
        },
      },
    };

    const nextGraph = structuredClone(graph);
    nextGraph.revision = 2;
    projectPlan(state, requirements, nextGraph, deps);

    const projectedReqs = (state.requirements as { requirements: Record<string, unknown>[] })
      .requirements;
    expect(projectedReqs[0].status).toBe("satisfied");
    expect(projectedReqs[0].authority_status).toBe("granted");

    const projectedTasks = state.tasks as Record<string, Record<string, unknown>>;
    expect(projectedTasks["task-1"].status).toBe("done");
    expect(projectedTasks["task-1"].lease).toEqual({ agent_id: "a1" });
    expect(state.plan_history).toHaveLength(1);
  });

  test("throws when plan_history is not an array or state has inconsistencies", () => {
    const { requirements, graph } = validPlanningDocuments();
    const deps = dependencyMap(graph);
    const state: Record<string, unknown> = {
      revision: 0,
      plan_history: "not-an-array",
    };

    expect(() => projectPlan(state, requirements, graph, deps)).toThrow(
      "plan_history must be a list",
    );

    // Invalid graph causing projection issues
    const invalidGraph = structuredClone(graph);
    const taskNode = (invalidGraph.nodes as Record<string, unknown>[]).find(
      (n) => n.type === "task",
    )!;
    taskNode.status = "invalid_status";
    const validState: Record<string, unknown> = { revision: 0, plan_history: [] };
    expect(() => projectPlan(validState, requirements, invalidGraph, deps)).toThrow(
      "projected plan is invalid",
    );
  });
});
