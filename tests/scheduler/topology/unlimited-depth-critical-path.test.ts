import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { computeCriticalPathDepth } from "../../../olt/scripts/src/engine/scheduler/index.ts";

describe("Unlimited Depth DAG: Critical Path", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
    vfs.reset();
  });

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

    test("accurately selects the deeper chain across disconnected multi-component graph", () => {
      const deps = new Map([
        ["c1-1", new Set<string>()],
        ["c1-2", new Set(["c1-1"])],
        ["c2-1", new Set<string>()],
        ["c2-2", new Set(["c2-1"])],
        ["c2-3", new Set(["c2-2"])],
      ]);
      const tasks = [
        { id: "c1-1", priority: 1, created_order: 1, effort: 1, requirement_ids: [], write_scope: [] },
        { id: "c1-2", priority: 1, created_order: 2, effort: 1, requirement_ids: [], write_scope: [] },
        { id: "c2-1", priority: 1, created_order: 3, effort: 1, requirement_ids: [], write_scope: [] },
        { id: "c2-2", priority: 1, created_order: 4, effort: 1, requirement_ids: [], write_scope: [] },
        { id: "c2-3", priority: 1, created_order: 5, effort: 1, requirement_ids: [], write_scope: [] },
      ];

      const result = computeCriticalPathDepth(deps, tasks);
      expect(result.depth).toBe(3);
      expect(result.criticalPath).toEqual(["c2-1", "c2-2", "c2-3"]);
      expect(result.longestChainEffort).toBe(3);
    });

    test("normalizes zero, negative, or missing effort values to 1", () => {
      const deps = new Map([
        ["t-zero", new Set<string>()],
        ["t-neg", new Set(["t-zero"])],
      ]);
      const tasks = [
        { id: "t-zero", priority: 1, created_order: 1, effort: 0, requirement_ids: [], write_scope: [] },
        { id: "t-neg", priority: 1, created_order: 2, effort: -5, requirement_ids: [], write_scope: [] },
      ];

      const result = computeCriticalPathDepth(deps, tasks);
      expect(result.depth).toBe(2);
      expect(result.longestChainEffort).toBe(2);
    });

    test("breaks tie between branches of equal depth by choosing higher effort branch", () => {
      const deps = new Map([
        ["root", new Set<string>()],
        ["branch-a", new Set(["root"])],
        ["branch-b", new Set(["root"])],
        ["sink", new Set(["branch-a", "branch-b"])],
      ]);
      const tasks = [
        { id: "root", priority: 1, created_order: 1, effort: 1, requirement_ids: [], write_scope: [] },
        { id: "branch-a", priority: 1, created_order: 2, effort: 2, requirement_ids: [], write_scope: [] },
        { id: "branch-b", priority: 1, created_order: 3, effort: 8, requirement_ids: [], write_scope: [] },
        { id: "sink", priority: 1, created_order: 4, effort: 1, requirement_ids: [], write_scope: [] },
      ];

      const result = computeCriticalPathDepth(deps, tasks);
      expect(result.depth).toBe(3);
      expect(result.criticalPath).toEqual(["root", "branch-b", "sink"]);
      expect(result.longestChainEffort).toBe(10);
    });
  });
});
