import { describe, expect, test } from "bun:test";
import {
  allocateParallelLanes,
  breakCycles,
  calculateBrentsTheorem,
  computeTaskSlack,
  computeTopologicalWaves,
  computeWorkSpan,
  describeCycle,
  detectArtificialSerialization,
  findCycles,
  isAcyclic,
  renderMermaidDag,
  topologicalOrder,
  type ForensicTaskNode,
} from "../../../orchestrating-long-tasks/scripts/src/graph/dag-forensics.ts";
import {
  formatBox,
  renderAsciiDag,
  renderNodeBox,
  renderVisualDag,
  statusBadge,
  statusGlyph,
} from "../../../orchestrating-long-tasks/scripts/src/summary/dag-visualizer.ts";

describe("DAG Forensics: Topological Sorting & Acyclicity", () => {
  test("topologicalOrder returns empty array on empty graph", () => {
    expect(topologicalOrder(new Map())).toEqual([]);
    expect(isAcyclic(new Map())).toBe(true);
  });

  test("topologicalOrder correctly orders linear sequential pipeline", () => {
    const deps = new Map([
      ["t1", new Set<string>()],
      ["t2", new Set(["t1"])],
      ["t3", new Set(["t2"])],
      ["t4", new Set(["t3"])],
    ]);
    expect(topologicalOrder(deps)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(isAcyclic(deps)).toBe(true);
  });

  test("topologicalOrder deterministically breaks ties lexicographically", () => {
    const deps = new Map([
      ["gamma", new Set<string>()],
      ["alpha", new Set<string>()],
      ["beta", new Set<string>()],
      ["omega", new Set(["alpha", "beta", "gamma"])],
    ]);
    expect(topologicalOrder(deps)).toEqual(["alpha", "beta", "gamma", "omega"]);
  });

  test("topologicalOrder handles complex diamond and multi-root graph", () => {
    const deps = new Map([
      ["root-1", new Set<string>()],
      ["root-2", new Set<string>()],
      ["mid-a", new Set(["root-1"])],
      ["mid-b", new Set(["root-1", "root-2"])],
      ["mid-c", new Set(["root-2"])],
      ["leaf", new Set(["mid-a", "mid-b", "mid-c"])],
    ]);
    const order = topologicalOrder(deps);
    expect(order.indexOf("root-1")).toBeLessThan(order.indexOf("mid-a"));
    expect(order.indexOf("root-1")).toBeLessThan(order.indexOf("mid-b"));
    expect(order.indexOf("root-2")).toBeLessThan(order.indexOf("mid-b"));
    expect(order.indexOf("root-2")).toBeLessThan(order.indexOf("mid-c"));
    expect(order.indexOf("mid-a")).toBeLessThan(order.indexOf("leaf"));
    expect(order.indexOf("mid-b")).toBeLessThan(order.indexOf("leaf"));
    expect(order.indexOf("mid-c")).toBeLessThan(order.indexOf("leaf"));
    expect(order.length).toBe(6);
  });
});

describe("DAG Forensics: Cycle Detection, Description & Breaking", () => {
  test("findCycles detects 2-cycle and returns cycle path", () => {
    const deps = new Map([
      ["task-a", new Set(["task-b"])],
      ["task-b", new Set(["task-a"])],
    ]);
    expect(isAcyclic(deps)).toBe(false);
    const cycles = findCycles(deps);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]).toContain("task-a");
    expect(cycles[0]).toContain("task-b");
  });

  test("describeCycle formats exact human-readable cycle and names break edge", () => {
    const deps = new Map([
      ["task-1", new Set(["task-2"])],
      ["task-2", new Set(["task-1"])],
    ]);
    const desc = describeCycle(deps);
    expect(desc).toContain("task-1 --deps task-2 and task-2 --deps task-1 form a cycle");
    expect(desc).toContain("drop task-1 --deps task-2 to break it");
  });

  test("describeCycle describes 3-cycle correctly with Oxford comma", () => {
    const deps = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
      ["c", new Set(["a"])],
    ]);
    const desc = describeCycle(deps);
    expect(desc).toContain("a --deps b, b --deps c, and c --deps a form a cycle");
    expect(desc).toContain("drop a --deps b to break it");
  });

  test("describeCycle returns 'no cycle detected' for acyclic graphs", () => {
    const deps = new Map([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
    ]);
    expect(describeCycle(deps)).toBe("no cycle detected");
  });

  test("breakCycles automatically drops minimal feedback edges to restore acyclicity", () => {
    const cyclicDeps = new Map([
      ["task-x", new Set(["task-y"])],
      ["task-y", new Set(["task-z"])],
      ["task-z", new Set(["task-x"])],
      ["task-independent", new Set<string>()],
    ]);

    expect(isAcyclic(cyclicDeps)).toBe(false);

    const { acyclicDependencies, brokenEdges } = breakCycles(cyclicDeps);

    expect(isAcyclic(acyclicDependencies)).toBe(true);
    expect(brokenEdges.length).toBeGreaterThanOrEqual(1);
    expect(topologicalOrder(acyclicDependencies).length).toBe(4);
  });
});

