import { describe, expect, test } from "bun:test";
import type { BranchRecord } from "../../../../../olt/scripts/src/core/contracts/index.ts";
import { generateGraphDataset } from "../../../../../olt/scripts/src/summary/graph/index.ts";
import { makeGrant, makeState, makeTask } from "../../dag/graph-fixtures.ts";

function branchWithSubTasks(): BranchRecord {
  return {
    id: "B-role",
    parent_task_id: "T-parent",
    parent_agent_id: "worker-1",
    reason: "split verification from implementation",
    depth: 1,
    status: "open",
    opened_at: "2026-08-14T20:05:00.000Z",
    sub_tasks: [
      {
        id: "B-role-impl",
        label: "Implement the fix",
        write_scope: ["src/foo.ts"],
        status: "claimed",
        agent_id: "sub-impl",
      },
      {
        id: "B-role-verify",
        label: "Verify the fix",
        write_scope: ["src/foo.ts"],
        status: "claimed",
        agent_id: "sub-verify",
      },
    ],
  };
}

describe("a branched sub-task's ledger-granted role reaches its node", () => {
  test("sub-implementer and sub-validator sub-tasks are distinguished, not left roleless", () => {
    const dataset = generateGraphDataset({
      runId: "run-sub-roles",
      state: makeState([makeTask("T-parent", { status: "branched" })], {
        branches: [branchWithSubTasks()],
        agents: [
          makeGrant("sub-impl", { role: "sub-implementer" }),
          makeGrant("sub-verify", { role: "sub-validator" }),
        ],
      }),
    });

    const impl = dataset.nodes.find((node) => node.id === "node-branch-B-role-B-role-impl");
    const verify = dataset.nodes.find((node) => node.id === "node-branch-B-role-B-role-verify");

    expect(impl?.metadata?.role).toBe("sub-implementer");
    expect(verify?.metadata?.role).toBe("sub-validator");
    expect(impl?.metadata?.role).not.toBe(verify?.metadata?.role);
  });

  test("a sub-task with no ledger grant gets no fabricated role", () => {
    const dataset = generateGraphDataset({
      runId: "run-sub-no-grant",
      state: makeState([makeTask("T-parent", { status: "branched" })], {
        branches: [branchWithSubTasks()],
      }),
    });
    const impl = dataset.nodes.find((node) => node.id === "node-branch-B-role-B-role-impl");

    expect(impl?.metadata?.role).toBeUndefined();
    expect("role" in (impl?.metadata ?? {})).toBe(false);
  });

  test("confines sub-task roles to grants and prevents role leakage to ungranted sub-tasks", () => {
    const branchWith3SubTasks: BranchRecord = {
      id: "B-triple",
      parent_task_id: "T-parent",
      parent_agent_id: "worker-1",
      reason: "decomposition",
      depth: 1,
      status: "open",
      opened_at: "2026-08-14T20:05:00.000Z",
      sub_tasks: [
        {
          id: "B-triple-sub-1",
          label: "Subtask 1",
          write_scope: ["src/1.ts"],
          status: "claimed",
          agent_id: "agent-sub-1",
        },
        {
          id: "B-triple-sub-2",
          label: "Subtask 2",
          write_scope: ["src/2.ts"],
          status: "claimed",
          agent_id: "agent-sub-2",
        },
        {
          id: "B-triple-sub-3",
          label: "Subtask 3",
          write_scope: ["src/3.ts"],
          status: "claimed",
          agent_id: "agent-sub-3",
        },
      ],
    };

    const dataset = generateGraphDataset({
      runId: "run-sub-confinement",
      state: makeState([makeTask("T-parent", { status: "branched" })], {
        branches: [branchWith3SubTasks],
        agents: [
          makeGrant("agent-sub-1", { role: "sub-implementer" }),
          makeGrant("agent-sub-2", { role: "sub-validator" }),
        ],
      }),
    });

    const node1 = dataset.nodes.find((n) => n.id === "node-branch-B-triple-B-triple-sub-1");
    const node2 = dataset.nodes.find((n) => n.id === "node-branch-B-triple-B-triple-sub-2");
    const node3 = dataset.nodes.find((n) => n.id === "node-branch-B-triple-B-triple-sub-3");

    expect(node1?.metadata?.role).toBe("sub-implementer");
    expect(node2?.metadata?.role).toBe("sub-validator");
    expect(node3?.metadata?.role).toBeUndefined();
    expect(node3?.telemetry).toBeUndefined();
    expect("role" in (node3?.metadata ?? {})).toBe(false);
  });
});
