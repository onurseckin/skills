import { describe, expect, test } from "bun:test";
import {
  allocateParallelLanes,
  analyzeQueueStalls,
  breakCycles,
  calculateBrentsTheorem,
  computeCriticalPathDrag,
  computeTaskSlack,
  computeTopologicalWaves,
  computeWorkSpan,
  describeCycle,
  detectArtificialSerialization,
  detectFanOutBottlenecks,
  findCycles,
  isAcyclic,
  renderForensicUnicodeReport,
  renderMermaidDag,
  topologicalOrder,
  type ForensicTaskNode,
} from "../../../orchestrating-long-tasks/scripts/src/graph/dag-forensics.ts";
import {
  formatBox,
  renderNodeBox,
  renderVisualDag,
  statusBadge,
  statusGlyph,
} from "../../../orchestrating-long-tasks/scripts/src/summary/dag-visualizer.ts";

describe("DAG Forensics: Topological Sorting & Acyclicity", () => {
  test("topologicalOrder returns empty array on empty graph", () => {
    const emptyGraph = new Map<string, ReadonlySet<string>>();
    expect(topologicalOrder(emptyGraph)).toEqual([]);
    expect(isAcyclic(emptyGraph)).toBe(true);
  });

  test("topologicalOrder correctly orders linear sequential pipeline", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["t1", new Set<string>()],
      ["t2", new Set(["t1"])],
      ["t3", new Set(["t2"])],
      ["t4", new Set(["t3"])],
    ]);
    expect(topologicalOrder(deps)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(isAcyclic(deps)).toBe(true);
  });

  test("topologicalOrder deterministically breaks ties lexicographically", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["gamma", new Set<string>()],
      ["alpha", new Set<string>()],
      ["beta", new Set<string>()],
      ["omega", new Set(["alpha", "beta", "gamma"])],
    ]);
    expect(topologicalOrder(deps)).toEqual(["alpha", "beta", "gamma", "omega"]);
  });

  test("topologicalOrder handles complex diamond and multi-root graph", () => {
    const deps = new Map<string, ReadonlySet<string>>([
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
    const deps = new Map<string, ReadonlySet<string>>([
      ["task-a", new Set(["task-b"])],
      ["task-b", new Set(["task-a"])],
    ]);
    expect(isAcyclic(deps)).toBe(false);
    const cycles = findCycles(deps);
    expect(cycles.length).toBeGreaterThan(0);
    const firstCycle = cycles[0];
    expect(firstCycle).toBeDefined();
    if (firstCycle !== undefined) {
      expect(firstCycle).toContain("task-a");
      expect(firstCycle).toContain("task-b");
    }
  });

  test("describeCycle formats exact human-readable cycle and names break edge", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["task-1", new Set(["task-2"])],
      ["task-2", new Set(["task-1"])],
    ]);
    const desc = describeCycle(deps);
    expect(desc).toContain("task-1 --deps task-2 and task-2 --deps task-1 form a cycle");
    expect(desc).toContain("drop task-1 --deps task-2 to break it");
  });

  test("describeCycle describes 3-cycle correctly with Oxford comma", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
      ["c", new Set(["a"])],
    ]);
    const desc = describeCycle(deps);
    expect(desc).toContain("a --deps b, b --deps c, and c --deps a form a cycle");
    expect(desc).toContain("drop a --deps b to break it");
  });

  test("describeCycle returns 'no cycle detected' for acyclic graphs", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
    ]);
    expect(describeCycle(deps)).toBe("no cycle detected");
  });

  test("breakCycles automatically drops minimal feedback edges to restore acyclicity", () => {
    const cyclicDeps = new Map<string, ReadonlySet<string>>([
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
    const deps = new Map<string, ReadonlySet<string>>([
      ["t1", new Set<string>()],
      ["t2", new Set(["t1"])],
      ["t3", new Set(["t2"])],
    ]);

    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(10);
    expect(metrics.criticalSpan).toBe(10);
    expect(metrics.parallelismFactor).toBe(1);
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
    const deps = new Map<string, ReadonlySet<string>>([
      ["t1", new Set<string>()],
      ["t2", new Set<string>()],
      ["t3", new Set<string>()],
      ["t4", new Set<string>()],
    ]);

    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(16);
    expect(metrics.criticalSpan).toBe(4);
    expect(metrics.parallelismFactor).toBe(4);
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
    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set<string>()],
      ["fast-branch", new Set(["root"])],
      ["slow-branch-1", new Set(["root"])],
      ["slow-branch-2", new Set(["slow-branch-1"])],
      ["join", new Set(["fast-branch", "slow-branch-2"])],
    ]);

    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(12);
    expect(metrics.criticalSpan).toBe(11);
    expect(metrics.parallelismFactor).toBe(1.09);
    expect(metrics.criticalPath).toEqual(["root", "slow-branch-1", "slow-branch-2", "join"]);
  });

  test("calculateBrentsTheorem computes exact lower bound, upper bound, and speedup", () => {
    const W = 100;
    const S = 20;

    const b1 = calculateBrentsTheorem(W, S, 1);
    expect(b1.lowerBound).toBe(100);
    expect(b1.upperBound).toBe(100);
    expect(b1.theoreticalSpeedup).toBe(1);
    expect(b1.theoreticalEfficiency).toBe(1);

    const b4 = calculateBrentsTheorem(W, S, 4);
    expect(b4.lowerBound).toBe(25);
    expect(b4.upperBound).toBe(40);
    expect(b4.estimatedTime).toBeGreaterThanOrEqual(25);
    expect(b4.estimatedTime).toBeLessThanOrEqual(40);
    expect(b4.theoreticalSpeedup).toBeGreaterThan(1);
  });
});

