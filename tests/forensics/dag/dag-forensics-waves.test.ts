import { describe, expect, test } from "bun:test";
import {
  allocateParallelLanes,
  analyzeQueueStalls,
  computeTaskSlack,
  computeTopologicalWaves,
  detectArtificialSerialization,
  renderForensicUnicodeReport,
  renderMermaidDag,
  type ForensicTaskNode,
} from "../../../olt/scripts/src/graph/dag-forensics.ts";
import {
  formatBox,
  renderNodeBox,
  renderVisualDag,
  statusBadge,
  statusGlyph,
} from "../../../olt/scripts/src/summary/graph/index.ts";

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
