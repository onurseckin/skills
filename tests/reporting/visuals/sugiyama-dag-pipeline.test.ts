import { describe, expect, it } from "bun:test";
import {
  assignSugiyamaRanks,
  barycentricSort,
  boundLayerWidthCoffmanGraham,
  computeLexicographicLabels,
  countLayerCrossings,
  detectCyclesTarjan,
  detectIllegalBypasses,
  extractFeedbackArcSet,
  minimizeCrossingsBarycenter,
  reverseCycleEdges,
  validateDiagnosticHealth,
  type SugiyamaEdge,
  type SugiyamaLayer,
  type SugiyamaNode,
  type SugiyamaRankedNode,
} from "../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

export const sugiyamaDagPipelineSuiteName = "Sugiyama Visual DAG Pipeline (Cycles, Ranks, Crossing Minimization)";

function createNode(id: string, deps: readonly string[] = [], status = "ready"): SugiyamaNode {
  return { id, label: `Task ${id}`, status, dependencies: deps };
}

describe(sugiyamaDagPipelineSuiteName, () => {
  describe("Tarjan Cycle Detection and Feedback Arc Inversion", () => {
    it("detects 2-node cycle and formats poisonous cycle alert", () => {
      const nodes = [createNode("A"), createNode("B")];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "A" },
      ];
      const diag = detectCyclesTarjan(nodes, edges);
      expect(diag.hasCycle).toBe(true);
      expect(diag.cyclePaths.length).toBeGreaterThan(0);
      expect(diag.alert).toContain("POISONOUS CYCLE");
      expect(diag.remediation.length).toBeGreaterThan(0);
    });

    it("extracts feedback arcs and reverses back-edges to form a DAG", () => {
      const nodes = [createNode("A"), createNode("B"), createNode("C")];
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "A" },
      ];
      const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
      expect(feedbackArcs.length).toBe(1);
      expect(acyclicEdges.length).toBe(2);

      const reversed = reverseCycleEdges(edges, feedbackArcs);
      expect(reversed.length).toBe(3);
      const newDiag = detectCyclesTarjan(nodes, acyclicEdges);
      expect(newDiag.hasCycle).toBe(false);
    });

    it("handles self-loop cycles gracefully", () => {
      const nodes = [createNode("SelfLoop")];
      const edges: SugiyamaEdge[] = [{ from: "SelfLoop", to: "SelfLoop" }];
      const diag = detectCyclesTarjan(nodes, edges);
      expect(diag.hasCycle).toBe(true);
      expect(diag.cyclePaths[0]).toEqual(["SelfLoop", "SelfLoop"]);
    });

    it("detects illegal transitive bypass edges", () => {
      const nodes = [createNode("Stage1"), createNode("Stage2"), createNode("Stage3")];
      const edges: SugiyamaEdge[] = [
        { from: "Stage1", to: "Stage2" },
        { from: "Stage2", to: "Stage3" },
        { from: "Stage1", to: "Stage3" },
      ];
      const bypassDiag = detectIllegalBypasses(nodes, edges);
      expect(bypassDiag.hasBypass).toBe(true);
      expect(bypassDiag.bypasses.length).toBe(1);
      expect(bypassDiag.bypasses[0]?.intermediatePath).toEqual(["Stage2"]);
    });

    it("validates diagnostic health for clean graph", () => {
      const nodes = [createNode("Task1"), createNode("Task2", ["Task1"])];
      const edges: SugiyamaEdge[] = [{ from: "Task1", to: "Task2" }];
      const health = validateDiagnosticHealth(nodes, edges);
      expect(health.healthy).toBe(true);
      expect(health.cycleCount).toBe(0);
      expect(health.bypassCount).toBe(0);
    });
  });

  describe("Longest-Path Ranking and Coffman-Graham Width Bounding", () => {
    it("computes longest-path topological ranks for diamond DAG", () => {
      const nodes = [
        createNode("Start"),
        createNode("Branch1", ["Start"]),
        createNode("Branch2", ["Start"]),
        createNode("Join", ["Branch1", "Branch2"]),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "Start", to: "Branch1" },
        { from: "Start", to: "Branch2" },
        { from: "Branch1", to: "Join" },
        { from: "Branch2", to: "Join" },
      ];
      const ranks = assignSugiyamaRanks(nodes, edges);
      expect(ranks.get("Start")).toBe(0);
      expect(ranks.get("Branch1")).toBe(1);
      expect(ranks.get("Branch2")).toBe(1);
      expect(ranks.get("Join")).toBe(2);
    });

    it("computes deterministic lexicographic labels for Coffman-Graham scheduling", () => {
      const nodes = [createNode("X1"), createNode("X2", ["X1"]), createNode("X3", ["X1"])];
      const edges: SugiyamaEdge[] = [
        { from: "X1", to: "X2" },
        { from: "X1", to: "X3" },
      ];
      const labels = computeLexicographicLabels(nodes, edges);
      expect(labels.size).toBe(3);
      expect(labels.get("X1")).toBeDefined();
      expect(labels.get("X2")).toBeDefined();
      expect(labels.get("X3")).toBeDefined();
    });

    it("enforces maxWidth limit with Coffman-Graham width bounding", () => {
      const nodes = Array.from({ length: 9 }, (_, i) => createNode(`N_${i + 1}`));
      const bounded = boundLayerWidthCoffmanGraham(nodes, [], 3);
      const layerCounts = new Map<number, number>();
      for (const rank of bounded.values()) {
        layerCounts.set(rank, (layerCounts.get(rank) ?? 0) + 1);
      }
      for (const count of layerCounts.values()) {
        expect(count).toBeLessThanOrEqual(3);
      }
      expect(layerCounts.size).toBe(3);
    });
  });

  describe("Barycenter Crossing Minimization", () => {
    it("counts crossings correctly", () => {
      const layerA: SugiyamaRankedNode[] = [
        { ...createNode("A1"), rank: 0, order: 0 },
        { ...createNode("A2"), rank: 0, order: 1 },
      ];
      const layerB: SugiyamaRankedNode[] = [
        { ...createNode("B1"), rank: 1, order: 0 },
        { ...createNode("B2"), rank: 1, order: 1 },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A1", to: "B2" },
        { from: "A2", to: "B1" },
      ];
      expect(countLayerCrossings(layerA, layerB, edges)).toBe(1);
    });

    it("sorts layer nodes using barycentric heuristic", () => {
      const refLayer: SugiyamaRankedNode[] = [
        { ...createNode("P1"), rank: 0, order: 0 },
        { ...createNode("P2"), rank: 0, order: 1 },
      ];
      const targetLayer: SugiyamaRankedNode[] = [
        { ...createNode("C1"), rank: 1, order: 0 },
        { ...createNode("C2"), rank: 1, order: 1 },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "P1", to: "C2" },
        { from: "P2", to: "C1" },
      ];
      const sorted = barycentricSort(targetLayer, refLayer, edges, "down");
      expect(sorted[0]?.id).toBe("C2");
      expect(sorted[1]?.id).toBe("C1");
    });

    it("minimizes total crossings across multiple layers with 4-pass barycenter sweep", () => {
      const layers: SugiyamaLayer[] = [
        {
          rank: 0,
          nodes: [
            { ...createNode("U1"), rank: 0, order: 0 },
            { ...createNode("U2"), rank: 0, order: 1 },
          ],
        },
        {
          rank: 1,
          nodes: [
            { ...createNode("V1"), rank: 1, order: 0 },
            { ...createNode("V2"), rank: 1, order: 1 },
          ],
        },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "U1", to: "V2" },
        { from: "U2", to: "V1" },
      ];
      const optimized = minimizeCrossingsBarycenter(layers, edges, 4);
      expect(optimized.length).toBe(2);
      expect(countLayerCrossings(optimized[0]!.nodes, optimized[1]!.nodes, edges)).toBe(0);
    });
  });
});