describe("DAG Forensics: Work / Span Mathematics & Brent's Theorem", () => {
  test("computeWorkSpan calculates total work, critical span, and parallelism for sequential chain", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "t1", effort: 2 },
      { id: "t2", effort: 3 },
      { id: "t3", effort: 5 },
    ];
    const deps = new Map([
      ["t1", new Set<string>()],
      ["t2", new Set(["t1"])],
      ["t3", new Set(["t2"])],
    ]);

    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(10);
    expect(metrics.criticalSpan).toBe(10);
    expect(metrics.parallelismFactor).toBe(1); // P = W / S = 10 / 10 = 1
    expect(metrics.optimalLanes).toBe(1);
    expect(metrics.criticalPath).toEqual(["t1", "t2", "t3"]);
  });

  test("computeWorkSpan calculates metrics for perfectly parallel tasks", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "t1", effort: 4 },
      { id: "t2", effort: 4 },
      { id: "t3", effort: 4 },
      { id: "t4", effort: 4 },
    ];
    const deps = new Map([
      ["t1", new Set<string>()],
      ["t2", new Set<string>()],
      ["t3", new Set<string>()],
      ["t4", new Set<string>()],
    ]);

    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(16);
    expect(metrics.criticalSpan).toBe(4);
    expect(metrics.parallelismFactor).toBe(4); // P = W / S = 16 / 4 = 4
    expect(metrics.optimalLanes).toBe(4);
  });

  test("computeWorkSpan correctly identifies critical path in asymmetric diamond DAG", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "root", effort: 2 },
      { id: "fast-branch", effort: 1 },
      { id: "slow-branch-1", effort: 4 },
      { id: "slow-branch-2", effort: 3 },
      { id: "join", effort: 2 },
    ];
    const deps = new Map([
      ["root", new Set<string>()],
      ["fast-branch", new Set(["root"])],
      ["slow-branch-1", new Set(["root"])],
      ["slow-branch-2", new Set(["slow-branch-1"])],
      ["join", new Set(["fast-branch", "slow-branch-2"])],
    ]);

    const metrics = computeWorkSpan(tasks, deps);

    // Critical path: root(2) -> slow-1(4) -> slow-2(3) -> join(2) = 11
    // Total work: 2 + 1 + 4 + 3 + 2 = 12
    expect(metrics.totalWork).toBe(12);
    expect(metrics.criticalSpan).toBe(11);
    expect(metrics.parallelismFactor).toBe(1.09); // 12 / 11 rounded
    expect(metrics.criticalPath).toEqual(["root", "slow-branch-1", "slow-branch-2", "join"]);
  });

  test("calculateBrentsTheorem computes exact lower bound, upper bound, and speedup", () => {
    const W = 100;
    const S = 20;

    // For p = 1 worker: T_1 = 100, Speedup = 1.0, Efficiency = 1.0
    const b1 = calculateBrentsTheorem(W, S, 1);
    expect(b1.lowerBound).toBe(100);
    expect(b1.upperBound).toBe(100);
    expect(b1.theoreticalSpeedup).toBe(1);
    expect(b1.theoreticalEfficiency).toBe(1);

    // For p = 4 workers:
    // Lower bound: max(ceil(100/4), 20) = max(25, 20) = 25
    // Upper bound: floor((100 - 20)/4) + 20 = 20 + 20 = 40
    const b4 = calculateBrentsTheorem(W, S, 4);
    expect(b4.lowerBound).toBe(25);
    expect(b4.upperBound).toBe(40);
    expect(b4.estimatedTime).toBeGreaterThanOrEqual(25);
    expect(b4.estimatedTime).toBeLessThanOrEqual(40);
    expect(b4.theoreticalSpeedup).toBeGreaterThan(1);
  });

  test("computeTaskSlack computes EST, EFT, LST, LFT and identifies critical nodes with 0 slack", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "root", effort: 2 },
      { id: "short", effort: 1 },
      { id: "long", effort: 5 },
      { id: "join", effort: 2 },
    ];
    const deps = new Map([
      ["root", new Set<string>()],
      ["short", new Set(["root"])],
      ["long", new Set(["root"])],
      ["join", new Set(["short", "long"])],
    ]);

    const slackMap = computeTaskSlack(tasks, deps);

    // Total span: root(2) + long(5) + join(2) = 9
    const rootSlack = slackMap.get("root")!;
    expect(rootSlack.isCritical).toBe(true);
    expect(rootSlack.totalSlack).toBe(0);
    expect(rootSlack.earliestStartTime).toBe(0);
    expect(rootSlack.earliestFinishTime).toBe(2);

    const longSlack = slackMap.get("long")!;
    expect(longSlack.isCritical).toBe(true);
    expect(longSlack.totalSlack).toBe(0);

    const joinSlack = slackMap.get("join")!;
    expect(joinSlack.isCritical).toBe(true);
    expect(joinSlack.totalSlack).toBe(0);

    const shortSlack = slackMap.get("short")!;
    expect(shortSlack.isCritical).toBe(false);
    expect(shortSlack.totalSlack).toBe(4); // Can slip by 4 units without delaying join
  });
});

