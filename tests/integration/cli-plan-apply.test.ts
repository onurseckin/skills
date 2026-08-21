import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  planApplyCommand,
  planClaimCommand,
} from "../../orchestrating-long-tasks/scripts/src/cli/commands/plan-apply.ts";
import { initRun, loadRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { validPlanningDocuments } from "../unit/graph/fixtures.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "plan-apply-cli-"));
  roots.push(repoRoot);
  const { prompt, requirements, graph } = validPlanningDocuments();
  const run = initRun(repoRoot, "run-1", new TextEncoder().encode(prompt), "file", true);
  writeFileSync(join(run, "planning", "requirements.json"), JSON.stringify(requirements));
  writeFileSync(join(run, "planning", "graph.json"), JSON.stringify(graph));
  return run;
}

describe("plan:claim issues the planner its own packet", () => {
  test("hands back a published packet naming the planner's write scope", async () => {
    const result = await planClaimCommand({ run: run(), agent: "planner-1" });
    expect(result.markdown).toContain("Planner Packet Issued");
    expect(typeof result.packet_id).toBe("string");
    expect(typeof result.role_contract_sha256).toBe("string");
  });
});

describe("plan:apply commits the plan the planner wrote to planning/", () => {
  test("reads the default planning/ paths and advances the graph revision", async () => {
    const runRoot = run();
    const result = await planApplyCommand({
      run: runRoot,
      actor: "planner-1",
      "expected-revision": "0",
    });

    expect(result.revision).toBe(1);
    expect(result.markdown as string).toContain("Graph Revision 1");
    const state = loadRun(runRoot).state;
    expect((state.graph as { revision: number }).revision).toBe(1);
    expect(Object.keys(state.tasks as Record<string, unknown>).length).toBeGreaterThan(0);
  });

  test("refuses a stale --expected-revision instead of silently overwriting", async () => {
    const runRoot = run();
    await planApplyCommand({ run: runRoot, actor: "planner-1", "expected-revision": "0" });

    await expect(
      planApplyCommand({ run: runRoot, actor: "planner-1", "expected-revision": "0" }),
    ).rejects.toThrow("graph revision is 1, expected 0");
  });

  test("accepts explicit --requirements/--graph paths in place of the planning/ defaults", async () => {
    const runRoot = run();
    const { requirements, graph } = validPlanningDocuments();
    const altRequirements = join(runRoot, "..", "alt-requirements.json");
    const altGraph = join(runRoot, "..", "alt-graph.json");
    writeFileSync(altRequirements, JSON.stringify(requirements));
    writeFileSync(altGraph, JSON.stringify(graph));

    const result = await planApplyCommand({
      run: runRoot,
      actor: "planner-1",
      requirements: altRequirements,
      graph: altGraph,
    });
    expect(result.revision).toBe(1);
  });
});
