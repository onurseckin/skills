import { describe, expect, test } from "bun:test";
import type { BranchRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/branch.ts";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import { makeCommand, makeState, makeTask } from "./graph-fixtures.ts";

const REASON = "The migration turned out to need a schema rewrite and a data backfill";

function branch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    id: "B-1",
    parent_task_id: "T-parent",
    parent_agent_id: "worker-1",
    reason: REASON,
    depth: 1,
    status: "collected",
    opened_at: "2026-08-14T20:05:00.000Z",
    collected_at: "2026-08-14T20:30:00.000Z",
    outcome_summary: "Both halves landed",
    sub_tasks: [
      {
        id: "B-1-schema",
        label: "Rewrite the schema",
        write_scope: ["src/db/schema.ts"],
        status: "submitted",
        agent_id: "sub-1",
        submitted_at: "2026-08-14T20:20:00.000Z",
        summary: "Schema rewritten",
        gate: "bun test src/db",
      },
      {
        id: "B-1-backfill",
        label: "Backfill the rows",
        write_scope: ["src/db/backfill.ts"],
        status: "abandoned",
        agent_id: "sub-2",
        abandoned_at: "2026-08-14T20:25:00.000Z",
      },
    ],
    ...overrides,
  };
}

function datasetWithBranch(record: BranchRecord = branch()) {
  const parent = makeTask("T-parent", { status: "done", label: "Parent Task" });
  const command = makeCommand("C-sub", {
    task_id: "B-1-schema",
    actor: "sub-1",
    argv: ["bun", "test", "src/db"],
  });
  return generateGraphDataset({
    runId: "run-branch",
    state: makeState([parent], { branches: [record] }),
    commands: { "C-sub": command },
  });
}

describe("branch subgraphs", () => {
  test("emits one node per sub-agent carrying its assignment and the branch reason", () => {
    const dataset = datasetWithBranch();
    const schema = dataset.nodes.find((node) => node.id === "node-branch-B-1-B-1-schema");

    expect(schema?.kind).toBe("agent");
    expect(schema?.name).toBe("Rewrite the schema");
    expect(schema?.status).toBe("success");
    expect(schema?.description).toContain(REASON);
    expect(schema?.metadata?.branchReason).toBe(REASON);
    expect(schema?.metadata?.subTaskId).toBe("B-1-schema");
    expect(schema?.metadata?.parentTaskId).toBe("T-parent");
    expect(schema?.metadata?.writeScope).toEqual(["src/db/schema.ts"]);
    expect(schema?.metadata?.gate).toBe("bun test src/db");
    expect(schema?.metadata?.agentId).toBe("sub-1");
    expect(schema?.scripts?.map((script) => script.commandId)).toEqual(["C-sub"]);

    const backfill = dataset.nodes.find((node) => node.id === "node-branch-B-1-B-1-backfill");
    expect(backfill?.status).toBe("error");
  });

  test("groups the region in a section that carries the reason and the parent", () => {
    const dataset = datasetWithBranch();
    expect(dataset.sections).toHaveLength(1);
    const section = dataset.sections?.[0];

    expect(section?.id).toBe("section-branch-B-1");
    expect(section?.reason).toBe(REASON);
    expect(section?.description).toBe(REASON);
    expect(section?.parentNodeId).toBe("node-task-T-parent");
    expect(section?.status).toBe("collected");
    expect(section?.nodeIds).toEqual([
      "node-branch-B-1-B-1-schema",
      "node-branch-B-1-B-1-backfill",
    ]);
    for (const nodeId of section?.nodeIds ?? []) {
      expect(dataset.nodes.find((node) => node.id === nodeId)?.sectionId).toBe(
        "section-branch-B-1",
      );
    }
  });

  test("emits branch edges out and collect edges back", () => {
    const dataset = datasetWithBranch();
    const out = dataset.edges.find((edge) => edge.id === "edge-branch-B-1-B-1-schema");
    expect(out?.kind).toBe("branch");
    expect(out?.source).toBe("node-task-T-parent");
    expect(out?.container?.detail).toBe(REASON);
    expect(out?.exchanges?.[0]?.type).toBe("branch");

    const back = dataset.edges.find((edge) => edge.id === "edge-collect-B-1-B-1-schema");
    expect(back?.kind).toBe("collect");
    expect(back?.source).toBe("node-branch-B-1-B-1-schema");
    expect(back?.target).toBe("node-task-T-parent");
    expect(back?.isCycle).toBe(true);
    expect(back?.exchanges?.[0]?.verdict).toBe("PASS");

    const abandoned = dataset.edges.find((edge) => edge.id === "edge-collect-B-1-B-1-backfill");
    expect(abandoned?.container?.title).toBe("Sub-agent Abandoned");
    expect(abandoned?.exchanges?.[0]?.verdict).toBe("FAIL");
  });

  test("hangs a nested branch off the sub-node that opened it", () => {
    const nested: BranchRecord = {
      ...branch({ status: "open" }),
      id: "B-2",
      parent_task_id: "B-1-schema",
      parent_agent_id: "sub-1",
      reason: "The schema rewrite needed its own migration split",
      depth: 2,
      sub_tasks: [
        {
          id: "B-2-index",
          label: "Rebuild the indexes",
          write_scope: ["src/db/index.ts"],
          status: "claimed",
        },
      ],
    };
    const parent = makeTask("T-parent", { status: "branched" });
    const dataset = generateGraphDataset({
      runId: "run-nested",
      state: makeState([parent], { branches: [branch(), nested] }),
    });

    const edge = dataset.edges.find((entry) => entry.id === "edge-branch-B-2-B-2-index");
    expect(edge?.source).toBe("node-branch-B-1-B-1-schema");
    expect(dataset.sections?.map((section) => section.id)).toEqual([
      "section-branch-B-1",
      "section-branch-B-2",
    ]);
    expect(
      dataset.nodes.find((node) => node.id === "node-branch-B-2-B-2-index")?.metadata?.depth,
    ).toBe(2);
    expect(dataset.nodes.find((node) => node.id === "node-task-T-parent")?.badge?.text).toBe(
      "Branched",
    );
  });

  test("counts branches on the plan node", () => {
    const dataset = datasetWithBranch();
    const plan = dataset.nodes.find((node) => node.id === "node-orchestrator-plan");
    expect(plan?.metadata?.branchCount).toBe(1);
    expect(plan?.badges).toContainEqual({ label: "1 branches", variant: "amber" });
  });
});