describe("DAG Forensics: Critical Path Drag Analysis", () => {
  test("computeCriticalPathDrag calculates drag for all nodes", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "root", effort: 3 },
      { id: "fast", effort: 2 },
      { id: "slow", effort: 6 },
      { id: "sink", effort: 4 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set<string>()],
      ["fast", new Set(["root"])],
      ["slow", new Set(["root"])],
      ["sink", new Set(["fast", "slow"])],
    ]);

    const drags = computeCriticalPathDrag(tasks, deps);

    const rootDrag = drags.find((d) => d.taskId === "root");
    expect(rootDrag).toBeDefined();
    if (rootDrag !== undefined) {
      expect(rootDrag.isCritical).toBe(true);
      expect(rootDrag.drag).toBe(3);
      expect(rootDrag.dragCostSummary).toContain("root exerts 3 units");
    }

    const slowDrag = drags.find((d) => d.taskId === "slow");
    expect(slowDrag).toBeDefined();
    if (slowDrag !== undefined) {
      expect(slowDrag.isCritical).toBe(true);
      expect(slowDrag.drag).toBe(4);
    }

    const fastDrag = drags.find((d) => d.taskId === "fast");
    expect(fastDrag).toBeDefined();
    if (fastDrag !== undefined) {
      expect(fastDrag.isCritical).toBe(false);
      expect(fastDrag.drag).toBe(0);
      expect(fastDrag.dragCostSummary).toContain("0 drag (non-critical");
    }

    const sinkDrag = drags.find((d) => d.taskId === "sink");
    expect(sinkDrag).toBeDefined();
    if (sinkDrag !== undefined) {
      expect(sinkDrag.isCritical).toBe(true);
      expect(sinkDrag.drag).toBe(4);
    }
  });
});

describe("DAG Forensics: Fan-Out Bottleneck Detection", () => {
  test("detectFanOutBottlenecks detects high fan-out gates", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "producer", effort: 2 },
      { id: "c1", effort: 3 },
      { id: "c2", effort: 4 },
      { id: "c3", effort: 5 },
      { id: "unrelated", effort: 1 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["producer", new Set<string>()],
      ["c1", new Set(["producer"])],
      ["c2", new Set(["producer"])],
      ["c3", new Set(["producer"])],
      ["unrelated", new Set<string>()],
    ]);

    const bottlenecks = detectFanOutBottlenecks(tasks, deps, 2);

    expect(bottlenecks.length).toBe(1);
    const b = bottlenecks[0];
    expect(b).toBeDefined();
    if (b !== undefined) {
      expect(b.taskId).toBe("producer");
      expect(b.fanOutCount).toBe(3);
      expect(b.blockedEffort).toBe(12);
      expect(b.downstreamTaskIds).toEqual(["c1", "c2", "c3"]);
      expect(b.impactDescription).toContain("producer gates 3 downstream tasks");
    }
  });
});

