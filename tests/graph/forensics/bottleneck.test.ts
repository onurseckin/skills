import { describe, expect, it } from "bun:test";
import {
  computeCriticalPathDrag,
  computeTaskSlack,
  computeWorkSpan,
  detectFanOutBottlenecks,
  type ForensicTaskNode,
} from "../../../olt/scripts/src/graph/forensics/index.ts";

describe("Forensics Structural Bottlenecks and Drag Path Analysis", () => {
  describe("detectFanOutBottlenecks", () => {
    it("identifies high and medium severity fan-out bottlenecks based on threshold", () => {
      const tasks: ForensicTaskNode[] = [
        { id: "T1", effort: 3 },
        { id: "T2", effort: 2 },
        { id: "T3", effort: 4 },
        { id: "T4", effort: 1 },
        { id: "T5", effort: 5 },
      ];

      const dependencies = new Map<string, Set<string>>([
        ["T1", new Set()],
        ["T2", new Set(["T1"])],
        ["T3", new Set(["T1"])],
        ["T4", new Set(["T1"])],
        ["T5", new Set(["T1"])],
      ]);

      const bottlenecks = detectFanOutBottlenecks(tasks, dependencies, 2);
      expect(bottlenecks.length).toBe(1);

      const b = bottlenecks[0]!;
      expect(b.taskId).toBe("T1");
      expect(b.fanOutCount).toBe(4);
      expect(b.downstreamTaskIds).toEqual(["T2", "T3", "T4", "T5"]);
      expect(b.blockedEffort).toBe(12);
      expect(b.severity).toBe("high");
      expect(b.impactDescription).toContain("Task T1 gates 4 downstream tasks");
    });

    it("evaluates critical path fan-out bottlenecks with elevated severity", () => {
      const tasks: ForensicTaskNode[] = [
        { id: "A", effort: 2 },
        { id: "B", effort: 10 },
        { id: "C", effort: 2 },
        { id: "D", effort: 2 },
        { id: "E", effort: 1 },
      ];

      const dependencies = new Map<string, Set<string>>([
        ["A", new Set()],
        ["B", new Set(["A"])],
        ["C", new Set(["A"])],
        ["D", new Set(["A"])],
        ["E", new Set(["B"])],
      ]);

      const bottlenecks = detectFanOutBottlenecks(tasks, dependencies, 3);
      expect(bottlenecks.length).toBe(1);

      const b = bottlenecks[0]!;
      expect(b.taskId).toBe("A");
      expect(b.isCritical).toBe(true);
      expect(b.severity).toBe("high");
      expect(b.impactDescription).toContain("ON critical path");
    });

    it("returns empty array when fan-out count is below threshold", () => {
      const tasks: ForensicTaskNode[] = [
        { id: "X", effort: 1 },
        { id: "Y", effort: 2 },
      ];

      const dependencies = new Map<string, Set<string>>([
        ["X", new Set()],
        ["Y", new Set(["X"])],
      ]);

      const bottlenecks = detectFanOutBottlenecks(tasks, dependencies, 3);
      expect(bottlenecks.length).toBe(0);
    });
  });

  describe("computeCriticalPathDrag", () => {
    it("calculates exact drag and reduction percentages for critical tasks in a pipeline", () => {
      const tasks: ForensicTaskNode[] = [
        { id: "T1", effort: 4 },
        { id: "T2", effort: 6 },
        { id: "T3", effort: 2 },
      ];

      const dependencies = new Map<string, Set<string>>([
        ["T1", new Set()],
        ["T2", new Set(["T1"])],
        ["T3", new Set(["T2"])],
      ]);

      const drags = computeCriticalPathDrag(tasks, dependencies);
      expect(drags.length).toBe(3);

      const t1Drag = drags.find((d) => d.taskId === "T1")!;
      expect(t1Drag.isCritical).toBe(true);
      expect(t1Drag.drag).toBe(4);
      expect(t1Drag.dragPercentage).toBeCloseTo(33.33, 1);
      expect(t1Drag.dragCostSummary).toContain(
        "Shortening T1 by 4 reduces total project duration to 8",
      );

      const t2Drag = drags.find((d) => d.taskId === "T2")!;
      expect(t2Drag.drag).toBe(6);
      expect(t2Drag.dragPercentage).toBe(50);
    });

    it("assigns zero drag to non-critical tasks with parallel branches", () => {
      const tasks: ForensicTaskNode[] = [
        { id: "Root", effort: 2 },
        { id: "CriticalBranch", effort: 8 },
        { id: "ShortBranch", effort: 2 },
        { id: "Sink", effort: 1 },
      ];

      const dependencies = new Map<string, Set<string>>([
        ["Root", new Set()],
        ["CriticalBranch", new Set(["Root"])],
        ["ShortBranch", new Set(["Root"])],
        ["Sink", new Set(["CriticalBranch", "ShortBranch"])],
      ]);

      const drags = computeCriticalPathDrag(tasks, dependencies);
      const shortDrag = drags.find((d) => d.taskId === "ShortBranch")!;

      expect(shortDrag.isCritical).toBe(false);
      expect(shortDrag.drag).toBe(0);
      expect(shortDrag.dragPercentage).toBe(0);
      expect(shortDrag.dragCostSummary).toContain("non-critical, slack > 0");

      const critDrag = drags.find((d) => d.taskId === "CriticalBranch")!;
      expect(critDrag.isCritical).toBe(true);
      expect(critDrag.drag).toBe(6);
    });

    it("handles zero total span and empty graphs gracefully", () => {
      const zeroTasks: ForensicTaskNode[] = [
        { id: "Z1", effort: 0 },
        { id: "Z2", effort: 0 },
      ];
      const zeroDeps = new Map<string, Set<string>>([
        ["Z1", new Set()],
        ["Z2", new Set(["Z1"])],
      ]);

      const drags = computeCriticalPathDrag(zeroTasks, zeroDeps);
      expect(drags.length).toBe(2);
      expect(drags[0]!.drag).toBe(0);
      expect(drags[0]!.dragPercentage).toBe(0);
      expect(drags[0]!.dragCostSummary).toContain("0 drag");

      const emptyDrags = computeCriticalPathDrag([], new Map());
      expect(emptyDrags.length).toBe(0);
    });
  });

  describe("computeTaskSlack", () => {
    it("accurately computes earliest/latest start/finish and total/free slack", () => {
      const tasks: ForensicTaskNode[] = [
        { id: "Start", effort: 3 },
        { id: "Long", effort: 7 },
        { id: "Short", effort: 2 },
        { id: "End", effort: 4 },
      ];

      const dependencies = new Map<string, Set<string>>([
        ["Start", new Set()],
        ["Long", new Set(["Start"])],
        ["Short", new Set(["Start"])],
        ["End", new Set(["Long", "Short"])],
      ]);

      const slackMap = computeTaskSlack(tasks, dependencies);

      const startSlack = slackMap.get("Start")!;
      expect(startSlack.isCritical).toBe(true);
      expect(startSlack.totalSlack).toBe(0);
      expect(startSlack.freeSlack).toBe(0);

      const longSlack = slackMap.get("Long")!;
      expect(longSlack.isCritical).toBe(true);
      expect(longSlack.totalSlack).toBe(0);
      expect(longSlack.earliestStartTime).toBe(3);
      expect(longSlack.earliestFinishTime).toBe(10);

      const shortSlack = slackMap.get("Short")!;
      expect(shortSlack.isCritical).toBe(false);
      expect(shortSlack.earliestStartTime).toBe(3);
      expect(shortSlack.earliestFinishTime).toBe(5);
      expect(shortSlack.latestStartTime).toBe(8);
      expect(shortSlack.latestFinishTime).toBe(10);
      expect(shortSlack.totalSlack).toBe(5);
      expect(shortSlack.freeSlack).toBe(5);

      const endSlack = slackMap.get("End")!;
      expect(endSlack.isCritical).toBe(true);
      expect(endSlack.totalSlack).toBe(0);
      expect(endSlack.earliestFinishTime).toBe(14);
    });
  });

  describe("computeWorkSpan integration", () => {
    it("aggregates critical path, parallelism factor, bottlenecks, and drags", () => {
      const tasks: ForensicTaskNode[] = [
        { id: "T_INIT", effort: 2 },
        { id: "T_P1", effort: 4 },
        { id: "T_P2", effort: 6 },
        { id: "T_P3", effort: 4 },
        { id: "T_FIN", effort: 2 },
      ];

      const dependencies = new Map<string, Set<string>>([
        ["T_INIT", new Set()],
        ["T_P1", new Set(["T_INIT"])],
        ["T_P2", new Set(["T_INIT"])],
        ["T_P3", new Set(["T_INIT"])],
        ["T_FIN", new Set(["T_P1", "T_P2", "T_P3"])],
      ]);

      const metrics = computeWorkSpan(tasks, dependencies);

      expect(metrics.totalWork).toBe(18);
      expect(metrics.criticalSpan).toBe(10);
      expect(metrics.parallelismFactor).toBe(1.8);
      expect(metrics.criticalPath).toEqual(["T_INIT", "T_P2", "T_FIN"]);
      expect(metrics.drags.length).toBe(5);
      expect(metrics.fanOutBottlenecks.length).toBe(1);
      expect(metrics.fanOutBottlenecks[0]!.taskId).toBe("T_INIT");
      expect(metrics.fanOutBottlenecks[0]!.fanOutCount).toBe(3);
    });
  });
});
