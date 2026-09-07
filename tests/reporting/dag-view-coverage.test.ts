import { describe, expect, it } from "bun:test";
import {
  dynamicDagStateToSugiyama,
  formatCoordinates,
  formatStatusBadge,
  formatSubagentAllocation,
  getStatusBadge,
  getStatusGlyph,
  renderBranchExpansionHierarchy,
  renderDynamicDagView,
  renderRoundedNodeBox,
  renderSubagentRelationship,
  renderSugiyamaDag,
} from "../../olt/scripts/src/reporting/dag-view.ts";
import type {
  DynamicDagState,
  DynamicTaskState,
} from "../../olt/scripts/src/reporting/living-tracer/index.ts";
import type {
  SugiyamaNode,
  SugiyamaSubtask,
} from "../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

function mockDynamicTask(overrides: Partial<DynamicTaskState> = {}): DynamicTaskState {
  return {
    id: "task-default",
    label: "Task Default",
    status: "ready",
    dependencies: [],
    writeScope: [],
    origin: "static",
    createdAtSeq: 1,
    updatedAtSeq: 1,
    round: 1,
    attempt: 1,
    executionState: "pending",
    ...overrides,
  };
}

function mockDynamicDag(
  tasks: Map<string, DynamicTaskState>,
  overrides: Partial<DynamicDagState> = {},
): DynamicDagState {
  return {
    runId: "run-test",
    revision: 1,
    totalTasks: tasks.size,
    staticTasksCount: tasks.size,
    dynamicTasksCount: 0,
    repairBranchesCount: 0,
    currentRound: 1,
    tasks,
    activeAgents: new Map(),
    activeBranches: [],
    sproutedRepairPairs: [],
    ...overrides,
  };
}

