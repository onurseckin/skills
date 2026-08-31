import { describe, expect, it } from "bun:test";
import {
  detectCyclesTarjan,
  extractFeedbackArcSet,
  reverseCycleEdges,
  detectIllegalBypasses,
  validateDiagnosticHealth,
  type SugiyamaEdge,
  type SugiyamaNode,
  type SugiyamaNodeBadge,
  type OrthogonalEdgeSegment,
  type OrthogonalRouteSegment,
} from "../../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

describe("sugiyama-dag-setup (Tarjan Cycles, FAS & Bypass Diagnostics)", () => {
  describe("Tarjan Cycle Detection", () => {
    it("detects simple 2-node cycle (A -> B -> A)", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "ready", dependencies: ["B"] },
        { id: "B", label: "B", status: "ready", dependencies: ["A"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "A" },
      ];

      const diag = detectCyclesTarjan(nodes, edges);
      expect(diag.hasCycle).toBe(true);
      expect(diag.alert).toContain("POISONOUS CYCLE");
      expect(diag.cycleNodeIds).toEqual(expect.arrayContaining(["A", "B"]));
      expect(diag.remediation.length).toBeGreaterThan(0);
      expect(diag.cycleEdges.length).toBeGreaterThanOrEqual(1);
    });

    it("detects 3-node cycle (A -> B -> C -> A)", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "ready", dependencies: ["C"] },
        { id: "B", label: "B", status: "ready", dependencies: ["A"] },
        { id: "C", label: "C", status: "ready", dependencies: ["B"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "A" },
      ];

      const diag = detectCyclesTarjan(nodes, edges);
      expect(diag.hasCycle).toBe(true);
      expect(diag.cycleNodeIds).toHaveLength(3);
      expect(diag.cycleNodeIds).toEqual(expect.arrayContaining(["A", "B", "C"]));
      expect(diag.cyclePaths[0]).toBeDefined();
    });

    it("detects self-loop (A -> A)", () => {
      const nodes: SugiyamaNode[] = [{ id: "A", label: "A", status: "ready", dependencies: ["A"] }];
      const edges: SugiyamaEdge[] = [{ from: "A", to: "A" }];

      const diag = detectCyclesTarjan(nodes, edges);
      expect(diag.hasCycle).toBe(true);
      expect(diag.cycleNodeIds).toEqual(["A"]);
      expect(diag.cycleEdges).toEqual([{ from: "A", to: "A" }]);
      expect(diag.remediation[0]).toContain("Drop self-dependency on task A");
    });

    it("returns clean diagnostic for acyclic graph", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "done", dependencies: [] },
        { id: "B", label: "B", status: "ready", dependencies: ["A"] },
        { id: "C", label: "C", status: "ready", dependencies: ["A"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
      ];

      const diag = detectCyclesTarjan(nodes, edges);
      expect(diag.hasCycle).toBe(false);
      expect(diag.cyclePaths).toHaveLength(0);
      expect(diag.cycleEdges).toHaveLength(0);
      expect(diag.cycleNodeIds).toHaveLength(0);
      expect(diag.remediation).toHaveLength(0);
    });
  });

  describe("Feedback Arc Set (FAS) Extraction", () => {
    it("extracts exact feedback arc for 3-node cycle and leaves acyclic edges", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "ready", dependencies: [] },
        { id: "B", label: "B", status: "ready", dependencies: ["A"] },
        { id: "C", label: "C", status: "ready", dependencies: ["B"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "A" },
      ];

      const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
      expect(feedbackArcs).toHaveLength(1);
      expect(feedbackArcs[0]).toEqual({ from: "C", to: "A" });
      expect(acyclicEdges).toHaveLength(2);
      expect(acyclicEdges).toEqual([
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ]);

      const postDiag = detectCyclesTarjan(nodes, acyclicEdges);
      expect(postDiag.hasCycle).toBe(false);
    });

    it("extracts self-loop feedback arc", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "ready", dependencies: [] },
        { id: "B", label: "B", status: "ready", dependencies: ["A"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "A" },
        { from: "A", to: "B" },
      ];

      const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
      expect(feedbackArcs).toEqual([{ from: "A", to: "A" }]);
      expect(acyclicEdges).toEqual([{ from: "A", to: "B" }]);
    });

    it("returns empty feedback arcs on already acyclic graph", () => {
      const nodes: SugiyamaNode[] = [
        { id: "1", label: "1", status: "done", dependencies: [] },
        { id: "2", label: "2", status: "ready", dependencies: ["1"] },
      ];
      const edges: SugiyamaEdge[] = [{ from: "1", to: "2" }];

      const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
      expect(feedbackArcs).toHaveLength(0);
      expect(acyclicEdges).toEqual(edges);
    });
  });

  describe("Reverse Cycle Edges (DAG Transformation)", () => {
    it("reverses feedback arcs to produce strict DAG", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "ready", dependencies: [] },
        { id: "B", label: "B", status: "ready", dependencies: ["A"] },
        { id: "C", label: "C", status: "ready", dependencies: ["B"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B", type: "dataflow" },
        { from: "B", to: "C", type: "dataflow" },
        { from: "C", to: "A", type: "dataflow", reason: "cycle-back" },
      ];

      const { feedbackArcs } = extractFeedbackArcSet(nodes, edges);
      const reversedEdges = reverseCycleEdges(edges, feedbackArcs);

      expect(reversedEdges).toHaveLength(3);
      expect(reversedEdges.find((e) => e.from === "A" && e.to === "C")).toBeDefined();
      expect(reversedEdges.find((e) => e.reason === "cycle-back")?.from).toBe("A");
      expect(reversedEdges.find((e) => e.reason === "cycle-back")?.to).toBe("C");

      const diag = detectCyclesTarjan(nodes, reversedEdges);
      expect(diag.hasCycle).toBe(false);
    });
  });

  describe("Illegal Bypass Detection", () => {
    it("detects multi-hop transitive bypasses", () => {
      const nodes: SugiyamaNode[] = [
        { id: "A", label: "A", status: "done", dependencies: [] },
        { id: "B", label: "B", status: "done", dependencies: ["A"] },
        { id: "C", label: "C", status: "done", dependencies: ["B"] },
        { id: "D", label: "D", status: "ready", dependencies: ["A", "C"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "D" },
        { from: "A", to: "D" }, // Multi-hop bypass of B -> C
      ];

      const bypassDiag = detectIllegalBypasses(nodes, edges);
      expect(bypassDiag.hasBypass).toBe(true);
      expect(bypassDiag.bypasses).toHaveLength(1);
      expect(bypassDiag.bypasses[0]?.from).toBe("A");
      expect(bypassDiag.bypasses[0]?.to).toBe("D");
      expect(bypassDiag.bypasses[0]?.intermediatePath).toEqual(["B", "C"]);
      expect(bypassDiag.warnings[0]).toContain("bypasses required intermediate stage (B ➔ C)");
    });

    it("returns no bypasses for clean linear pipeline", () => {
      const nodes: SugiyamaNode[] = [
        { id: "1", label: "1", status: "done", dependencies: [] },
        { id: "2", label: "2", status: "done", dependencies: ["1"] },
        { id: "3", label: "3", status: "ready", dependencies: ["2"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "1", to: "2" },
        { from: "2", to: "3" },
      ];

      const bypassDiag = detectIllegalBypasses(nodes, edges);
      expect(bypassDiag.hasBypass).toBe(false);
      expect(bypassDiag.bypasses).toHaveLength(0);
      expect(bypassDiag.warnings).toHaveLength(0);
    });
  });

  describe("Diagnostic Health Validation", () => {
    it("returns healthy=true for clean DAG", () => {
      const nodes: SugiyamaNode[] = [
        { id: "root", label: "root", status: "done", dependencies: [] },
        { id: "leaf", label: "leaf", status: "ready", dependencies: ["root"] },
      ];
      const edges: SugiyamaEdge[] = [{ from: "root", to: "leaf" }];

      const health = validateDiagnosticHealth(nodes, edges);
      expect(health.healthy).toBe(true);
      expect(health.issues).toHaveLength(0);
      expect(health.cycleCount).toBe(0);
      expect(health.bypassCount).toBe(0);
    });

    it("returns healthy=false when cycle is present", () => {
      const nodes: SugiyamaNode[] = [
        { id: "X", label: "X", status: "ready", dependencies: ["Y"] },
        { id: "Y", label: "Y", status: "ready", dependencies: ["X"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "X", to: "Y" },
        { from: "Y", to: "X" },
      ];

      const health = validateDiagnosticHealth(nodes, edges);
      expect(health.healthy).toBe(false);
      expect(health.cycleCount).toBe(1);
      expect(health.issues.some((i) => i.includes("Cycle detected"))).toBe(true);
    });

    it("returns healthy=false when bypass is present", () => {
      const nodes: SugiyamaNode[] = [
        { id: "P1", label: "P1", status: "done", dependencies: [] },
        { id: "P2", label: "P2", status: "done", dependencies: ["P1"] },
        { id: "P3", label: "P3", status: "ready", dependencies: ["P1", "P2"] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "P1", to: "P2" },
        { from: "P2", to: "P3" },
        { from: "P1", to: "P3" },
      ];

      const health = validateDiagnosticHealth(nodes, edges);
      expect(health.healthy).toBe(false);
      expect(health.bypassCount).toBe(1);
      expect(health.issues.some((i) => i.includes("Illegal bypass"))).toBe(true);
    });
  });

  describe("Type Invariants", () => {
    it("instantiates SugiyamaNodeBadge, OrthogonalEdgeSegment, and OrthogonalRouteSegment cleanly", () => {
      const badge: SugiyamaNodeBadge = {
        implementerId: "impl-1",
        validatorId: "val-1",
        role: "implementer",
        effort: 3,
        span: 2,
        status: "running",
      };
      expect(badge.role).toBe("implementer");

      const edgeSegment: OrthogonalEdgeSegment = {
        fromNodeId: "A",
        toNodeId: "B",
        startX: 10,
        startY: 5,
        endX: 10,
        endY: 15,
        waypoints: [{ x: 10, y: 10 }],
        glyphType: "direct_down",
      };
      expect(edgeSegment.glyphType).toBe("direct_down");

      const routeSegment: OrthogonalRouteSegment = {
        fromNodeId: "A",
        toNodeId: "B",
        fromWave: 1,
        toWave: 2,
        fromLane: 1,
        toLane: 1,
      };
      expect(routeSegment.fromWave).toBe(1);
    });
  });
});
