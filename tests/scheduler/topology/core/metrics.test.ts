import { describe, expect, test } from "bun:test";
import {
  formatWorkSpanBadge,
  generateTaskDagBadge,
  generateWaveLaneBadges,
  schedulingMetrics,
} from "../../../../olt/scripts/src/engine/scheduler/topology/metrics.ts";

describe("schedulingMetrics", () => {
  test("computes critical depth and descendant counts for a simple chain", () => {
    const dependencies = new Map([
      ["A", new Set<string>()],
      ["B", new Set(["A"])],
      ["C", new Set(["B"])],
    ]);
    const metrics = schedulingMetrics(dependencies);
    expect(metrics.criticalDepth.get("A")).toBe(2);
    expect(metrics.criticalDepth.get("B")).toBe(1);
    expect(metrics.criticalDepth.get("C")).toBe(0);
    expect(metrics.descendants.get("A")).toBe(2);
    expect(metrics.descendants.get("C")).toBe(0);
  });

  test("computes critical depth and descendant counts for a diamond DAG", () => {
    const dependencies = new Map([
      ["A", new Set<string>()],
      ["B", new Set(["A"])],
      ["C", new Set(["A"])],
      ["D", new Set(["B", "C"])],
    ]);
    const metrics = schedulingMetrics(dependencies);
    expect(metrics.criticalDepth.get("A")).toBe(2);
    expect(metrics.criticalDepth.get("B")).toBe(1);
    expect(metrics.criticalDepth.get("C")).toBe(1);
    expect(metrics.criticalDepth.get("D")).toBe(0);
    expect(metrics.descendants.get("A")).toBe(3);
    expect(metrics.descendants.get("B")).toBe(1);
    expect(metrics.descendants.get("C")).toBe(1);
    expect(metrics.descendants.get("D")).toBe(0);
  });

  test("computes metrics independently across disconnected components", () => {
    const dependencies = new Map([
      ["X", new Set<string>()],
      ["Y", new Set(["X"])],
      ["A", new Set<string>()],
      ["B", new Set(["A"])],
    ]);
    const metrics = schedulingMetrics(dependencies);
    expect(metrics.criticalDepth.get("X")).toBe(1);
    expect(metrics.criticalDepth.get("Y")).toBe(0);
    expect(metrics.criticalDepth.get("A")).toBe(1);
    expect(metrics.criticalDepth.get("B")).toBe(0);
    expect(metrics.descendants.get("X")).toBe(1);
    expect(metrics.descendants.get("A")).toBe(1);
  });

  test("refuses to compute metrics over a dependency cycle", () => {
    const dependencies = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    expect(() => schedulingMetrics(dependencies)).toThrow(/execution cycle/i);
  });

  test("returns empty metrics maps for empty dependency graph", () => {
    const metrics = schedulingMetrics(new Map());
    expect(metrics.criticalDepth.size).toBe(0);
    expect(metrics.descendants.size).toBe(0);
  });

  test("ignores dangling prerequisites not present in dependency map keys", () => {
    const dependencies = new Map([["B", new Set(["dangling-prereq"])]]);
    const metrics = schedulingMetrics(dependencies);
    expect(metrics.criticalDepth.get("B")).toBe(0);
    expect(metrics.descendants.get("B")).toBe(0);
  });
});

describe("metrics badge generators", () => {
  test("generateTaskDagBadge formats active agent and standard tasks", () => {
    const b1 = generateTaskDagBadge("task-1", "running", {
      wave: 2,
      lane: 1,
      assignedAgent: "agent-1",
      role: "implementer",
      hasDeps: true,
    });
    expect(b1).toBe("[W2:L1 (🟢 ACTIVE) agent-1 (implementer) @ task-1]");

    const b2 = generateTaskDagBadge("task-2", "proposed");
    expect(b2).toBe("[W1 (⏳ BLOCKED) task-2]");

    const b3 = generateTaskDagBadge("task-zero", "ready", { lane: 0, wave: 1 });
    expect(b3).toBe("[W1:L0 (○ READY) task-zero]");

    const b4 = generateTaskDagBadge("task-unknown", "custom_status");
    expect(b4).toBe("[W1 (⏳ BLOCKED) task-unknown]");
  });

  test("generateWaveLaneBadges formats wave groups with status breakdowns", () => {
    const badges = generateWaveLaneBadges([
      {
        wave: 1,
        tasks: [
          { id: "t1", status: "running", assignedAgent: "a1" },
          { id: "t2", status: "ready" },
          { id: "t3", status: "done" },
        ],
      },
      {
        wave: 2,
        tasks: [{ id: "t4", status: "proposed" }],
      },
      {
        wave: 3,
        tasks: [
          { id: "t5", status: "retry_ready" },
          { id: "t6", status: "validated" },
          { id: "t7", status: "validating", assignedAgent: "val-1" },
        ],
      },
      {
        wave: 4,
        tasks: [],
      },
    ]);
    expect(badges[0]).toBe("[WAVE 1: 3 lane(s) (1 active, 1 ready, 1 done)]");
    expect(badges[1]).toBe("[WAVE 2: 1 lane(s)]");
    expect(badges[2]).toBe("[WAVE 3: 3 lane(s) (1 active, 1 ready, 1 done)]");
    expect(badges[3]).toBe("[WAVE 4: 0 lane(s)]");
  });

  test("formats out-of-order wave groups preserving given sequence", () => {
    const badges = generateWaveLaneBadges([
      { wave: 3, tasks: [{ id: "t1", status: "ready" }] },
      { wave: 1, tasks: [{ id: "t2", status: "done" }] },
    ]);
    expect(badges[0]).toBe("[WAVE 3: 1 lane(s) (1 ready)]");
    expect(badges[1]).toBe("[WAVE 1: 1 lane(s) (1 done)]");
  });

  test("formatWorkSpanBadge formats standard work, span, and parallelism metrics", () => {
    expect(formatWorkSpanBadge(10, 4)).toBe("[WORK/SPAN: W=10 | S=4 | P=2.5]");
    expect(formatWorkSpanBadge(10, 4, 3.14)).toBe("[WORK/SPAN: W=10 | S=4 | P=3.14]");
    expect(formatWorkSpanBadge(0, 0)).toBe("[WORK/SPAN: W=0 | S=0 | P=1]");
    expect(formatWorkSpanBadge(7, 3)).toBe("[WORK/SPAN: W=7 | S=3 | P=2.33]");
  });
});