describe("DAG Forensics: Queue Stalls & Serialization Justifications", () => {
  test("analyzeQueueStalls identifies artificial serialization vs dataflow justification", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "auth", writeScope: ["src/auth.ts"], effort: 5 },
      {
        id: "ui",
        writeScope: ["src/ui.ts"],
        effort: 3,
        dependencies: ["auth"],
      },
      {
        id: "api",
        writeScope: ["src/api.ts"],
        effort: 4,
        dependencies: ["auth"],
        depReasons: { auth: "consumes AuthToken interface from auth module" },
      },
      {
        id: "auth-sub",
        writeScope: ["src/auth.ts"],
        effort: 2,
        dependencies: ["auth"],
      },
    ];

    const stalls = analyzeQueueStalls(tasks);
    expect(stalls.length).toBe(3);

    const uiStall = stalls.find((s) => s.blockedTaskId === "ui");
    expect(uiStall).toBeDefined();
    if (uiStall !== undefined) {
      expect(uiStall.writeScopeDisjoint).toBe(true);
      expect(uiStall.isDataflowJustified).toBe(false);
      expect(uiStall.isCriticalStall).toBe(true);
      expect(uiStall.stallDuration).toBe(5);
      expect(uiStall.recommendation).toContain("Eliminate sequential dependency");
    }

    const apiStall = stalls.find((s) => s.blockedTaskId === "api");
    expect(apiStall).toBeDefined();
    if (apiStall !== undefined) {
      expect(apiStall.writeScopeDisjoint).toBe(true);
      expect(apiStall.isDataflowJustified).toBe(true);
      expect(apiStall.isCriticalStall).toBe(false);
      expect(apiStall.depReason).toBe("consumes AuthToken interface from auth module");
      expect(apiStall.recommendation).toContain("validated dataflow justification");
    }

    const authSubStall = stalls.find((s) => s.blockedTaskId === "auth-sub");
    expect(authSubStall).toBeDefined();
    if (authSubStall !== undefined) {
      expect(authSubStall.writeScopeDisjoint).toBe(false);
      expect(authSubStall.isCriticalStall).toBe(false);
      expect(authSubStall.recommendation).toContain("Physical write scope overlap");
    }
  });

  test("detectArtificialSerialization issues formal warning for disjoint scopes without reason", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "task-docs", writeScope: ["docs/readme.md"] },
      { id: "task-backend", writeScope: ["src/server.ts"], dependencies: ["task-docs"] },
    ];

    const warnings = detectArtificialSerialization(tasks);

    expect(warnings.length).toBe(1);
    const w = warnings[0];
    expect(w).toBeDefined();
    if (w !== undefined) {
      expect(w.code).toBe("ARTIFICIAL_SERIALIZATION_WARNING");
      expect(w.blockedTask).toBe("task-backend");
      expect(w.dependencyTask).toBe("task-docs");
    }
  });
});

