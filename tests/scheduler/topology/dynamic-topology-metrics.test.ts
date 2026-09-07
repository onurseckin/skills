import { describe, expect, test } from "bun:test";
import {
  computeWorkSpanMetrics,
  computeResourceDisjointness,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";

describe("Dynamic Topology: Work & Span Metrics", () => {
  describe("computeWorkSpanMetrics", () => {
    test("computes work and span correctly for linear chain", () => {
      const deps = new Map([
        ["t1", new Set<string>()],
        ["t2", new Set(["t1"])],
        ["t3", new Set(["t2"])],
      ]);
      const tasks = new Map([
        [
          "t1",
          {
            id: "t1",
            priority: 1,
            created_order: 1,
            effort: 2,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "t2",
          {
            id: "t2",
            priority: 1,
            created_order: 2,
            effort: 3,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "t3",
          {
            id: "t3",
            priority: 1,
            created_order: 3,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
      ]);

      const metrics = computeWorkSpanMetrics(deps, tasks);
      expect(metrics.work).toBe(6);
      expect(metrics.span).toBe(6);
      expect(metrics.parallelismFactor).toBe(1);
      expect(metrics.criticalPath).toEqual(["t1", "t2", "t3"]);
      expect(metrics.minWaves).toBe(3);
    });

    test("computes work, span and speedup factor for diamond parallel graph", () => {
      const deps = new Map([
        ["root", new Set<string>()],
        ["branch-a", new Set(["root"])],
        ["branch-b", new Set(["root"])],
        ["branch-c", new Set(["root"])],
        ["join", new Set(["branch-a", "branch-b", "branch-c"])],
      ]);
      const tasks = new Map([
        [
          "root",
          {
            id: "root",
            priority: 1,
            created_order: 1,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "branch-a",
          {
            id: "branch-a",
            priority: 1,
            created_order: 2,
            effort: 4,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "branch-b",
          {
            id: "branch-b",
            priority: 1,
            created_order: 3,
            effort: 2,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "branch-c",
          {
            id: "branch-c",
            priority: 1,
            created_order: 4,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "join",
          {
            id: "join",
            priority: 1,
            created_order: 5,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
      ]);

      const metrics = computeWorkSpanMetrics(deps, tasks);
      expect(metrics.work).toBe(9);
      expect(metrics.span).toBe(6);
      expect(metrics.parallelismFactor).toBe(1.5);
      expect(metrics.criticalPath).toEqual(["root", "branch-a", "join"]);
      expect(metrics.minWaves).toBe(3);
    });

    test("computeWorkSpanMetrics throws on dependency cycle", () => {
      const deps = new Map([
        ["t1", new Set(["t2"])],
        ["t2", new Set(["t1"])],
      ]);
      const tasks = new Map([
        [
          "t1",
          {
            id: "t1",
            priority: 1,
            created_order: 1,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "t2",
          {
            id: "t2",
            priority: 1,
            created_order: 2,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
      ]);
      expect(() => computeWorkSpanMetrics(deps, tasks)).toThrow(/execution cycle/);
    });

    test("computes metrics for completely disconnected parallel tasks", () => {
      const deps = new Map([
        ["t1", new Set<string>()],
        ["t2", new Set<string>()],
        ["t3", new Set<string>()],
      ]);
      const tasks = new Map([
        [
          "t1",
          {
            id: "t1",
            priority: 1,
            created_order: 1,
            effort: 2,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "t2",
          {
            id: "t2",
            priority: 1,
            created_order: 2,
            effort: 5,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "t3",
          {
            id: "t3",
            priority: 1,
            created_order: 3,
            effort: 3,
            requirement_ids: [],
            write_scope: [],
          },
        ],
      ]);

      const metrics = computeWorkSpanMetrics(deps, tasks);
      expect(metrics.work).toBe(10);
      expect(metrics.span).toBe(5);
      expect(metrics.parallelismFactor).toBe(2);
      expect(metrics.criticalPath).toEqual(["t2"]);
      expect(metrics.minWaves).toBe(1);
    });

    test("handles single-node DAG with explicit effort", () => {
      const deps = new Map([["single", new Set<string>()]]);
      const tasks = new Map([
        [
          "single",
          {
            id: "single",
            priority: 1,
            created_order: 1,
            effort: 4,
            requirement_ids: [],
            write_scope: [],
          },
        ],
      ]);

      const metrics = computeWorkSpanMetrics(deps, tasks);
      expect(metrics.work).toBe(4);
      expect(metrics.span).toBe(4);
      expect(metrics.parallelismFactor).toBe(1);
      expect(metrics.criticalPath).toEqual(["single"]);
      expect(metrics.minWaves).toBe(1);
    });

    test("falls back to default effort 1 when task effort is 0, negative, or undefined", () => {
      const deps = new Map([
        ["zero", new Set<string>()],
        ["negative", new Set(["zero"])],
      ]);
      const tasks = new Map([
        [
          "zero",
          {
            id: "zero",
            priority: 1,
            created_order: 1,
            effort: 0,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "negative",
          {
            id: "negative",
            priority: 1,
            created_order: 2,
            effort: -5,
            requirement_ids: [],
            write_scope: [],
          },
        ],
      ]);

      const metrics = computeWorkSpanMetrics(deps, tasks);
      expect(metrics.work).toBe(2);
      expect(metrics.span).toBe(2);
      expect(metrics.parallelismFactor).toBe(1);
      expect(metrics.criticalPath).toEqual(["zero", "negative"]);
    });

    test("throws execution cycle on self-referential dependency loop", () => {
      const deps = new Map([["self-loop", new Set(["self-loop"])]]);
      const tasks = new Map([
        [
          "self-loop",
          {
            id: "self-loop",
            priority: 1,
            created_order: 1,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
      ]);

      expect(() => computeWorkSpanMetrics(deps, tasks)).toThrow(/execution cycle/);
    });

    test("handles high-fanout diamond DAG with 100 parallel branches", () => {
      const branchIds = Array.from({ length: 100 }, (_, i) => `branch-${i}`);
      const branchDeps: Array<[string, Set<string>]> = branchIds.map((id) => [
        id,
        new Set(["root"]),
      ]);
      const deps = new Map<string, Set<string>>([
        ["root", new Set<string>()],
        ...branchDeps,
        ["join", new Set<string>(branchIds)],
      ]);

      const branchEntries = branchIds.map((id, i) => {
        return [
          id,
          {
            id,
            priority: 1,
            created_order: 2 + i,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ] as const;
      });

      const tasks = new Map([
        [
          "root",
          {
            id: "root",
            priority: 1,
            created_order: 1,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        ...branchEntries,
        [
          "join",
          {
            id: "join",
            priority: 1,
            created_order: 102,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
      ]);

      const metrics = computeWorkSpanMetrics(deps, tasks);
      expect(metrics.work).toBe(102);
      expect(metrics.span).toBe(3);
      expect(metrics.parallelismFactor).toBe(34);
      expect(metrics.criticalPath).toHaveLength(3);
      expect(metrics.minWaves).toBe(3);
    });
  });

  describe("computeResourceDisjointness", () => {
    test("computes disjointness metrics for disjoint vs colliding tasks", () => {
      const disjointTasks = [
        {
          id: "task-1",
          label: "task-1",
          status: "ready",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/a.ts"],
          resource_scope: ["res-1"],
        },
        {
          id: "task-2",
          label: "task-2",
          status: "ready",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/b.ts"],
          resource_scope: ["res-2"],
        },
      ];

      const disjointResult = computeResourceDisjointness(disjointTasks);
      expect(disjointResult.disjointComponentCount).toBe(2);
      expect(disjointResult.disjointnessScore).toBe(1);

      const collidingTasks = [
        {
          id: "task-1",
          label: "task-1",
          status: "ready",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/shared.ts"],
          resource_scope: [],
        },
        {
          id: "task-2",
          label: "task-2",
          status: "ready",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/shared.ts"],
          resource_scope: [],
        },
      ];

      const collidingResult = computeResourceDisjointness(collidingTasks);
      expect(collidingResult.disjointComponentCount).toBe(1);
    });
  });
});
