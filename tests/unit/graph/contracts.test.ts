import { describe, expect, test } from "bun:test";
import { validateGraph } from "../../../orchestrating-long-tasks/scripts/src/graph/validate-graph.ts";
import { taskById, validPlanningDocuments } from "./fixtures.ts";

describe("graph contracts", () => {
  test("tasks need valid requirements normalized scopes and artifacts", () => {
    const { graph, requirements } = validPlanningDocuments();
    const variants: Record<string, unknown>[] = [];
    for (const scope of ["/absolute", "a/../b", "a//b", ".", "a\\b"]) {
      const invalid = structuredClone(graph);
      taskById(invalid, "task-1").write_scope = [scope];
      variants.push(invalid);
    }
    const noRequirement = structuredClone(graph);
    taskById(noRequirement, "task-1").requirement_ids = [];
    variants.push(noRequirement);
    const unknownRequirement = structuredClone(graph);
    taskById(unknownRequirement, "task-1").requirement_ids = ["R-999"];
    variants.push(unknownRequirement);
    const noArtifact = structuredClone(graph);
    noArtifact.edges = (noArtifact.edges as Record<string, unknown>[]).filter(
      ({ source, type }) => source !== "task-1" || type !== "produces",
    );
    variants.push(noArtifact);
    const badResource = structuredClone(graph);
    taskById(badResource, "task-1").resource_scope = ["browser:session", "browser:session"];
    variants.push(badResource);
    for (const candidate of variants)
      expect(validateGraph(candidate, requirements)).not.toEqual([]);
  });

  test("full requirement task and mandatory gate coverage is required", () => {
    const { graph, requirements } = validPlanningDocuments();
    const missingNode = structuredClone(graph);
    missingNode.nodes = (missingNode.nodes as Record<string, unknown>[]).filter(
      ({ requirement_id }) => requirement_id !== "R-002",
    );
    const missingTask = structuredClone(graph);
    taskById(missingTask, "task-2").requirement_ids = ["R-001"];
    const optionalGate = structuredClone(graph);
    (optionalGate.gates as Record<string, unknown>[])[0]!.mandatory = false;
    for (const candidate of [missingNode, missingTask, optionalGate])
      expect(validateGraph(candidate, requirements)).not.toEqual([]);
  });

  test("duplicate edges unknown endpoints and malformed types are rejected", () => {
    const { graph, requirements } = validPlanningDocuments();
    const variants = Array.from({ length: 8 }, () => structuredClone(graph));
    (variants[0]!.edges as unknown[]).push(structuredClone((variants[0]!.edges as unknown[])[0]));
    (variants[1]!.edges as unknown[]).push({
      source: "task-1",
      target: "missing",
      type: "relates_to",
    });
    (variants[2]!.edges as unknown[]).push({
      source: "task-1",
      target: "task-1",
      type: "depends_on",
    });
    variants[3]!.revision = true;
    taskById(variants[4]!, "task-1").priority = true;
    taskById(variants[5]!, "task-1").effort = Number.NaN;
    (variants[6]!.gates as Record<string, unknown>[])[0]!.mandatory = 1;
    variants[7]!.nodes = {};
    for (const candidate of variants)
      expect(validateGraph(candidate, requirements)).not.toEqual([]);
  });

  test("ready status is rejected when prerequisites are not done", () => {
    const { graph, requirements } = validPlanningDocuments();
    taskById(graph, "task-2").status = "ready";
    expect(validateGraph(graph, requirements)).not.toEqual([]);
  });

  test("effort rejects huge integer without overflow", () => {
    const { graph, requirements } = validPlanningDocuments();
    for (const effort of [0, 1_000_001, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
      const candidate = structuredClone(graph);
      taskById(candidate, "task-1").effort = effort;
      expect(validateGraph(candidate, requirements)).not.toEqual([]);
    }
  });

  test("unhashable nested graph values return issues", () => {
    const { graph, requirements } = validPlanningDocuments();
    const mutations: ((candidate: Record<string, unknown>) => void)[] = [
      (candidate) => {
        (candidate.nodes as Record<string, unknown>[])[0]!.id = [];
      },
      (candidate) => {
        (candidate.nodes as Record<string, unknown>[])[0]!.type = [];
      },
      (candidate) => {
        (candidate.nodes as Record<string, unknown>[])[0]!.requirement_id = {};
      },
      (candidate) => {
        (candidate.edges as Record<string, unknown>[])[0]!.source = [];
      },
      (candidate) => {
        taskById(candidate, "task-1").requirement_ids = [["R-001"]];
      },
      (candidate) => {
        (candidate.gates as Record<string, unknown>[])[0]!.requirement_ids = [["R-001"]];
      },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(graph);
      mutate(candidate);
      expect(() => validateGraph(candidate, requirements)).not.toThrow();
      expect(validateGraph(candidate, requirements)).not.toEqual([]);
    }
  });
});
