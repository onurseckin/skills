import { describe, expect, test } from "bun:test";
import { dependencyMap } from "../../../olt/scripts/src/graph/dependency-map.ts";
import { validateGraph } from "../../../olt/scripts/src/graph/validate-graph.ts";
import { proposeBatch } from "../../../olt/scripts/src/engine/scheduler/index.ts";
import { graphDocument, validPlanningDocuments } from "./fixtures.ts";

describe("graph dependencies", () => {
  test("dependency edges point from task to prerequisite", () => {
    const { graph, requirements } = validPlanningDocuments();
    expect(validateGraph(graph, requirements)).toEqual([]);
    expect(
      [...dependencyMap(graph)].map(([id, dependencies]) => [id, [...dependencies].sort()]),
    ).toEqual([
      ["task-1", []],
      ["task-2", ["task-1"]],
    ]);
  });

  test("execution cycle is rejected but relational topic cycle is allowed", () => {
    const { graph, requirements } = validPlanningDocuments();
    const cyclic = structuredClone(graph);
    (cyclic.edges as unknown[]).push({ source: "task-1", target: "task-2", type: "depends_on" });
    expect(validateGraph(cyclic, requirements)).not.toEqual([]);
    const relational = structuredClone(graph);
    (relational.nodes as unknown[]).push(
      { id: "topic-a", type: "topic", label: "Topic A" },
      { id: "topic-b", type: "topic", label: "Topic B" },
    );
    (relational.edges as unknown[]).push(
      { source: "topic-a", target: "topic-b", type: "relates_to" },
      { source: "topic-b", target: "topic-a", type: "relates_to" },
    );
    expect(validateGraph(relational, requirements)).toEqual([]);
  });

  test("dependency map rejects invalid graphs", () => {
    const { graph } = validPlanningDocuments();
    (graph.edges as unknown[]).push({ source: "task-1", target: "missing", type: "depends_on" });
    expect(() => dependencyMap(graph)).toThrow();
  });

  test("long dependency chain validates and schedules iteratively", () => {
    const prompt = "First";
    const { requirements } = validPlanningDocuments(prompt);
    const taskCount = 2_100;
    const graph = graphDocument(requirements);
    graph.nodes = [
      { id: "requirement-1", type: "requirement", label: "R-001", requirement_id: "R-001" },
      { id: "artifact-all", type: "artifact", label: "All output" },
      ...Array.from({ length: taskCount }, (_, index) => ({
        id: `chain-${index}`,
        type: "task",
        label: `Chain ${index}`,
        requirement_ids: ["R-001"],
        write_scope: [`chain/${index}`],
        resource_scope: [],
        artifact_ids: ["artifact-all"],
        status: index === 0 ? "ready" : "proposed",
        priority: 1,
        created_order: index,
        effort: 1,
      })),
    ];
    graph.edges = Array.from({ length: taskCount - 1 }, (_, offset) => ({
      source: `chain-${offset + 1}`,
      target: `chain-${offset}`,
      type: "depends_on",
    }));
    expect(validateGraph(graph, requirements)).toEqual([]);
    expect(dependencyMap(graph).get(`chain-${taskCount - 1}`)).toEqual(
      new Set([`chain-${taskCount - 2}`]),
    );
    const dependencySets = dependencyMap(graph);
    const tasks = Object.fromEntries(
      (graph.nodes as Record<string, unknown>[])
        .filter(({ type }) => type === "task")
        .map((task) => [
          task.id,
          {
            ...task,
            dependencies: [...(dependencySets.get(task.id as string) ?? [])],
          },
        ]),
    );
    expect(proposeBatch({ graph, tasks, requirements }, 1).map(({ id }) => id)).toEqual([
      "chain-0",
    ]);
  });
});
