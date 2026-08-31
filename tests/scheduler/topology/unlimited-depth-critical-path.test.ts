import { describe, expect, test } from "bun:test";
import { computeCriticalPathDepth } from "../../../../olt/scripts/src/engine/scheduler/index.ts";

describe("Unlimited Depth DAG: Critical Path", () => {
  describe("computeCriticalPathDepth", () => {
    test("computes critical path and effort for a linear chain", () => {
      const deps = new Map([
        ["t1", new Set<string>()],
        ["t2", new Set(["t1"])],
        ["t3", new Set(["t2"])],
      ]);
      const tasks = [
        {
          id: "t1",
          priority: 1,
          created_order: 1,
          effort: 2,
          requirement_ids: [],
          write_scope: [],
        },
        {
          id: "t2",
          priority: 1,
          created_order: 2,
          effort: 3,
          requirement_ids: [],
          write_scope: [],
        },
        {
          id: "t3",
          priority: 1,
          created_order: 3,
          effort: 1,
          requirement_ids: [],
          write_scope: [],
        },
      ];

      const result = computeCriticalPathDepth(deps, tasks);
      expect(result.depth).toBe(3);
      expect(result.criticalPath).toEqual(["t1", "t2", "t3"]);
      expect(result.longestChainEffort).toBe(6);
    });

    test("computes critical path for diamond DAG choosing longest effort branch", () => {
      const deps = new Map([
        ["start", new Set<string>()],
        ["fast-branch", new Set(["start"])],
        ["heavy-branch", new Set(["start"])],
        ["end", new Set(["fast-branch", "heavy-branch"])],
      ]);
      const tasks = new Map([
        [
          "start",
          {
            id: "start",
            priority: 1,
            created_order: 1,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "fast-branch",
          {
            id: "fast-branch",
            priority: 1,
            created_order: 2,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "heavy-branch",
          {
            id: "heavy-branch",
            priority: 1,
            created_order: 3,
            effort: 5,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "end",
          {
            id: "end",
            priority: 1,
            created_order: 4,
            effort: 2,
            requirement_ids: [],
            write_scope: [],
          },
        ],
      ]);

      const result = computeCriticalPathDepth(deps, tasks);
      expect(result.depth).toBe(3);
      expect(result.criticalPath).toEqual(["start", "heavy-branch", "end"]);
      expect(result.longestChainEffort).toBe(8);
    });

    test("handles deep 50-step DAG without arbitrary depth limits", () => {
      const deps = new Map<string, Set<string>>();
      const tasks: {
        id: string;
        priority: number;
        created_order: number;
        effort: number;
        requirement_ids: string[];
        write_scope: string[];
      }[] = [];

      for (let i = 1; i <= 50; i++) {
        const id = `node-${i}`;
        const prereqs = i === 1 ? new Set<string>() : new Set([`node-${i - 1}`]);
        deps.set(id, prereqs);
        tasks.push({
          id,
          priority: 1,
          created_order: i,
          effort: 1,
          requirement_ids: [],
          write_scope: [],
        });
      }

      const result = computeCriticalPathDepth(deps, tasks);
      expect(result.depth).toBe(50);
      expect(result.criticalPath.length).toBe(50);
      expect(result.criticalPath[0]).toBe("node-1");
      expect(result.criticalPath[49]).toBe("node-50");
      expect(result.longestChainEffort).toBe(50);
    });

    test("returns empty critical path on empty DAG", () => {
      const result = computeCriticalPathDepth(new Map(), []);
      expect(result.depth).toBe(0);
      expect(result.criticalPath).toEqual([]);
      expect(result.longestChainEffort).toBe(0);
    });

    test("throws INTEGRITY error on cycle", () => {
      const deps = new Map([
        ["a", new Set(["b"])],
        ["b", new Set(["a"])],
      ]);
      const tasks = [
        {
          id: "a",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: [],
        },
        {
          id: "b",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: [],
        },
      ];

      expect(() => computeCriticalPathDepth(deps, tasks)).toThrow("execution cycle");
    });

    test("accepts Record objects for taskMap in computeCriticalPathDepth", () => {
      const taskRecord = {
        t1: {
          id: "t1",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/ui.tsx"],
        },
      };
      const deps = new Map([["t1", new Set<string>()]]);
      const cpResult = computeCriticalPathDepth(deps, taskRecord);
      expect(cpResult.depth).toBe(1);
    });
  });
});
