import { describe, expect, it } from "bun:test";
import {
  NOOP_COMMANDS,
  probeScopeCollisionHazards,
  probeWorkSpanParallelizationHealth,
} from "../../../olt/scripts/src/engine/scheduler/core/tasks/tasks-advanced.ts";

describe("engine/scheduler/core/tasks/tasks-advanced.ts", () => {
  describe("NOOP_COMMANDS", () => {
    it("contains expected trivial/noop commands", () => {
      expect(NOOP_COMMANDS.has(":")).toBe(true);
      expect(NOOP_COMMANDS.has("echo")).toBe(true);
      expect(NOOP_COMMANDS.has("exit")).toBe(true);
      expect(NOOP_COMMANDS.has("false")).toBe(true);
      expect(NOOP_COMMANDS.has("printf")).toBe(true);
      expect(NOOP_COMMANDS.has("true")).toBe(true);
      expect(NOOP_COMMANDS.has("bun")).toBe(false);
    });
  });

  describe("probeScopeCollisionHazards", () => {
    it("returns default passed result when state is not a record or has no tasks", () => {
      const resultNull = probeScopeCollisionHazards(null);
      expect(resultNull.passed).toBe(true);
      expect(resultNull.totalHazardCount).toBe(0);

      const resultEmpty = probeScopeCollisionHazards({});
      expect(resultEmpty.passed).toBe(true);
      expect(resultEmpty.totalHazardCount).toBe(0);
    });

    it("detects active collisions on write_scope, resource_scope, and both", () => {
      const state = {
        tasks: {
          t1: {
            id: "t1",
            status: "running",
            write_scope: ["src/ui/**"],
            resource_scope: ["port:8080"],
          },
          t2: {
            id: "t2",
            status: "leased",
            write_scope: ["src/ui/Button.tsx"], // write collision
            resource_scope: ["port:8080"], // resource collision -> both
          },
          t3: {
            id: "t3",
            status: "validating",
            write_scope: ["src/api/index.ts"],
            resource_scope: ["db:postgres"],
          },
          t4: {
            id: "t4",
            status: "running",
            write_scope: ["src/api/index.ts"], // write only collision with t3
            resource_scope: ["db:sqlite"],
          },
          t5: {
            id: "t5",
            status: "running",
            write_scope: ["src/other.ts"],
            resource_scope: ["db:postgres"], // resource only collision with t3
          },
          tNull: null,
        },
      };

      const result = probeScopeCollisionHazards(state);
      expect(result.passed).toBe(false);
      expect(result.activeCollisions.length).toBeGreaterThanOrEqual(3);

      const collisionTypes = result.activeCollisions.map((c) => c.conflictType);
      expect(collisionTypes).toContain("both");
      expect(collisionTypes).toContain("write_scope");
      expect(collisionTypes).toContain("resource_scope");
      expect(result.details.length).toBe(result.activeCollisions.length);
    });

    it("detects candidate collisions for proposed and ready tasks without failing probe", () => {
      const state = {
        tasks: {
          t1: {
            id: "t1",
            status: "proposed",
            write_scope: ["src/shared.ts"],
          },
          t2: {
            id: "t2",
            status: "ready",
            write_scope: ["src/shared.ts"],
          },
        },
      };

      const result = probeScopeCollisionHazards(state);
      expect(result.passed).toBe(true); // candidate collisions do not fail active check
      expect(result.activeCollisions.length).toBe(0);
      expect(result.candidateCollisions.length).toBe(1);
      expect(result.totalHazardCount).toBe(1);
      expect(result.candidateCollisions[0]?.leftTaskId).toBe("t1");
      expect(result.candidateCollisions[0]?.rightTaskId).toBe("t2");
    });
  });

  describe("probeWorkSpanParallelizationHealth", () => {
    it("returns default audit report when state has no tasks", () => {
      const resultNull = probeWorkSpanParallelizationHealth(null);
      expect(resultNull.passed).toBe(true);
      expect(resultNull.totalTasks).toBe(0);
      expect(resultNull.details).toEqual(["State has no tasks to evaluate."]);
    });

    it("evaluates healthy work/span parallelization across DAG tasks", () => {
      const state = {
        graph: {
          schema: "harness.graph",
          version: 1,
          revision: 1,
          nodes: [{ id: "t1" }, { id: "t2" }],
          edges: [{ source: "t1", target: "t2" }],
          gates: [],
        },
        tasks: {
          t1: {
            id: "t1",
            status: "done",
            priority: 1,
            created_order: 1,
            effort: 1,
            requirement_ids: ["req-1"],
            write_scope: ["src/a.ts"],
            resource_scope: [],
          },
          t2: {
            id: "t2",
            status: "ready",
            priority: 1,
            created_order: 2,
            effort: 1,
            requirement_ids: ["req-1"],
            write_scope: ["src/b.ts"],
            resource_scope: [],
          },
        },
      };

      const result = probeWorkSpanParallelizationHealth(state);
      expect(result.passed).toBe(true);
      expect(result.totalTasks).toBe(2);
      expect(result.completedTasks).toBe(1);
      expect(result.readyTasks).toBe(1);
      expect(result.activeBottlenecks).toEqual([]);
      expect(result.details[0]).toContain("Work/Span parallelization is healthy");
    });

    it("detects active write scope bottlenecks and critical path restrictions", () => {
      const state = {
        graph: {
          schema: "harness.graph",
          version: 1,
          revision: 1,
          nodes: [{ id: "t1" }, { id: "t2" }, { id: "t3" }, { id: "t4" }],
          edges: [
            { source: "t1", target: "t2" },
            { source: "t2", target: "t3" },
            { source: "t3", target: "t4" },
          ],
          gates: [],
        },
        tasks: {
          t1: {
            id: "t1",
            status: "running",
            priority: 1,
            created_order: 1,
            effort: 5,
            requirement_ids: [],
            write_scope: ["src/same.ts"],
          },
          t2: {
            id: "t2",
            status: "running",
            priority: 1,
            created_order: 2,
            effort: 5,
            requirement_ids: [],
            write_scope: ["src/same.ts"], // active collision with t1
          },
          t3: {
            id: "t3",
            status: "proposed",
            priority: 1,
            created_order: 3,
            effort: 5,
            requirement_ids: [],
            write_scope: ["src/c.ts"],
          },
          t4: {
            id: "t4",
            status: "proposed",
            priority: 1,
            created_order: 4,
            effort: 5,
            requirement_ids: [],
            write_scope: ["src/d.ts"],
          },
        },
      };

      const result = probeWorkSpanParallelizationHealth(state);
      expect(result.passed).toBe(false);
      expect(result.totalTasks).toBe(4);
      expect(result.activeTasks).toBe(2);
      expect(result.activeBottlenecks.length).toBeGreaterThan(0);
      expect(result.activeBottlenecks.some((b) => b.includes("Write scope bottleneck"))).toBe(true);
      expect(result.activeBottlenecks.some((b) => b.includes("Critical path length"))).toBe(true);
    });

    it("gracefully handles invalid graph object fallback", () => {
      const state = {
        graph: "invalid-graph-not-an-object",
        tasks: {
          t1: {
            id: "t1",
            status: "validating",
            write_scope: ["src/a.ts"],
          },
        },
      };

      const result = probeWorkSpanParallelizationHealth(state);
      expect(result.passed).toBe(true);
      expect(result.totalTasks).toBe(1);
      expect(result.activeTasks).toBe(1);
    });
  });
});
