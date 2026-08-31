import { describe, expect, it } from "bun:test";
import {
  assignSugiyamaRanks,
  minimizeCrossingsBarycenter,
  buildOrthogonalRouteSegments,
  renderInterWaveConnector,
  renderLaneSeparator,
  detectCyclesTarjan,
  detectIllegalBypasses,
  validateDiagnosticHealth,
  formatSubagentAllocation,
  formatCoordinates,
  formatImplementerValidatorTracking,
  renderRoundedNodeBox,
  renderSugiyamaDag,
  buildSugiyamaDagReport,
  type SugiyamaEdge,
  type SugiyamaNode,
} from "../../../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

describe("sugiyama-canonical-tracking", () => {
  describe("Layered Ranking", () => {
    it("computes longest-path topological ranks for diamond DAG", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "passed", dependencies: [] },
        { id: "B", label: "B", status: "passed", dependencies: ["A"] },
        { id: "C", label: "C", status: "passed", dependencies: ["A"] },
        { id: "D", label: "D", status: "ready", dependencies: ["B", "C"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
        { from: "B", to: "D" },
        { from: "C", to: "D" },
      ];

      const ranks = assignSugiyamaRanks(nodes, edges);
      expect(ranks.get("A")).toBe(0);
      expect(ranks.get("B")).toBe(1);
      expect(ranks.get("C")).toBe(1);
      expect(ranks.get("D")).toBe(2);
    });

    it("handles disconnected nodes and multi-tier longest paths", () => {
      const nodes: SugiyamaNode[] = [
        { id: "X", label: "X", status: "ready", dependencies: [] },
        { id: "Y", label: "Y", status: "ready", dependencies: ["X"] },
        { id: "Z", label: "Z", status: "ready", dependencies: ["Y"] },
        { id: "Isolated", label: "Isolated", status: "ready", dependencies: [] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "X", to: "Y" },
        { from: "Y", to: "Z" },
      ];

      const ranks = assignSugiyamaRanks(nodes, edges);
      expect(ranks.get("X")).toBe(0);
      expect(ranks.get("Y")).toBe(1);
      expect(ranks.get("Z")).toBe(2);
      expect(ranks.get("Isolated")).toBe(0);
    });
  });

  describe("Barycenter Crossing Minimization", () => {
    it("reorders nodes in adjacent layers to minimize crossings", () => {
      const layers = [
        {
          rank: 0,
          nodes: [
            { id: "L0_1", label: "1", status: "done", dependencies: [], rank: 0, order: 0 },
            { id: "L0_2", label: "2", status: "done", dependencies: [], rank: 0, order: 1 },
          ],
        },
        {
          rank: 1,
          nodes: [
            { id: "L1_1", label: "A", status: "ready", dependencies: ["L0_2"], rank: 1, order: 0 },
            { id: "L1_2", label: "B", status: "ready", dependencies: ["L0_1"], rank: 1, order: 1 },
          ],
        },
      ];
      // Crossing edges: L0_1 -> L1_2, L0_2 -> L1_1
      const edges: SugiyamaEdge[] = [
        { from: "L0_1", to: "L1_2" },
        { from: "L0_2", to: "L1_1" },
      ];

      const optimized = minimizeCrossingsBarycenter(layers, edges);
      expect(optimized).toHaveLength(2);
      expect(optimized[1]?.nodes[0]?.id).toBe("L1_2");
      expect(optimized[1]?.nodes[1]?.id).toBe("L1_1");
    });
  });

  describe("Orthogonal Grid Routing", () => {
    it("builds orthogonal route segments between ranked nodes", () => {
      const nodeMap = new Map([
        ["A", { id: "A", label: "A", status: "done", dependencies: [], rank: 0, order: 0 }],
        ["B", { id: "B", label: "B", status: "ready", dependencies: ["A"], rank: 1, order: 0 }],
      ]);
      const edges: SugiyamaEdge[] = [{ from: "A", to: "B" }];

      const segments = buildOrthogonalRouteSegments(edges, nodeMap);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({
        fromNodeId: "A",
        toNodeId: "B",
        fromWave: 1,
        toWave: 2,
        fromLane: 1,
        toLane: 1,
      });
    });

    it("renders inter-wave connectors and lane separators", () => {
      const layer0 = {
        rank: 0,
        nodes: [{ id: "A", label: "A", status: "done", dependencies: [], rank: 0, order: 0 }],
      };
      const layer1 = {
        rank: 1,
        nodes: [{ id: "B", label: "B", status: "ready", dependencies: ["A"], rank: 1, order: 0 }],
      };
      const edges: SugiyamaEdge[] = [{ from: "A", to: "B" }];

      const connector = renderInterWaveConnector(layer0, layer1, edges);
      expect(connector.length).toBeGreaterThan(0);
      expect(connector.some((line) => line.includes("▼") || line.includes("│"))).toBe(true);

      const laneSep = renderLaneSeparator();
      expect(laneSep.some((line) => line.includes("[PARALLEL LANE]"))).toBe(true);
    });
  });

  describe("Tarjan Cycle Detection & Bypass Diagnostics", () => {
    it("detects multi-node cycles and produces remediation", () => {
      const nodes: SugiyamaNode[] = [
        { id: "C1", label: "C1", status: "ready", dependencies: ["C3"] },
        { id: "C2", label: "C2", status: "ready", dependencies: ["C1"] },
        { id: "C3", label: "C3", status: "ready", dependencies: ["C2"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "C1", to: "C2" },
        { from: "C2", to: "C3" },
        { from: "C3", to: "C1" },
      ];

      const diag = detectCyclesTarjan(nodes, edges);
      expect(diag.hasCycle).toBe(true);
      expect(diag.alert).toContain("POISONOUS CYCLE");
      expect(diag.cycleNodeIds.length).toBe(3);
      expect(diag.remediation.length).toBeGreaterThan(0);
    });

    it("detects illegal transitive bypasses", () => {
      const nodes: SugiyamaNode[] = [
        { id: "S", label: "S", status: "done", dependencies: [] },
        { id: "M", label: "M", status: "done", dependencies: ["S"] },
        { id: "E", label: "E", status: "ready", dependencies: ["S", "M"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "S", to: "M" },
        { from: "M", to: "E" },
        { from: "S", to: "E" }, // Direct bypass of M
      ];

      const bypassDiag = detectIllegalBypasses(nodes, edges);
      expect(bypassDiag.hasBypass).toBe(true);
      expect(bypassDiag.bypasses.length).toBe(1);
      expect(bypassDiag.bypasses[0]?.from).toBe("S");
      expect(bypassDiag.bypasses[0]?.to).toBe("E");
      expect(bypassDiag.bypasses[0]?.intermediatePath).toEqual(["M"]);
    });

    it("validates diagnostic health for clean graph", () => {
      const nodes: SugiyamaNode[] = [
        { id: "1", label: "1", status: "done", dependencies: [] },
        { id: "2", label: "2", status: "ready", dependencies: ["1"] },
      ];
      const edges: SugiyamaEdge[] = [{ from: "1", to: "2" }];

      const health = validateDiagnosticHealth(nodes, edges);
      expect(health.healthy).toBe(true);
      expect(health.issues).toHaveLength(0);
    });
  });

  describe("Implementer-Validator Metrics & Subagent Expansion", () => {
    it("formats subagent allocation pairs and coordinates correctly", () => {
      const alloc = formatSubagentAllocation("impl-1", "val-1", "IMPLEMENTER");
      expect(alloc).toBe("[● IMPLEMENTER: impl-1 ──► VALIDATOR: val-1]");

      const coords = formatCoordinates({ wave: 2, lane: 3 });
      expect(coords).toBe("[W2:L3]");
    });

    it("formats implementer-validator tracking metrics", () => {
      const task: SugiyamaNode = {
        id: "T1",
        label: "Task 1",
        status: "active",
        dependencies: [],
        pushes: 2,
        probes: 3,
        attempt: 1,
        inLeaseRepairs: 0,
        coordinatorId: "coord-alpha",
        coordinatorOwnershipPct: 100,
        activeLeaseTimerSeconds: 90,
      };

      const tracking = formatImplementerValidatorTracking(task);
      expect(tracking).toHaveLength(2);
      expect(tracking[0]).toBe(
        "Tracking: Pushes: 2/5 | Probes: 3/5 | Attempts: 1/3 | In-Lease Repairs: 0/3",
      );
      expect(tracking[1]).toBe("Coordinator: coord-alpha (100%) | Active Lease Timer: 90s");
    });

    it("renders rounded node boxes containing implementer-validator metrics and subtasks", () => {
      const task: SugiyamaNode = {
        id: "task-lane-1",
        label: "Feature Engine",
        status: "leased",
        dependencies: [],
        assignedAgent: "impl-bob",
        validatorId: "val-alice",
        pushes: 1,
        probes: 2,
        attempt: 1,
        inLeaseRepairs: 0,
        coordinatorId: "supervisor-1",
        coordinatorOwnershipPct: 100,
        activeLeaseTimerSeconds: 120,
        expandedSubtasks: [
          {
            id: "sub-1",
            label: "Sub 1",
            status: "done",
            role: "worker",
            assignedAgent: "impl-bob",
          },
          {
            id: "sub-2",
            label: "Sub 2",
            status: "ready",
            role: "validator",
            validatorId: "val-alice",
          },
        ],
      };

      const boxLines = renderRoundedNodeBox(task);
      const renderedBox = boxLines.join("\n");
      expect(renderedBox).toContain("Feature Engine");
      expect(renderedBox).toContain(
        "Tracking: Pushes: 1/5 | Probes: 2/5 | Attempts: 1/3 | In-Lease Repairs: 0/3",
      );
      expect(renderedBox).toContain("Coordinator: supervisor-1 (100%) | Active Lease Timer: 120s");
      expect(renderedBox).toContain("[sub-1]");
      expect(renderedBox).toContain("[sub-2]");
    });

    it("builds full Sugiyama DAG report", () => {
      const nodes: SugiyamaNode[] = [
        {
          id: "task-1",
          label: "Core Service",
          status: "passed",
          dependencies: [],
          pushes: 1,
          probes: 1,
        },
        {
          id: "task-2",
          label: "API Gateway",
          status: "active",
          dependencies: ["task-1"],
          pushes: 2,
          probes: 1,
        },
      ];
      const edges: SugiyamaEdge[] = [{ from: "task-1", to: "task-2" }];

      const report = buildSugiyamaDagReport(nodes, edges, { runId: "test-run-1" });
      expect(report.totalTasks).toBe(2);
      expect(report.layers).toHaveLength(2);
      expect(report.metrics.totalWaves).toBe(2);
      expect(report.markdown).toContain("Sugiyama Hierarchical DAG Visualization: test-run-1");
      expect(report.renderedDag).toContain("WAVE 1");
      expect(report.renderedDag).toContain("WAVE 2");
    });
  });
});
