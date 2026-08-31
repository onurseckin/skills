import { describe, expect, test } from "bun:test";
import {
  formatWorkSpanBadge,
  generateTaskDagBadge,
  generateWaveLaneBadges,
  schedulingMetrics,
} from "../../../olt/scripts/src/engine/scheduler/topology/metrics.ts";

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

  test("refuses to compute metrics over a dependency cycle", () => {
    const dependencies = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    expect(() => schedulingMetrics(dependencies)).toThrow(/execution cycle/i);
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
    ]);
    expect(badges[0]).toBe("[WAVE 1: 3 lane(s) (1 active, 1 ready, 1 done)]");
    expect(badges[1]).toBe("[WAVE 2: 1 lane(s)]");
  });

  test("formatWorkSpanBadge formats standard work, span, and parallelism metrics", () => {
    expect(formatWorkSpanBadge(10, 4)).toBe("[WORK/SPAN: W=10 | S=4 | P=2.5]");
    expect(formatWorkSpanBadge(10, 4, 3.14)).toBe("[WORK/SPAN: W=10 | S=4 | P=3.14]");
    expect(formatWorkSpanBadge(0, 0)).toBe("[WORK/SPAN: W=0 | S=0 | P=1]");
  });
});
