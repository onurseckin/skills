import { describe, expect, it } from "bun:test";
import {
  assignSugiyamaRanks,
  buildSugiyamaDagReport,
  detectCyclesTarjan,
  detectIllegalBypasses,
  getStatusBadge,
  getStatusGlyph,
  minimizeCrossingsBarycenter,
  renderRoundedNodeBox,
  renderSugiyamaDag,
  type SugiyamaEdge,
  type SugiyamaLayer,
  type SugiyamaNode,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/sugiyama-dag.ts";
import { executeDagRenderCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/dag.ts";

describe("Sugiyama DAG Renderer & Diagnostics (p24, p25, p26)", () => {
  describe("Status badges and glyphs", () => {
    it("returns correct status badges and glyphs for all state variants", () => {
      expect(getStatusBadge("done")).toBe("✓ PASSED");
      expect(getStatusBadge("satisfied")).toBe("✓ PASSED");
      expect(getStatusBadge("passed")).toBe("✓ PASSED");
      expect(getStatusBadge("running")).toBe("🟢 RUNNING");
      expect(getStatusBadge("leased")).toBe("🟢 RUNNING");
      expect(getStatusBadge("validating")).toBe("🔄 VALIDATING");
      expect(getStatusBadge("validated")).toBe("🟣 VALIDATED");
      expect(getStatusBadge("ready")).toBe("○ READY");
      expect(getStatusBadge("changes_requested")).toBe("🔴 CHANGES_REQ");
      expect(getStatusBadge("failed")).toBe("❌ REJECTED");
      expect(getStatusBadge("rejected")).toBe("❌ REJECTED");
      expect(getStatusBadge("escalated")).toBe("🚨 ESCALATED");
      expect(getStatusBadge("blocked")).toBe("⏳ BLOCKED");
      expect(getStatusBadge("draft", true)).toBe("⏳ BLOCKED");
      expect(getStatusBadge("draft", false)).toBe("○ READY");

      expect(getStatusGlyph("running")).toBe("(🟢 RUNNING)");
      expect(getStatusGlyph("done")).toBe("(✓ PASSED)");
      expect(getStatusGlyph("failed")).toBe("(❌ REJECTED)");
    });
  });

  describe("Hierarchical Layering (Sugiyama Step 1)", () => {
    it("assigns topological ranks correctly for linear and diamond DAGs", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "Task A", status: "done", dependencies: [] },
        { id: "B", label: "Task B", status: "done", dependencies: ["A"] },
        { id: "C", label: "Task C", status: "ready", dependencies: ["A"] },
        { id: "D", label: "Task D", status: "blocked", dependencies: ["B", "C"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
        { from: "B", to: "D" },
        { from: "C", to: "D" },
      ];

      const rankMap = assignSugiyamaRanks(nodes, edges);
      expect(rankMap.get("A")).toBe(0);
      expect(rankMap.get("B")).toBe(1);
      expect(rankMap.get("C")).toBe(1);
      expect(rankMap.get("D")).toBe(2);
    });

    it("handles disconnected components by ranking roots at 0", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "Task A", status: "ready", dependencies: [] },
        { id: "B", label: "Task B", status: "blocked", dependencies: ["A"] },
        { id: "X", label: "Task X", status: "ready", dependencies: [] },
        { id: "Y", label: "Task Y", status: "blocked", dependencies: ["X"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "X", to: "Y" },
      ];

      const rankMap = assignSugiyamaRanks(nodes, edges);
      expect(rankMap.get("A")).toBe(0);
      expect(rankMap.get("X")).toBe(0);
      expect(rankMap.get("B")).toBe(1);
      expect(rankMap.get("Y")).toBe(1);
    });
  });

  describe("Crossing Minimization (Sugiyama Step 2)", () => {
    it("reorders layer nodes to minimize edge crossings using barycenter heuristic", () => {
      const layer0: SugiyamaLayer = {
        rank: 0,
        nodes: [
          { id: "A", label: "A", status: "done", dependencies: [], rank: 0, order: 0 },
          { id: "B", label: "B", status: "done", dependencies: [], rank: 0, order: 1 },
        ],
      };
      const layer1: SugiyamaLayer = {
        rank: 1,
        nodes: [
          { id: "Y", label: "Y", status: "ready", dependencies: ["A"], rank: 1, order: 0 },
          { id: "X", label: "X", status: "ready", dependencies: ["B"], rank: 1, order: 1 },
        ],
      };
      // Edges cross: A -> X, B -> Y
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "X" },
        { from: "B", to: "Y" },
      ];

      const optimized = minimizeCrossingsBarycenter([layer0, layer1], edges);
      expect(optimized.length).toBe(2);
      // X should now precede Y in layer 1 to eliminate crossing
      expect(optimized[1]!.nodes[0]!.id).toBe("X");
      expect(optimized[1]!.nodes[1]!.id).toBe("Y");
    });
  });

  describe("Rounded Box Rendering", () => {
    it("renders Unicode rounded boxes with corners and metadata", () => {
      const task: SugiyamaNode = {
        id: "task-1",
        label: "Implement Renderer",
        status: "running",
        dependencies: ["task-0"],
        writeScope: ["src/reporting"],
        gate: "bun test",
        assignedAgent: "impl-reporting",
        assignedRole: "implementer",
        assignedTool: "write_file",
        attempt: 1,
        effort: 3,
        criticalDepth: 2,
        depReasons: { "task-0": "Architecture schema dependency" },
      };

      const boxLines = renderRoundedNodeBox(task, { detailed: true, boxStyle: "rounded" });
      expect(boxLines.length).toBeGreaterThan(5);
      expect(boxLines[0]!.startsWith("╭")).toBeTrue();
      expect(boxLines[0]!.endsWith("╮")).toBeTrue();
      expect(boxLines[boxLines.length - 1]!.startsWith("╰")).toBeTrue();
      expect(boxLines[boxLines.length - 1]!.endsWith("╯")).toBeTrue();

      const fullBox = boxLines.join("\n");
      expect(fullBox).toContain("🟢 RUNNING");
      expect(fullBox).toContain("task-1");
      expect(fullBox).toContain("Implement Renderer");
      expect(fullBox).toContain("impl-reporting");
      expect(fullBox).toContain("implementer");
      expect(fullBox).toContain("write_file");
      expect(fullBox).toContain("src/reporting");
      expect(fullBox).toContain("bun test");
      expect(fullBox).toContain("Architecture schema dependency");
    });

    it("renders sharp and ascii box styles correctly", () => {
      const task: SugiyamaNode = {
        id: "task-2",
        label: "Sharp Box",
        status: "done",
        dependencies: [],
      };

      const sharpBox = renderRoundedNodeBox(task, { boxStyle: "sharp" });
      expect(sharpBox[0]!.startsWith("┌")).toBeTrue();
      expect(sharpBox[sharpBox.length - 1]!.startsWith("└")).toBeTrue();

      const asciiBox = renderRoundedNodeBox(task, { boxStyle: "ascii" });
      expect(asciiBox[0]!.startsWith("+")).toBeTrue();
      expect(asciiBox[asciiBox.length - 1]!.startsWith("+")).toBeTrue();
    });
  });

  describe("Tarjan Cycle Diagnostics (p25)", () => {
    it("detects self-loop cycles and emits prominent alert", () => {
      const nodes: SugiyamaNode[] = [{ id: "A", label: "A", status: "ready", dependencies: ["A"] }];
      const edges: SugiyamaEdge[] = [{ from: "A", to: "A" }];

      const diag = detectCyclesTarjan(nodes, edges);
      expect(diag.hasCycle).toBeTrue();
      expect(diag.alert).toBe("⚡ [POISONOUS CYCLE] ⚡");
      expect(diag.cycleNodeIds).toContain("A");
      expect(diag.remediation.length).toBeGreaterThan(0);
    });

    it("detects 2-node and multi-node cycles", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "ready", dependencies: ["C"] },
        { id: "B", label: "B", status: "ready", dependencies: ["A"] },
        { id: "C", label: "C", status: "ready", dependencies: ["B"] },
        { id: "D", label: "D", status: "ready", dependencies: [] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "A" },
      ];

      const diag = detectCyclesTarjan(nodes, edges);
      expect(diag.hasCycle).toBeTrue();
      expect(diag.cycleNodeIds).toEqual(expect.arrayContaining(["A", "B", "C"]));
      expect(diag.cycleNodeIds).not.toContain("D");
    });

    it("reports hasCycle: false for acyclic graphs", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "ready", dependencies: [] },
        { id: "B", label: "B", status: "ready", dependencies: ["A"] },
      ];
      const edges: SugiyamaEdge[] = [{ from: "A", to: "B" }];

      const diag = detectCyclesTarjan(nodes, edges);
      expect(diag.hasCycle).toBeFalse();
      expect(diag.alert).toBe("");
    });
  });

  describe("Illegal Bypass Diagnostics (p25)", () => {
    it("detects illegal transitive bypass edges", () => {
      // Direct edge A -> C bypasses intermediate B in A -> B -> C
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "done", dependencies: [] },
        { id: "B", label: "B", status: "running", dependencies: ["A"] },
        { id: "C", label: "C", status: "blocked", dependencies: ["A", "B"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "A", to: "C" },
      ];

      const diag = detectIllegalBypasses(nodes, edges);
      expect(diag.hasBypass).toBeTrue();
      expect(diag.alert).toBe("❌ [ILLEGAL BYPASS]");
      expect(diag.bypasses.length).toBe(1);
      expect(diag.bypasses[0]!.from).toBe("A");
      expect(diag.bypasses[0]!.to).toBe("C");
      expect(diag.bypasses[0]!.intermediatePath).toEqual(["B"]);
    });

    it("returns hasBypass: false when no transitive bypasses exist", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "done", dependencies: [] },
        { id: "B", label: "B", status: "ready", dependencies: ["A"] },
      ];
      const edges: SugiyamaEdge[] = [{ from: "A", to: "B" }];

      const diag = detectIllegalBypasses(nodes, edges);
      expect(diag.hasBypass).toBeFalse();
      expect(diag.alert).toBe("");
    });
  });

  describe("Sugiyama Report Builder & CLI Integration (p24, p26)", () => {
    it("builds a complete SugiyamaDagReport with metrics and markdown", () => {
      const nodes: SugiyamaNode[] = [
        { id: "task-1", label: "Base Engine", status: "done", dependencies: [], effort: 2 },
        {
          id: "task-2",
          label: "Parallel Track 1",
          status: "running",
          dependencies: ["task-1"],
          effort: 3,
        },
        {
          id: "task-3",
          label: "Parallel Track 2",
          status: "ready",
          dependencies: ["task-1"],
          effort: 3,
        },
        {
          id: "task-4",
          label: "Aggregator",
          status: "blocked",
          dependencies: ["task-2", "task-3"],
          effort: 4,
        },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "task-1", to: "task-2" },
        { from: "task-1", to: "task-3" },
        { from: "task-2", to: "task-4" },
        { from: "task-3", to: "task-4" },
      ];

      const report = buildSugiyamaDagReport(nodes, edges, {
        runId: "test-run",
        isCompiled: true,
        graphRevision: 2,
        maxParallel: 4,
      });

      expect(report.totalTasks).toBe(4);
      expect(report.layers.length).toBe(3);
      expect(report.metrics.totalWork).toBe(12);
      expect(report.metrics.maxParallelLanes).toBe(2);
      expect(report.markdown).toContain("Sugiyama Hierarchical DAG Visualization: test-run");
      expect(report.markdown).toContain("WAVE 1");
      expect(report.markdown).toContain("WAVE 2");
      expect(report.markdown).toContain("WAVE 3");
      expect(report.renderedDag).toContain("╭─ WAVE 2 (2 lanes");
      expect(report.renderedDag).toContain("──▶ [PARALLEL LANE]");
    });

    it("renders empty graph gracefully", () => {
      const res = renderSugiyamaDag([], []);
      expect(res.renderedDag).toContain("No tasks declared");
      expect(res.layers.length).toBe(0);
    });
  });
});