describe("DAG View Presentation Subsystem", () => {
  describe("re-exported utilities", () => {
    it("exposes all core Sugiyama presentation functions", () => {
      expect(typeof formatCoordinates).toBe("function");
      expect(typeof formatStatusBadge).toBe("function");
      expect(typeof formatSubagentAllocation).toBe("function");
      expect(typeof getStatusBadge).toBe("function");
      expect(typeof getStatusGlyph).toBe("function");
      expect(typeof renderRoundedNodeBox).toBe("function");
      expect(typeof renderSugiyamaDag).toBe("function");

      expect(formatCoordinates({ wave: 1, lane: 2 })).toContain("W1:L2");
      expect(getStatusBadge("passed")).toContain("PASSED");
    });
  });

  describe("renderSubagentRelationship", () => {
    it("formats subagent relationship pair with default and explicit role", () => {
      const defaultRole = renderSubagentRelationship("impl-agent-1", "val-agent-2");
      expect(defaultRole).toContain("IMPLEMENTER: impl-agent-1");
      expect(defaultRole).toContain("VALIDATOR: val-agent-2");

      const customRole = renderSubagentRelationship("impl-agent-1", "val-agent-2", "COORDINATOR");
      expect(customRole).toContain("COORDINATOR: impl-agent-1");
      expect(customRole).toContain("VALIDATOR: val-agent-2");
    });
  });

  describe("renderBranchExpansionHierarchy", () => {
    it("renders branch expansion with custom branchId and indent", () => {
      const lines = renderBranchExpansionHierarchy("task-root", ["sub-1", "sub-2"], {
        branchId: "branch-alpha",
        indent: "  ",
      });

      expect(lines[0]).toBe("  ↳ Dynamic Branch [branch-alpha] (2 sub-tasks):");
      expect(lines[1]).toBe("    ├──► [sub-1]");
      expect(lines[2]).toBe("    └──► [sub-2]");
    });

    it("renders branch expansion with default header when branchId is omitted", () => {
      const lines = renderBranchExpansionHierarchy("task-root", ["single-task"]);
      expect(lines[0]).toBe("↳ Dynamic Sub-tasks (1):");
      expect(lines[1]).toBe("  └──► [single-task]");
    });

    it("renders SugiyamaSubtask objects with implementer, validator, and coordinates", () => {
      const subtasks: SugiyamaSubtask[] = [
        {
          id: "sub-impl",
          status: "in_progress",
          role: "implementer",
          assignedAgent: "agent-impl-1",
          validatorId: "agent-val-1",
          coordinates: { wave: 2, lane: 1 },
        },
        {
          id: "sub-val",
          status: "passed",
          role: "validator",
          assignedAgent: "agent-val-2",
        },
      ];

      const lines = renderBranchExpansionHierarchy("task-parent", subtasks);
      expect(lines[1]).toContain("[sub-impl]");
      expect(lines[1]).toContain("agent-impl-1");
      expect(lines[1]).toContain("agent-val-1");
      expect(lines[1]).toContain("W2:L1");

      expect(lines[2]).toContain("[sub-val]");
      expect(lines[2]).toContain("agent-val-2");
    });

    it("renders SugiyamaSubtask objects with implementerAgent and validatorAgent", () => {
      const dynamicTask: SugiyamaSubtask = {
        id: "task-dyn-1",
        status: "ready",
        role: "implementer",
        implementerAgent: "impl-42",
        validatorAgent: "val-42",
        coordinates: { wave: 3, lane: 2 },
      };

      const lines = renderBranchExpansionHierarchy("root", [dynamicTask]);
      expect(lines[1]).toContain("[task-dyn-1]");
      expect(lines[1]).toContain("impl-42");
      expect(lines[1]).toContain("val-42");
      expect(lines[1]).toContain("W3:L2");
    });
  });

  describe("dynamicDagStateToSugiyama", () => {
    it("transforms dynamic DAG state into nodes and edges with fallback coordinates", () => {
      const tasksMap = new Map<string, DynamicTaskState>();
      tasksMap.set(
        "t1",
        mockDynamicTask({
          id: "t1",
          label: "Task One",
          status: "passed",
          dependencies: [],
          writeScope: ["src/a.ts"],
          assignedAgent: "impl-1",
          role: "implementer",
          activeTool: "write_file",
          validatorId: "val-1",
          coordinates: { wave: 1, lane: 1 },
          round: 1,
          probeRound: 1,
          branchId: "b-main",
          origin: "static",
        }),
      );

      tasksMap.set(
        "t2",
        mockDynamicTask({
          id: "t2",
          label: "Task Two",
          status: "ready",
          dependencies: ["t1"],
          writeScope: ["src/b.ts"],
          round: 2,
          repairForTaskId: "t1",
          origin: "repair_branch",
        }),
      );

      const dynamicDag = mockDynamicDag(tasksMap);
      const { nodes, edges } = dynamicDagStateToSugiyama(dynamicDag);

      expect(nodes).toHaveLength(2);
      expect(edges).toHaveLength(1);

      expect(nodes[0]?.id).toBe("t1");
      expect(nodes[0]?.coordinates).toEqual({ wave: 1, lane: 1 });
      expect(nodes[0]?.assignedRole).toBe("implementer");

      expect(nodes[1]?.id).toBe("t2");
      expect(nodes[1]?.coordinates).toEqual({ wave: 2, lane: 1 });
      expect(nodes[1]?.parentTaskId).toBe("t1");
      expect(nodes[1]?.dynamicOrigin).toBe("repair_branch");

      expect(edges[0]).toEqual({
        from: "t1",
        to: "t2",
        type: "declared_dep",
      });
    });
  });

  describe("renderDynamicDagView", () => {
    it("renders dynamic DAG view from DynamicDagState object", () => {
      const tasksMap = new Map<string, DynamicTaskState>();
      tasksMap.set(
        "t1",
        mockDynamicTask({
          id: "t1",
          label: "Build Core",
          status: "passed",
          dependencies: [],
          writeScope: [],
          round: 1,
        }),
      );

      const dynamicDag = mockDynamicDag(tasksMap);
      const report = renderDynamicDagView(dynamicDag, { maxWidth: 100 });

      expect(report).toBeDefined();
      expect(typeof report.renderedDag).toBe("string");
      expect(typeof report.markdown).toBe("string");
      expect(report.totalTasks).toBe(1);
      expect(report.renderedDag).toContain("Build Core");
    });

    it("renders dynamic DAG view from raw Sugiyama nodes and edges arrays", () => {
      const nodes: SugiyamaNode[] = [
        {
          id: "node-1",
          label: "First Step",
          status: "passed",
          dependencies: [],
          writeScope: [],
        },
        {
          id: "node-2",
          label: "Second Step",
          status: "ready",
          dependencies: ["node-1"],
          writeScope: [],
        },
      ];

      const edges = [{ from: "node-1", to: "node-2", type: "declared_dep" as const }];

      const report = renderDynamicDagView(nodes, edges);
      expect(report.totalTasks).toBe(2);
      expect(report.nodes).toHaveLength(2);
      expect(report.renderedDag).toContain("First Step");
      expect(report.renderedDag).toContain("Second Step");
    });

    it("handles renderDynamicDagView with default parameters", () => {
      const nodes: SugiyamaNode[] = [
        {
          id: "standalone",
          label: "Standalone Task",
          status: "running",
          dependencies: [],
          writeScope: [],
        },
      ];

      const report = renderDynamicDagView(nodes);
      expect(report.totalTasks).toBe(1);
      expect(report.renderedDag).toContain("Standalone Task");
    });
  });
});