describe("DAG Forensics: Task Slack Analysis", () => {
  test("computeTaskSlack computes EST, EFT, LST, LFT, Total Slack, and Free Slack", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "root", effort: 2 },
      { id: "short", effort: 1 },
      { id: "long", effort: 5 },
      { id: "join", effort: 2 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set<string>()],
      ["short", new Set(["root"])],
      ["long", new Set(["root"])],
      ["join", new Set(["short", "long"])],
    ]);

    const slackMap = computeTaskSlack(tasks, deps);

    const rootSlack = slackMap.get("root");
    expect(rootSlack).toBeDefined();
    if (rootSlack !== undefined) {
      expect(rootSlack.isCritical).toBe(true);
      expect(rootSlack.totalSlack).toBe(0);
      expect(rootSlack.freeSlack).toBe(0);
      expect(rootSlack.earliestStartTime).toBe(0);
      expect(rootSlack.earliestFinishTime).toBe(2);
    }

    const longSlack = slackMap.get("long");
    expect(longSlack).toBeDefined();
    if (longSlack !== undefined) {
      expect(longSlack.isCritical).toBe(true);
      expect(longSlack.totalSlack).toBe(0);
    }

    const joinSlack = slackMap.get("join");
    expect(joinSlack).toBeDefined();
    if (joinSlack !== undefined) {
      expect(joinSlack.isCritical).toBe(true);
      expect(joinSlack.totalSlack).toBe(0);
    }

    const shortSlack = slackMap.get("short");
    expect(shortSlack).toBeDefined();
    if (shortSlack !== undefined) {
      expect(shortSlack.isCritical).toBe(false);
      expect(shortSlack.totalSlack).toBe(4);
      expect(shortSlack.freeSlack).toBe(4);
    }
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
    const deps = new Map<string, ReadonlySet<string>>([
      ["r1", new Set<string>()],
      ["r2", new Set<string>()],
      ["w2-a", new Set(["r1"])],
      ["w2-b", new Set(["r2"])],
      ["w3", new Set(["w2-a", "w2-b"])],
    ]);

    const waves = computeTopologicalWaves(tasks, deps);

    expect(waves.length).toBe(3);
    const w1 = waves[0];
    expect(w1).toBeDefined();
    if (w1 !== undefined) {
      expect(w1.waveIndex).toBe(1);
      expect([...w1.taskIds].sort()).toEqual(["r1", "r2"]);
    }

    const w2 = waves[1];
    expect(w2).toBeDefined();
    if (w2 !== undefined) {
      expect(w2.waveIndex).toBe(2);
      expect([...w2.taskIds].sort()).toEqual(["w2-a", "w2-b"]);
    }

    const w3 = waves[2];
    expect(w3).toBeDefined();
    if (w3 !== undefined) {
      expect(w3.waveIndex).toBe(3);
      expect(w3.taskIds).toEqual(["w3"]);
    }
  });

  test("allocateParallelLanes assigns distinct lane indices", () => {
    const tasks: ForensicTaskNode[] = [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }];
    const deps = new Map<string, ReadonlySet<string>>([
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
});

describe("DAG Forensics: Unicode & Mermaid Rendering", () => {
  test("renderMermaidDag produces valid Mermaid graph TD output", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "task-a", label: "Task Alpha" },
      { id: "task-b", label: "Task Beta" },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["task-a", new Set<string>()],
      ["task-b", new Set(["task-a"])],
    ]);

    const mermaid = renderMermaidDag(tasks, deps);

    expect(mermaid).toContain("graph TD");
    expect(mermaid).toContain('task-a["task-a: Task Alpha"]');
    expect(mermaid).toContain("task-a --> task-b");
  });

  test("renderForensicUnicodeReport generates comprehensive diagnostics table", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "task-1", effort: 3, writeScope: ["src/mod1.ts"] },
      { id: "task-2", effort: 4, writeScope: ["src/mod2.ts"], dependencies: ["task-1"] },
      { id: "task-3", effort: 2, writeScope: ["src/mod3.ts"], dependencies: ["task-1"] },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["task-1", new Set<string>()],
      ["task-2", new Set(["task-1"])],
      ["task-3", new Set(["task-1"])],
    ]);

    const report = renderForensicUnicodeReport(tasks, deps);

    expect(report).toContain("DAG FORENSICS & WORK/SPAN REPORT");
    expect(report).toContain("Total Work (W): 9");
    expect(report).toContain("Critical Span (S): 7");
    expect(report).toContain("task-1");
    expect(report).toContain("task-2");
    expect(report).toContain("task-3");
    expect(report).toContain("FAN-OUT BOTTLENECKS:");
  });

  test("formatBox creates exact rectangular Unicode box with consistent width", () => {
    const rows = ["Hello World", "Line 2 is longer than line 1"];
    const box = formatBox(rows, 63, false);

    expect(box.length).toBe(4);
    for (const line of box) {
      expect(line.length).toBe(63);
    }
    const firstLine = box[0];
    const lastLine = box[box.length - 1];
    expect(firstLine).toBeDefined();
    expect(lastLine).toBeDefined();
    if (firstLine !== undefined && lastLine !== undefined) {
      expect(firstLine.startsWith("┌")).toBe(true);
      expect(lastLine.startsWith("└")).toBe(true);
    }
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