describe("DAG Forensics: Waves & Parallel Lane Allocation", () => {
  test("computeTopologicalWaves groups tasks by causal wave", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "r1", writeScope: ["src/a"] },
      { id: "r2", writeScope: ["src/b"] },
      { id: "w2-a", writeScope: ["src/c"], dependencies: ["r1"] },
      { id: "w2-b", writeScope: ["src/d"], dependencies: ["r2"] },
      { id: "w3", writeScope: ["src/e"], dependencies: ["w2-a", "w2-b"] },
    ];
    const deps = new Map([
      ["r1", new Set<string>()],
      ["r2", new Set<string>()],
      ["w2-a", new Set(["r1"])],
      ["w2-b", new Set(["r2"])],
      ["w3", new Set(["w2-a", "w2-b"])],
    ]);

    const waves = computeTopologicalWaves(tasks, deps);

    expect(waves.length).toBe(3);
    expect(waves[0]?.waveIndex).toBe(1);
    expect(waves[0]?.taskIds.sort()).toEqual(["r1", "r2"]);
    expect(waves[1]?.waveIndex).toBe(2);
    expect(waves[1]?.taskIds.sort()).toEqual(["w2-a", "w2-b"]);
    expect(waves[2]?.waveIndex).toBe(3);
    expect(waves[2]?.taskIds).toEqual(["w3"]);
  });

  test("allocateParallelLanes assigns distinct lane indices", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "p1" },
      { id: "p2" },
      { id: "p3" },
      { id: "p4" },
    ];
    const deps = new Map([
      ["p1", new Set<string>()],
      ["p2", new Set<string>()],
      ["p3", new Set<string>()],
      ["p4", new Set<string>()],
    ]);

    const lanes = allocateParallelLanes(tasks, deps, 4);

    expect(lanes.length).toBe(4);
    const laneIndices = lanes.map((l) => l.laneIndex);
    expect(new Set(laneIndices).size).toBe(4);
  });

  test("detectArtificialSerialization identifies false serialization with disjoint scopes", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "task-docs", writeScope: ["docs/readme.md"] },
      { id: "task-backend", writeScope: ["src/server.ts"], dependencies: ["task-docs"] },
    ];

    const warnings = detectArtificialSerialization(tasks);

    expect(warnings.length).toBe(1);
    expect(warnings[0]?.code).toBe("ARTIFICIAL_SERIALIZATION_WARNING");
    expect(warnings[0]?.blockedTask).toBe("task-backend");
    expect(warnings[0]?.dependencyTask).toBe("task-docs");
  });
});

describe("DAG Forensics: Visual & Mermaid Rendering", () => {
  test("renderMermaidDag produces valid Mermaid graph TD output", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "task-a", label: "Task Alpha" },
      { id: "task-b", label: "Task Beta" },
    ];
    const deps = new Map([
      ["task-a", new Set<string>()],
      ["task-b", new Set(["task-a"])],
    ]);

    const mermaid = renderMermaidDag(tasks, deps);

    expect(mermaid).toContain("graph TD");
    expect(mermaid).toContain('task-a["task-a: Task Alpha"]');
    expect(mermaid).toContain("task-a --> task-b");
  });

  test("formatBox creates exact rectangular Unicode box with consistent width", () => {
    const rows = ["Hello World", "Line 2 is longer than line 1"];
    const box = formatBox(rows, 63, false);

    expect(box.length).toBe(4); // top, row1, row2, bottom
    for (const line of box) {
      expect(line.length).toBe(63);
    }
    expect(box[0]?.startsWith("┌")).toBe(true);
    expect(box[box.length - 1]?.startsWith("└")).toBe(true);
  });

  test("renderNodeBox and statusBadge render appropriate glyphs", () => {
    expect(statusGlyph("satisfied")).toBe("(✓ SATISFIED)");
    expect(statusGlyph("leased")).toBe("(🟢 ACTIVE)");
    expect(statusGlyph("validating")).toBe("(🔵 VALIDATING)");
    expect(statusGlyph("failed")).toBe("(❌ FAILED)");
    expect(statusBadge("ready")).toBe("(○ READY)");
  });

  test("renderVisualDag handles empty wave gracefully", () => {
    const output = renderVisualDag([]);
    expect(output).toContain("No tasks declared in planning buffer/graph");
  });
});
