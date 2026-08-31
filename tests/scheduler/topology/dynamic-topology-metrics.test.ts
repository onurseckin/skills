import { describe, expect, test } from "bun:test";
import { computeWorkSpanMetrics } from "../../../../olt/scripts/src/engine/scheduler/index.ts";

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
  });
});
