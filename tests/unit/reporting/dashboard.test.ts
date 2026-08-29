import { describe, expect, it } from "bun:test";
import {
  AsciiCanvasMatrix,
  assignSugiyamaLayers,
  computeBarycenter,
  computeLayerCrossings,
  layoutSugiyamaDag,
  minimizeCrossings,
  type SugiyamaEdge,
  type SugiyamaRankedNode,
} from "../../../olt/scripts/src/graph/sugiyama.ts";
import {
  calculateDashboardMetrics,
  generateDashboardReport,
  renderAgentMatrixSection,
  renderDashboardAscii,
  renderDashboardHeader,
  renderMicroCycleTelemetry,
  renderTaskSummaryTable,
  type DashboardAgentState,
  type DashboardTaskState,
} from "../../../olt/scripts/src/reporting/dashboard.ts";

describe("Unified Master Reporting Dashboard & Sugiyama DAG Suite", () => {
  describe("Sugiyama Visual DAG Engine (graph/sugiyama.ts)", () => {
    it("AsciiCanvasMatrix draws boxes and orthogonal edges correctly", () => {
      const canvas = new AsciiCanvasMatrix(40, 10);
      canvas.drawBox(0, 0, 15, 5, "TASK-1", ["Status: OK", "Role: IMPL"]);
      canvas.drawBox(20, 0, 15, 5, "TASK-2", ["Status: PEND"]);
      canvas.drawHorizontalEdge(15, 20, 2);

      const rendered = canvas.renderToString();
      expect(rendered).toContain("TASK-1");
      expect(rendered).toContain("TASK-2");
      expect(rendered).toContain("Status: OK");
      expect(rendered).toContain("►");
      expect(canvas.width).toBe(40);
      expect(canvas.height).toBe(10);
    });

    it("AsciiCanvasMatrix draws vertical edges with crossing intersection", () => {
      const canvas = new AsciiCanvasMatrix(20, 10);
      canvas.drawHorizontalEdge(0, 10, 3);
      canvas.drawVerticalEdge(5, 0, 6);
      const rendered = canvas.renderToString();
      expect(rendered).toContain("┼");
      expect(rendered).toContain("▼");
    });

    it("assignSugiyamaLayers assigns longest-path ranks and clamps width", () => {
      const nodes = [
        { id: "A", dependencies: [] },
        { id: "B", dependencies: ["A"] },
        { id: "C", dependencies: ["A"] },
        { id: "D", dependencies: ["B", "C"] },
      ];
      const ranks = assignSugiyamaLayers(nodes, 2);
      expect(ranks.get("A")).toBe(0);
      expect(ranks.get("B")).toBe(1);
      expect(ranks.get("C")).toBe(1);
      expect(ranks.get("D")).toBe(2);
    });

    it("computeBarycenter calculates mean horizontal position for predecessors and successors", () => {
      const neighborPosMap = new Map<string, number>([
        ["A", 0],
        ["B", 2],
        ["C", 4],
      ]);
      const adjacency = new Map<string, string[]>([
        ["A", ["D"]],
        ["B", ["D"]],
        ["C", ["E"]],
      ]);
      const baryD = computeBarycenter("D", neighborPosMap, adjacency, true);
      expect(baryD).toBe(1);
      const baryA = computeBarycenter("A", new Map([["D", 3]]), adjacency, false);
      expect(baryA).toBe(3);
      const baryEmpty = computeBarycenter("Z", neighborPosMap, adjacency, true);
      expect(baryEmpty).toBe(0);
    });

    it("minimizeCrossings orders layers to minimize intersections", () => {
      const layer0: SugiyamaRankedNode[] = [
        { id: "A", label: "A", rank: 0, order: 0, isDummy: false, dependencies: [] },
        { id: "B", label: "B", rank: 0, order: 1, isDummy: false, dependencies: [] },
      ];
      const layer1: SugiyamaRankedNode[] = [
        { id: "C", label: "C", rank: 1, order: 0, isDummy: false, dependencies: ["B"] },
        { id: "D", label: "D", rank: 1, order: 1, isDummy: false, dependencies: ["A"] },
      ];
      const adjacency = new Map<string, string[]>([
        ["A", ["D"]],
        ["B", ["C"]],
      ]);
      const optimized = minimizeCrossings([layer0, layer1], adjacency);
      expect(optimized.length).toBe(2);
      expect(optimized[1]?.[0]?.id).toBe("D");
      expect(optimized[1]?.[1]?.id).toBe("C");
    });

    it("computeLayerCrossings computes crossing count accurately", () => {
      const l1: SugiyamaRankedNode[] = [
        { id: "A", label: "A", rank: 0, order: 0, isDummy: false, dependencies: [] },
        { id: "B", label: "B", rank: 0, order: 1, isDummy: false, dependencies: [] },
      ];
      const l2: SugiyamaRankedNode[] = [
        { id: "C", label: "C", rank: 1, order: 0, isDummy: false, dependencies: ["B"] },
        { id: "D", label: "D", rank: 1, order: 1, isDummy: false, dependencies: ["A"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "D" },
        { from: "B", to: "C" },
      ];
      const crossings = computeLayerCrossings(l1, l2, edges);
      expect(crossings).toBe(1);
    });

    it("layoutSugiyamaDag produces complete report for empty and populated graphs", () => {
      const emptyReport = layoutSugiyamaDag([], []);
      expect(emptyReport.totalNodes).toBe(0);
      expect(emptyReport.asciiDiagram).toBe("(Empty DAG)");

      const nodes: SugiyamaRankedNode[] = [
        {
          id: "T1",
          label: "Task 1",
          rank: 0,
          order: 0,
          isDummy: false,
          dependencies: [],
          badges: { role: "implementer", effortMinutes: 5, spanMinutes: 5, status: "COMPLETED" },
        },
        {
          id: "T2",
          label: "Task 2",
          rank: 0,
          order: 1,
          isDummy: false,
          dependencies: ["T1"],
          badges: { role: "validator", effortMinutes: 3, spanMinutes: 3, status: "RUNNING", implementerId: "impl-1" },
        },
      ];
      const edges: SugiyamaEdge[] = [{ from: "T1", to: "T2" }];
      const report = layoutSugiyamaDag(nodes, edges);
      expect(report.totalNodes).toBe(2);
      expect(report.totalLayers).toBe(2);
      expect(report.criticalPathSpan).toBe(8);
      expect(report.asciiDiagram).toContain("T1");
      expect(report.asciiDiagram).toContain("T2");
    });
  });

  describe("Unified Master Reporting Dashboard (reporting/dashboard.ts)", () => {
    const mockTasks: DashboardTaskState[] = [
      {
        id: "task-1",
        label: "Auth Schema",
        status: "done",
        effort: 4,
        writeScope: ["src/auth/schema.ts"],
        dependencies: [],
        implementerId: "agent-impl-1",
        pushes: 1,
        maxPushes: 3,
        probes: 2,
        repairRound: 0,
      },
      {
        id: "task-2",
        label: "Auth Endpoints",
        status: "running",
        effort: 6,
        writeScope: ["src/auth/routes.ts"],
        dependencies: ["task-1"],
        implementerId: "agent-impl-2",
        validatorId: "agent-val-1",
        pushes: 2,
        maxPushes: 3,
        probes: 1,
        repairRound: 1,
      },
      {
        id: "task-3",
        label: "Security Audit",
        status: "ready",
        effort: 3,
        writeScope: ["src/auth/audit.ts"],
        dependencies: ["task-2"],
      },
    ];

    const mockAgents: DashboardAgentState[] = [
      { id: "agent-impl-1", role: "implementer", tier: 3, status: "idle" },
      { id: "agent-impl-2", role: "implementer", tier: 3, status: "active", assignedTask: "task-2" },
      { id: "agent-val-1", role: "validator", tier: 2, status: "active", assignedTask: "task-2" },
    ];

    it("calculateDashboardMetrics computes task, agent, and telemetry aggregates", () => {
      const dagReport = layoutSugiyamaDag([], []);
      const metrics = calculateDashboardMetrics(mockTasks, mockAgents, dagReport);
      expect(metrics.totalTasks).toBe(3);
      expect(metrics.satisfiedTasks).toBe(1);
      expect(metrics.activeTasks).toBe(1);
      expect(metrics.standbyTasks).toBe(1);
      expect(metrics.totalWork).toBe(13);
      expect(metrics.activeAgents).toBe(2);
      expect(metrics.totalPushes).toBe(3);
      expect(metrics.totalProbes).toBe(3);
    });

    it("renderMicroCycleTelemetry formats adversarial probes and pushback metrics", () => {
      const emptyLines = renderMicroCycleTelemetry([]);
      expect(emptyLines.some((l) => l.includes("No active micro-cycles"))).toBe(true);

      const activeLines = renderMicroCycleTelemetry(mockTasks);
      const text = activeLines.join("\n");
      expect(text).toContain("task-1");
      expect(text).toContain("task-2");
      expect(text).toContain("Pushes: 2/3");
      expect(text).toContain("Probes: 1");
      expect(text).toContain("Repair: R1");
    });

    it("renderTaskSummaryTable formats topology with scopes and dependencies", () => {
      const tableLines = renderTaskSummaryTable(mockTasks);
      const text = tableLines.join("\n");
      expect(text).toContain("task-1");
      expect(text).toContain("DONE");
      expect(text).toContain("src/auth/schema.ts");
      expect(text).toContain("task-2");
      expect(text).toContain("RUNNING");
    });

    it("renderAgentMatrixSection displays agent roles, tiers, and assignments", () => {
      const agentLines = renderAgentMatrixSection(mockAgents);
      const text = agentLines.join("\n");
      expect(text).toContain("agent-impl-2");
      expect(text).toContain("IMPLEMENTER");
      expect(text).toContain("T3");
      expect(text).toContain("ACTIVE");
      expect(text).toContain("task-2");
    });

    it("renderDashboardHeader renders banner with phase and summary metrics", () => {
      const metrics = {
        totalTasks: 3,
        satisfiedTasks: 1,
        activeTasks: 1,
        standbyTasks: 1,
        totalWork: 13,
        criticalPathSpan: 10,
        totalLayers: 3,
        totalCrossings: 0,
        activeAgents: 2,
        totalPushes: 3,
        totalProbes: 3,
      };
      const header = renderDashboardHeader("run-live-101", "Executing", metrics);
      const text = header.join("\n");
      expect(text).toContain("UNIFIED MASTER REPORTING DASHBOARD: run-live-101");
      expect(text).toContain("Phase: Executing");
      expect(text).toContain("Active Agents: 2");
    });

    it("generateDashboardReport and renderDashboardAscii assemble full dashboard view", () => {
      const report = generateDashboardReport("run-test-flow", "Executing", mockTasks, mockAgents, {
        detailed: true,
      });
      expect(report.runId).toBe("run-test-flow");
      expect(report.phase).toBe("Executing");
      expect(report.metrics.totalTasks).toBe(3);
      expect(report.dagReport.totalNodes).toBe(3);
      expect(report.dagReport.totalLayers).toBe(3);

      const ascii = renderDashboardAscii(report);
      expect(ascii).toContain("UNIFIED MASTER REPORTING DASHBOARD: run-test-flow");
      expect(ascii).toContain("SUGIYAMA VISUAL DEPENDENCY GRAPH");
      expect(ascii).toContain("TASK TOPOLOGY");
      expect(ascii).toContain("MICRO-CYCLE TELEMETRY");
      expect(ascii).toContain("AGENT MATRIX");
      expect(ascii).toContain("task-1");
      expect(ascii).toContain("task-2");
      expect(ascii).toContain("task-3");
    });
  });
});
