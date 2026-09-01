import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { applyPlan } from "../../../olt/scripts/src/graph/apply-plan.ts";
import {
  clearPlanFs,
  installPlanFsSpies,
  MemoryPlanningStore,
  validPlanningDocuments,
  vPlanDirs,
  vPlanFs,
} from "../validation/fixtures.ts";

let fileCounter = 0;

function makePlanFiles(requirements: unknown, graph: unknown) {
  fileCounter += 1;
  const dir = `/virtual/plan-dir-apply-${fileCounter}`;
  vPlanDirs.add(dir);
  const reqPath = join(dir, "reqs.json");
  const graphPath = join(dir, "graph.json");
  vPlanFs.set(reqPath, Buffer.from(JSON.stringify(requirements), "utf-8"));
  vPlanFs.set(graphPath, Buffer.from(JSON.stringify(graph), "utf-8"));
  return { dir, reqPath, graphPath };
}

describe("graph apply plan", () => {
  beforeEach(() => installPlanFsSpies());
  afterEach(() => clearPlanFs());
  test("validates expectedRevision bounds and revision mismatches", async () => {
    const { prompt, requirements, graph } = validPlanningDocuments();
    const store = new MemoryPlanningStore(prompt);
    const { reqPath, graphPath } = await makePlanFiles(requirements, graph);

    // Negative expected revision throws INVALID_ARGUMENT
    await expect(applyPlan(store, "planner", reqPath, graphPath, -1)).rejects.toThrow(
      "expectedRevision must be a non-negative integer or null",
    );

    // Non-integer expected revision throws INVALID_ARGUMENT
    await expect(applyPlan(store, "planner", reqPath, graphPath, 1.5)).rejects.toThrow(
      "expectedRevision must be a non-negative integer or null",
    );

    // Revision mismatch (current revision is 0, expecting 5)
    await expect(applyPlan(store, "planner", reqPath, graphPath, 5)).rejects.toThrow(
      "graph revision is 0, expected 5",
    );
  });

  test("rejects invalid plans and applies valid plans successfully", async () => {
    const { prompt, requirements, graph } = validPlanningDocuments();
    const store = new MemoryPlanningStore(prompt);

    // Invalid graph plan (invalid node type)
    const invalidGraph = structuredClone(graph);
    (invalidGraph.nodes as Record<string, unknown>[])[0].type = "unknown_type";
    const { reqPath: badReq, graphPath: badGraph } = await makePlanFiles(
      requirements,
      invalidGraph,
    );
    await expect(applyPlan(store, "planner", badReq, badGraph, 0)).rejects.toThrow(
      "plan is invalid",
    );

    // Valid plan applies and advances revision
    const { reqPath: goodReq, graphPath: goodGraph } = await makePlanFiles(requirements, graph);
    const result = await applyPlan(store, "planner", goodReq, goodGraph, 0);
    expect(result).toBeObject();
    expect((result.graph as { revision: number }).revision).toBe(1);
  });
});
