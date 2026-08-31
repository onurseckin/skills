import { describe, expect, it } from "bun:test";
import {
  assignSugiyamaRanks,
  boundLayerWidthCoffmanGraham,
  computeLexicographicLabels,
  type SugiyamaEdge,
  type SugiyamaNode,
} from "../../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

function createNode(id: string): SugiyamaNode {
  return { id, label: id, status: "ready", dependencies: [] };
}

describe("sugiyama-dag-core (Longest-Path Ranking & Coffman-Graham Width Bounding)", () => {
  describe("Topological Longest-Path Ranking (assignSugiyamaRanks)", () => {
    it("computes longest-path ranks on linear chains", () => {
      const nodes = ["A", "B", "C", "D", "E"].map(createNode);
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "D" },
        { from: "D", to: "E" },
      ];
      const ranks = assignSugiyamaRanks(nodes, edges);
      expect(ranks.get("A")).toBe(0);
      expect(ranks.get("B")).toBe(1);
      expect(ranks.get("C")).toBe(2);
      expect(ranks.get("D")).toBe(3);
      expect(ranks.get("E")).toBe(4);
    });

    it("computes longest-path ranks on branching trees", () => {
      const nodes = ["Root", "B1", "B2", "L1", "L2", "L3"].map(createNode);
      const edges: SugiyamaEdge[] = [
        { from: "Root", to: "B1" },
        { from: "Root", to: "B2" },
        { from: "B1", to: "L1" },
        { from: "B1", to: "L2" },
        { from: "B2", to: "L3" },
      ];
      const ranks = assignSugiyamaRanks(nodes, edges);
      expect(ranks.get("Root")).toBe(0);
      expect(ranks.get("B1")).toBe(1);
      expect(ranks.get("B2")).toBe(1);
      expect(ranks.get("L1")).toBe(2);
      expect(ranks.get("L2")).toBe(2);
      expect(ranks.get("L3")).toBe(2);
    });

    it("computes longest-path ranks on diamond and unbalanced bypass DAGs", () => {
      const diamondNodes = ["A", "B", "C", "D"].map(createNode);
      const diamondEdges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
        { from: "B", to: "D" },
        { from: "C", to: "D" },
      ];
      const dRanks = assignSugiyamaRanks(diamondNodes, diamondEdges);
      expect(dRanks.get("A")).toBe(0);
      expect(dRanks.get("B")).toBe(1);
      expect(dRanks.get("C")).toBe(1);
      expect(dRanks.get("D")).toBe(2);

      const bypassEdges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "D" },
        { from: "A", to: "D" },
      ];
      const bRanks = assignSugiyamaRanks(diamondNodes, bypassEdges);
      expect(bRanks.get("A")).toBe(0);
      expect(bRanks.get("B")).toBe(1);
      expect(bRanks.get("C")).toBe(2);
      expect(bRanks.get("D")).toBe(3);
    });

    it("handles multiple disconnected components and isolated nodes", () => {
      const nodes = ["X", "Y", "Z", "P", "Q", "Iso1", "Iso2"].map(createNode);
      const edges: SugiyamaEdge[] = [
        { from: "X", to: "Y" },
        { from: "Y", to: "Z" },
        { from: "P", to: "Q" },
      ];
      const ranks = assignSugiyamaRanks(nodes, edges);
      expect(ranks.get("X")).toBe(0);
      expect(ranks.get("Y")).toBe(1);
      expect(ranks.get("Z")).toBe(2);
      expect(ranks.get("P")).toBe(0);
      expect(ranks.get("Q")).toBe(1);
      expect(ranks.get("Iso1")).toBe(0);
      expect(ranks.get("Iso2")).toBe(0);
    });

    it("handles cycle back-edges using cycleNodeIds filter", () => {
      const nodes = ["C1", "C2", "C3"].map(createNode);
      const edges: SugiyamaEdge[] = [
        { from: "C1", to: "C2" },
        { from: "C2", to: "C3" },
        { from: "C3", to: "C1" },
      ];
      const ranks = assignSugiyamaRanks(nodes, edges, ["C1", "C2", "C3"]);
      expect(ranks.size).toBe(3);
      for (const id of ["C1", "C2", "C3"]) {
        expect(ranks.get(id)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Lexicographic Labeling (computeLexicographicLabels)", () => {
    it("computes deterministic labels on linear chain and diamond DAGs", () => {
      const chainNodes = ["A", "B", "C"].map(createNode);
      const chainEdges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ];
      const chainLabels = computeLexicographicLabels(chainNodes, chainEdges);
      expect(chainLabels.get("C")).toBe(1);
      expect(chainLabels.get("B")).toBe(2);
      expect(chainLabels.get("A")).toBe(3);

      const diamondNodes = ["A", "B", "C", "D"].map(createNode);
      const diamondEdges: SugiyamaEdge[] = [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
        { from: "B", to: "D" },
        { from: "C", to: "D" },
      ];
      const dLabels = computeLexicographicLabels(diamondNodes, diamondEdges);
      expect(dLabels.get("D")).toBe(1);
      expect(dLabels.get("B")).toBe(2);
      expect(dLabels.get("C")).toBe(3);
      expect(dLabels.get("A")).toBe(4);
    });

    it("guarantees determinism regardless of input node array permutation", () => {
      const nodesForward = ["N1", "N2", "N3", "N4", "N5"].map(createNode);
      const nodesReverse = [...nodesForward].reverse();
      const edges: SugiyamaEdge[] = [
        { from: "N1", to: "N3" },
        { from: "N2", to: "N3" },
        { from: "N3", to: "N4" },
        { from: "N4", to: "N5" },
      ];
      const labels1 = computeLexicographicLabels(nodesForward, edges);
      const labels2 = computeLexicographicLabels(nodesReverse, edges);
      for (const n of nodesForward) {
        expect(labels1.get(n.id)).toBe(labels2.get(n.id));
      }
    });

    it("assigns labels 1..|V| to independent nodes using deterministic tie-breaking", () => {
      const nodes = ["D", "B", "A", "C"].map(createNode);
      const labels = computeLexicographicLabels(nodes, []);
      expect(labels.get("A")).toBe(1);
      expect(labels.get("B")).toBe(2);
      expect(labels.get("C")).toBe(3);
      expect(labels.get("D")).toBe(4);
    });
  });

  describe("Coffman-Graham Width Bounding (boundLayerWidthCoffmanGraham)", () => {
    it("partitions 12 independent nodes with maxWidth=4 into 3 layers of 4 nodes each", () => {
      const nodes = Array.from({ length: 12 }, (_, i) =>
        createNode(`task-${String(i + 1).padStart(2, "0")}`),
      );
      const layerMap = boundLayerWidthCoffmanGraham(nodes, [], 4);
      expect(layerMap.size).toBe(12);

      const layerCounts = new Map<number, number>();
      for (const rank of layerMap.values()) {
        layerCounts.set(rank, (layerCounts.get(rank) ?? 0) + 1);
      }
      expect(layerCounts.size).toBe(3);
      expect(layerCounts.get(0)).toBe(4);
      expect(layerCounts.get(1)).toBe(4);
      expect(layerCounts.get(2)).toBe(4);
    });

    it("partitions 12 independent nodes with maxWidth=3 into 4 layers of 3 nodes each", () => {
      const nodes = Array.from({ length: 12 }, (_, i) =>
        createNode(`task-${String(i + 1).padStart(2, "0")}`),
      );
      const layerMap = boundLayerWidthCoffmanGraham(nodes, [], 3);
      expect(layerMap.size).toBe(12);

      const layerCounts = new Map<number, number>();
      for (const rank of layerMap.values()) {
        layerCounts.set(rank, (layerCounts.get(rank) ?? 0) + 1);
      }
      expect(layerCounts.size).toBe(4);
      expect(layerCounts.get(0)).toBe(3);
      expect(layerCounts.get(1)).toBe(3);
      expect(layerCounts.get(2)).toBe(3);
      expect(layerCounts.get(3)).toBe(3);
    });

    it("strictly enforces parent layers precede child layers under maxWidth constraints", () => {
      const nodes = ["R", "C1", "C2", "C3", "C4", "C5", "G1", "G2"].map(createNode);
      const edges: SugiyamaEdge[] = [
        { from: "R", to: "C1" },
        { from: "R", to: "C2" },
        { from: "R", to: "C3" },
        { from: "R", to: "C4" },
        { from: "R", to: "C5" },
        { from: "C1", to: "G1" },
        { from: "C2", to: "G2" },
      ];
      const maxWidth = 2;
      const layerMap = boundLayerWidthCoffmanGraham(nodes, edges, maxWidth);

      const layerCounts = new Map<number, number>();
      for (const rank of layerMap.values()) {
        layerCounts.set(rank, (layerCounts.get(rank) ?? 0) + 1);
      }
      for (const count of layerCounts.values()) {
        expect(count).toBeLessThanOrEqual(maxWidth);
      }

      for (const e of edges) {
        const uRank = layerMap.get(e.from);
        const vRank = layerMap.get(e.to);
        expect(uRank).toBeDefined();
        expect(vRank).toBeDefined();
        expect(vRank!).toBeGreaterThan(uRank!);
      }
    });

    it("applies width bounding via assignSugiyamaRanks when maxWidth is supplied", () => {
      const nodes = Array.from({ length: 6 }, (_, i) => createNode(`t-${i + 1}`));
      const ranksWithBound = assignSugiyamaRanks(nodes, [], [], 2);
      const ranksWithoutBound = assignSugiyamaRanks(nodes, [], []);

      for (const n of nodes) {
        expect(ranksWithoutBound.get(n.id)).toBe(0);
      }

      const layerCounts = new Map<number, number>();
      for (const rank of ranksWithBound.values()) {
        layerCounts.set(rank, (layerCounts.get(rank) ?? 0) + 1);
      }
      expect(layerCounts.size).toBe(3);
      expect(layerCounts.get(0)).toBe(2);
      expect(layerCounts.get(1)).toBe(2);
      expect(layerCounts.get(2)).toBe(2);
    });
  });

  describe("Edge Cases and Invariants", () => {
    it("handles empty node and edge sets cleanly", () => {
      expect(computeLexicographicLabels([], []).size).toBe(0);
      expect(boundLayerWidthCoffmanGraham([], []).size).toBe(0);
      expect(assignSugiyamaRanks([], [])).toEqual(new Map());
    });

    it("handles single-node graphs and self-loops", () => {
      const singleNode = [createNode("lone")];
      expect(computeLexicographicLabels(singleNode, []).get("lone")).toBe(1);
      expect(boundLayerWidthCoffmanGraham(singleNode, []).get("lone")).toBe(0);
      expect(assignSugiyamaRanks(singleNode, []).get("lone")).toBe(0);

      const loopEdges: SugiyamaEdge[] = [{ from: "lone", to: "lone" }];
      expect(computeLexicographicLabels(singleNode, loopEdges).get("lone")).toBe(1);
      expect(boundLayerWidthCoffmanGraham(singleNode, loopEdges).get("lone")).toBe(0);
      expect(assignSugiyamaRanks(singleNode, loopEdges).get("lone")).toBe(0);
    });

    it("safely handles maxWidth <= 0 by clamping to minimum width 1", () => {
      const nodes = [createNode("N1"), createNode("N2")];
      const layerMap = boundLayerWidthCoffmanGraham(nodes, [], 0);
      expect(layerMap.get("N1")).toBeDefined();
      expect(layerMap.get("N2")).toBeDefined();
      expect(layerMap.get("N1")).not.toBe(layerMap.get("N2"));
    });
  });
});
