import { describe, expect, it } from "bun:test";
import {
  checkPlanningDag,
  extractDependencyId,
  extractDependencyList,
} from "../../../../olt/scripts/src/reporting/doctor/planning-dag-engine.ts";

describe("planning-dag-engine", () => {
  describe("extractDependencyId", () => {
    it("extracts from string and trims whitespace", () => {
      expect(extractDependencyId("  task-1  ")).toBe("task-1");
      expect(extractDependencyId("")).toBeUndefined();
      expect(extractDependencyId("   ")).toBeUndefined();
    });

    it("extracts from object with id string and ignores invalid types", () => {
      expect(extractDependencyId({ id: " task-2 " })).toBe("task-2");
      expect(extractDependencyId({ id: "" })).toBeUndefined();
      expect(extractDependencyId({ id: 123 })).toBeUndefined();
      expect(extractDependencyId({})).toBeUndefined();
      expect(extractDependencyId(null)).toBeUndefined();
      expect(extractDependencyId(123)).toBeUndefined();
    });
  });

  describe("extractDependencyList", () => {
    it("returns empty array for non-arrays or empty arrays", () => {
      expect(extractDependencyList(null)).toEqual([]);
      expect(extractDependencyList(undefined)).toEqual([]);
      expect(extractDependencyList({})).toEqual([]);
      expect(extractDependencyList([])).toEqual([]);
    });

    it("filters and extracts valid dependency identifiers from mixed items", () => {
      const input = [" t1 ", { id: " t2 " }, "  ", { id: "" }, { id: 456 }, null, "t3"];
      expect(extractDependencyList(input)).toEqual(["t1", "t2", "t3"]);
    });
  });

  describe("checkPlanningDag", () => {
    it("passes for empty options or empty tasks/graph", () => {
      const res1 = checkPlanningDag();
      expect(res1.passed).toBe(true);
      expect(res1.findings).toHaveLength(0);

      const res2 = checkPlanningDag({ tasks: null, graph: null });
      expect(res2.passed).toBe(true);
      expect(res2.findings).toHaveLength(0);
    });

    it("processes tasks record with string ids, deps, and statuses", () => {
      const tasks = {
        taskA: { id: "taskA", dependencies: [], status: "completed" },
        taskB: { deps: ["taskA"], status: "running" },
        taskC: null,
      };
      const res = checkPlanningDag({ tasks });
      expect(res.passed).toBe(true);
      expect(res.findings).toHaveLength(0);
    });

    it("merges graph nodes and graph edges into task map", () => {
      const graph = {
        nodes: [
          { id: "node1", dependencies: ["node2"], status: "pending" },
          { id: "node2", deps: [] },
          null,
          { id: 123 },
        ],
        edges: [
          { from: "node2", to: "node1" },
          { from: "node1", to: "node2" },
          null,
          { from: "nodeX", to: "nodeY" },
        ],
      };
      const res = checkPlanningDag({ graph });
      expect(res.passed).toBe(false);
      const cycle = res.findings.find((f) => f.code === "PLANNING_DAG_CYCLE_DETECTED");
      expect(cycle).toBeDefined();
    });

    it("updates existing nodes when present in both tasks and graph", () => {
      const tasks = {
        n1: { id: "n1", deps: ["n2"], status: "ready" },
        n2: { id: "n2" },
      };
      const graph = {
        nodes: [
          { id: "n1", status: "active" },
          { id: "n2", dependencies: ["n1"] },
        ],
      };
      const res = checkPlanningDag({ tasks, graph });
      expect(res.passed).toBe(false);
      expect(res.findings.some((f) => f.code === "PLANNING_DAG_CYCLE_DETECTED")).toBe(true);
    });

    it("flags missing dependencies as errors", () => {
      const tasks = {
        task1: { id: "task1", deps: ["non_existent_1", "non_existent_2"] },
      };
      const res = checkPlanningDag({ tasks });
      expect(res.passed).toBe(false);
      const missing = res.findings.filter((f) => f.code === "PLANNING_DAG_MISSING_DEPENDENCY");
      expect(missing).toHaveLength(2);
      expect(missing[0]?.details?.["missingDependencyId"]).toBe("non_existent_1");
    });

    it("detects multi-node cycles and self-cycles", () => {
      const tasksWithSelfLoop = {
        selfLoop: { id: "selfLoop", deps: ["selfLoop"] },
      };
      const res1 = checkPlanningDag({ tasks: tasksWithSelfLoop });
      expect(res1.passed).toBe(false);
      expect(res1.findings.some((f) => f.code === "PLANNING_DAG_CYCLE_DETECTED")).toBe(true);

      const tasksWith3Cycle = {
        a: { id: "a", deps: ["b"] },
        b: { id: "b", deps: ["c"] },
        c: { id: "c", deps: ["a"] },
      };
      const res2 = checkPlanningDag({ tasks: tasksWith3Cycle });
      expect(res2.passed).toBe(false);
      const cycleFinding = res2.findings.find((f) => f.code === "PLANNING_DAG_CYCLE_DETECTED");
      expect(cycleFinding?.message).toContain("Cycle detected in planning DAG");
    });

    it("flags orphan tasks when multiple nodes exist without connections", () => {
      const tasks = {
        connectedA: { id: "connectedA", deps: ["connectedB"] },
        connectedB: { id: "connectedB", deps: [] },
        orphanX: { id: "orphanX", deps: [] },
      };
      const res = checkPlanningDag({ tasks });
      expect(res.passed).toBe(true);
      const orphan = res.findings.find((f) => f.code === "PLANNING_DAG_ORPHAN_TASK");
      expect(orphan).toBeDefined();
      expect(orphan?.severity).toBe("WARN");
      expect(orphan?.details?.["taskId"]).toBe("orphanX");
    });

    it("does not flag orphan when there is only one node total", () => {
      const tasks = {
        singleNode: { id: "singleNode", deps: [] },
      };
      const res = checkPlanningDag({ tasks });
      expect(res.passed).toBe(true);
      expect(res.findings.some((f) => f.code === "PLANNING_DAG_ORPHAN_TASK")).toBe(false);
    });
  });
});
