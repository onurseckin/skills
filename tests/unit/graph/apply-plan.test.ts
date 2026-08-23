import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyPlan } from "../../../olt/scripts/src/graph/apply-plan.ts";
import { MemoryPlanningStore } from "./memory-store.ts";
import { validPlanningDocuments } from "./fixtures.ts";

async function makePlanFiles(requirements: unknown, graph: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "harness-apply-test-"));
  const reqPath = join(dir, "reqs.json");
  const graphPath = join(dir, "graph.json");
  await writeFile(reqPath, JSON.stringify(requirements));
  await writeFile(graphPath, JSON.stringify(graph));
  return { dir, reqPath, graphPath };
}

describe("graph apply plan", () => {
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
