import { describe, expect, test } from "bun:test";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  ancestorChain,
  childrenOf,
  taskLineage,
} from "../../../olt/scripts/src/workflow/agents/lineage.ts";

function grant(
  id: string,
  parent_agent_id: string | null = null,
  parent_task_id: string | null = null,
  role: AgentGrantRecord["role"] = "implementer",
): AgentGrantRecord {
  return {
    id,
    role,
    parent_agent_id,
    parent_task_id,
    host: "local",
    granted_at: "2026-08-20T00:00:00.000Z",
    status: "active",
  };
}

describe("workflow/agents/lineage", () => {
  test("ancestorChain returns empty array when agent has no parent", () => {
    const ledger = [grant("agent-1")];
    expect(ancestorChain(ledger, "agent-1")).toEqual([]);
    expect(ancestorChain(ledger, "agent-unknown")).toEqual([]);
  });

  test("ancestorChain returns full ancestor chain from direct parent to root", () => {
    const ledger = [grant("root"), grant("parent", "root"), grant("child", "parent")];
    expect(ancestorChain(ledger, "child")).toEqual(["parent", "root"]);
    expect(ancestorChain(ledger, "parent")).toEqual(["root"]);
    expect(ancestorChain(ledger, "root")).toEqual([]);
  });

  test("ancestorChain breaks gracefully on cyclic references", () => {
    const ledger = [grant("agent-a", "agent-b"), grant("agent-b", "agent-a")];
    expect(ancestorChain(ledger, "agent-a")).toEqual(["agent-b"]);
  });

  test("childrenOf returns direct child grants", () => {
    const ledger = [
      grant("root"),
      grant("child-1", "root"),
      grant("child-2", "root"),
      grant("grandchild", "child-1"),
    ];
    const rootChildren = childrenOf(ledger, "root");
    expect(rootChildren.map((g) => g.id)).toEqual(["child-1", "child-2"]);
    expect(childrenOf(ledger, "grandchild")).toEqual([]);
  });

  test("taskLineage constructs breadth-first agent tree for a specific task", () => {
    const ledger = [
      grant("coordinator", null, null, "coordinator"),
      grant("task-worker", "coordinator", "task-1", "implementer"),
      grant("sub-helper-1", "task-worker", "task-1", "worker"),
      grant("sub-helper-2", "task-worker", "task-1", "worker"),
      grant("sub-sub-helper", "sub-helper-1", "task-1", "worker"),
      grant("other-task-worker", "coordinator", "task-2", "implementer"),
    ];

    const result = taskLineage(ledger, "task-1");
    expect(result.task_id).toBe("task-1");
    expect(result.agents).toHaveLength(4);

    const ids = result.agents.map((a) => a.agent_id);
    expect(ids).toEqual(["task-worker", "sub-helper-1", "sub-helper-2", "sub-sub-helper"]);

    const depths = result.agents.map((a) => a.depth);
    expect(depths).toEqual([0, 1, 1, 2]);

    expect(result.agents[0]).toEqual({
      agent_id: "task-worker",
      role: "implementer",
      parent_agent_id: "coordinator",
      parent_task_id: "task-1",
      status: "active",
      depth: 0,
      ancestors: ["coordinator"],
    });

    expect(result.agents[1]!.ancestors).toEqual(["task-worker", "coordinator"]);
    expect(result.agents[3]!.ancestors).toEqual(["sub-helper-1", "task-worker", "coordinator"]);
  });

  test("taskLineage handles empty ledger and tasks with no matching agents", () => {
    expect(taskLineage([], "task-1")).toEqual({ task_id: "task-1", agents: [] });
    expect(taskLineage([grant("a1", null, "task-2")], "task-1")).toEqual({
      task_id: "task-1",
      agents: [],
    });
  });

  test("taskLineage handles diamond/cyclic references without infinite loop", () => {
    const ledger = [
      grant("worker-1", null, "task-1"),
      grant("worker-2", "worker-1", "task-1"),
      // worker-3 has worker-1 as parent, and also an entry where worker-1 could be reached again
      grant("worker-3", "worker-1", "task-1"),
    ];
    const result = taskLineage(ledger, "task-1");
    expect(result.agents).toHaveLength(3);
  });
});
