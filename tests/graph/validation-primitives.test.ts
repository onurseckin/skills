import { describe, expect, test } from "bun:test";
import { validateEdges } from "../../../olt/scripts/src/graph/validate-edges.ts";
import { validateGates } from "../../../olt/scripts/src/graph/validate-gates.ts";
import { validateGraph } from "../../../olt/scripts/src/graph/validate-graph.ts";
import { taskById, validPlanningDocuments } from "./fixtures.ts";

// Direct unit tests for the small validator primitives validateGraph composes. The higher-level
// contracts.test.ts / ownership-gates.test.ts already exercise these through a full graph, but a
// few of their own defensive branches only fire on shapes that never survive graphDocument's
// fixture builder — calling them directly is the more precise (and much faster) way to reach those
// branches without hand-rolling an entire graph just to smuggle one bad edge or gate through.
describe("validateEdges", () => {
  test("an edge with an unrecognized type between two known nodes is rejected", () => {
    const nodeIds = new Set(["task-1", "artifact-1"]);
    const nodeById = new Map<string, Record<string, unknown>>([
      ["task-1", { id: "task-1", type: "task" }],
      ["artifact-1", { id: "artifact-1", type: "artifact" }],
    ]);
    const issues: string[] = [];
    validateEdges(
      [{ source: "task-1", target: "artifact-1", type: "not_a_real_edge_type" }],
      nodeIds,
      nodeById,
      new Set(["artifact-1"]),
      issues,
    );
    expect(issues).toContain("edges[0].type is invalid");
  });

  test("a valid produces edge is recorded without any issues", () => {
    const nodeIds = new Set(["task-1", "artifact-1"]);
    const nodeById = new Map<string, Record<string, unknown>>([
      ["task-1", { id: "task-1", type: "task" }],
      ["artifact-1", { id: "artifact-1", type: "artifact" }],
    ]);
    const issues: string[] = [];
    const produced = validateEdges(
      [{ source: "task-1", target: "artifact-1", type: "produces" }],
      nodeIds,
      nodeById,
      new Set(["artifact-1"]),
      issues,
    );
    expect(issues).toEqual([]);
    expect(produced.get("task-1")).toEqual(new Set(["artifact-1"]));
  });
});

describe("validateGates", () => {
  test("a gate whose requirement_ids is not a list is rejected without a crash", () => {
    const issues: string[] = [];
    const result = validateGates(
      [
        {
          id: "gate-1",
          command: ["true"],
          cwd: ".",
          scope: "task",
          mandatory: true,
          requirement_ids: "R-001",
        },
      ],
      new Set(["R-001"]),
      issues,
    );
    expect(issues).toContain("gates[0].requirement_ids must be a list");
    expect(result.taskCoverage).toEqual(new Set());
  });

  test("a well-formed mandatory task gate contributes to task coverage", () => {
    const issues: string[] = [];
    const result = validateGates(
      [
        {
          id: "gate-1",
          command: ["git", "diff", "--check"],
          cwd: ".",
          scope: "task",
          mandatory: true,
          requirement_ids: ["R-001"],
        },
      ],
      new Set(["R-001"]),
      issues,
    );
    expect(issues).toEqual([]);
    expect(result.taskCoverage).toEqual(new Set(["R-001"]));
    expect(result.hasMandatoryRun).toBe(false);
  });
});

describe("validateGraph", () => {
  test("a non-object requirements document is rejected up front", () => {
    const { graph } = validPlanningDocuments();
    for (const requirements of [null, "not an object", ["also", "not", "an", "object"], 42]) {
      expect(validateGraph(graph, requirements)).toContain(
        "requirements document must be an object",
      );
    }
  });

  test("a bare `env` gate command strips down to nothing and is rejected as weak", () => {
    const { graph, requirements } = validPlanningDocuments();
    taskById(graph, "task-1");
    (graph.gates as Record<string, unknown>[])[0]!.command = ["env"];
    expect(validateGraph(graph, requirements)).toContain(
      "gates[0].command must perform substantive verification",
    );
  });
});
