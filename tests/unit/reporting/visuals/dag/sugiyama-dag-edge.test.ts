import { describe, expect, it } from "bun:test";
import {
  barycentricSort,
  countLayerCrossings,
  minimizeCrossingsBarycenter,
  type SugiyamaEdge,
  type SugiyamaLayer,
  type SugiyamaRankedNode,
} from "../../../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

function node(
  id: string,
  rank: number,
  order: number,
  deps: readonly string[] = [],
): SugiyamaRankedNode {
  return { id, label: id, status: "ready", dependencies: deps, rank, order };
}

describe("sugiyama-dag-edge (Barycentric Crossing Minimization)", () => {
  describe("countLayerCrossings", () => {
    it("returns 0 for empty or single-node layers or fewer than 2 edges", () => {
      const u1 = node("u1", 0, 0),
        v1 = node("v1", 1, 0);
      expect(countLayerCrossings([], [], [])).toBe(0);
      expect(countLayerCrossings([u1], [], [{ from: "u1", to: "v1" }])).toBe(0);
      expect(countLayerCrossings([u1], [v1], [{ from: "u1", to: "v1" }])).toBe(0);
      expect(countLayerCrossings([u1], [v1], [])).toBe(0);
    });

    it("verifies non-crossing parallel edges and shared endpoints (fan-in / fan-out)", () => {
      const layerA = [node("u1", 0, 0), node("u2", 0, 1)];
      const layerB = [node("v1", 1, 0), node("v2", 1, 1)];
      expect(
        countLayerCrossings(layerA, layerB, [
          { from: "u1", to: "v1" },
          { from: "u2", to: "v2" },
        ]),
      ).toBe(0);
      expect(
        countLayerCrossings(layerA, layerB, [
          { from: "u1", to: "v1" },
          { from: "u2", to: "v1" },
        ]),
      ).toBe(0);
      expect(
        countLayerCrossings(layerA, layerB, [
          { from: "u1", to: "v1" },
          { from: "u1", to: "v2" },
        ]),
      ).toBe(0);
    });

    it("accurately counts simple X-crossing, 3-edge reversal, and K_2,2", () => {
      const layerA = [node("u1", 0, 0), node("u2", 0, 1), node("u3", 0, 2)];
      const layerB = [node("v1", 1, 0), node("v2", 1, 1), node("v3", 1, 2)];

      // X-crossing: (0, 1) and (1, 0) => 1 crossing
      const xEdges: SugiyamaEdge[] = [
        { from: "u1", to: "v2" },
        { from: "u2", to: "v1" },
      ];
      expect(countLayerCrossings(layerA.slice(0, 2), layerB.slice(0, 2), xEdges)).toBe(1);

      // Reversal: (0, 2), (1, 1), (2, 0) => 3 crossings
      const revEdges: SugiyamaEdge[] = [
        { from: "u1", to: "v3" },
        { from: "u2", to: "v2" },
        { from: "u3", to: "v1" },
      ];
      expect(countLayerCrossings(layerA, layerB, revEdges)).toBe(3);

      // K_{2,2} complete bipartite => 1 crossing
      const k22: SugiyamaEdge[] = [
        { from: "u1", to: "v1" },
        { from: "u1", to: "v2" },
        { from: "u2", to: "v1" },
        { from: "u2", to: "v2" },
      ];
      expect(countLayerCrossings(layerA.slice(0, 2), layerB.slice(0, 2), k22)).toBe(1);
    });

    it("filters out edges belonging to outside layers", () => {
      const layerA = [node("u1", 0, 0), node("u2", 0, 1)];
      const layerB = [node("v1", 1, 0), node("v2", 1, 1)];
      const edges: SugiyamaEdge[] = [
        { from: "out1", to: "out2" },
        { from: "u1", to: "out3" },
        { from: "u1", to: "v2" },
        { from: "u2", to: "v1" },
      ];
      expect(countLayerCrossings(layerA, layerB, edges)).toBe(1);
    });
  });

  describe("barycentricSort", () => {
    it("sorts nodes downwards based on parent centroids", () => {
      const parents = [node("P0", 0, 0), node("P1", 0, 1)];
      const children = [node("C_needs_P1", 1, 0), node("C_needs_P0", 1, 1)];
      const edges: SugiyamaEdge[] = [
        { from: "P1", to: "C_needs_P1" },
        { from: "P0", to: "C_needs_P0" },
      ];

      const sorted = barycentricSort(children, parents, edges, "down");
      expect(sorted.map((n) => n.id)).toEqual(["C_needs_P0", "C_needs_P1"]);
      expect(sorted[0]?.order).toBe(0);
      expect(sorted[1]?.order).toBe(1);
    });

    it("sorts nodes upwards based on child centroids", () => {
      const parents = [node("P0", 0, 0), node("P1", 0, 1)];
      const children = [node("C0", 1, 0), node("C1", 1, 1)];
      const edges: SugiyamaEdge[] = [
        { from: "P0", to: "C1" },
        { from: "P1", to: "C0" },
      ];

      const sorted = barycentricSort(parents, children, edges, "up");
      expect(sorted.map((n) => n.id)).toEqual(["P1", "P0"]);
    });

    it("computes fractional average centroid for multi-connected nodes", () => {
      const ref = [node("R0", 0, 0), node("R1", 0, 1), node("R2", 0, 2)];
      const layer = [node("N_avg_2", 1, 0), node("N_avg_0_5", 1, 1), node("N_avg_1", 1, 2)];
      const edges: SugiyamaEdge[] = [
        { from: "R2", to: "N_avg_2" },
        { from: "R0", to: "N_avg_0_5" },
        { from: "R1", to: "N_avg_0_5" },
        { from: "R0", to: "N_avg_1" },
        { from: "R2", to: "N_avg_1" },
      ];

      const sorted = barycentricSort(layer, ref, edges, "down");
      expect(sorted.map((n) => n.id)).toEqual(["N_avg_0_5", "N_avg_1", "N_avg_2"]);
    });

    it("deterministically preserves ordering when barycenter centroids are tied", () => {
      const ref = [node("R0", 0, 0)];
      const layer = [node("N_A", 1, 0), node("N_B", 1, 1), node("N_C", 1, 2)];
      const edges: SugiyamaEdge[] = [
        { from: "R0", to: "N_A" },
        { from: "R0", to: "N_B" },
        { from: "R0", to: "N_C" },
      ];

      const sorted = barycentricSort(layer, ref, edges, "down");
      expect(sorted.map((n) => n.id)).toEqual(["N_A", "N_B", "N_C"]);
    });

    it("handles disconnected nodes by defaulting centroid to original index", () => {
      const ref = [node("R0", 0, 0), node("R1", 0, 1)];
      const layer = [node("N_Conn_R1", 1, 0), node("N_Disc", 1, 1), node("N_Conn_R0", 1, 2)];
      const edges: SugiyamaEdge[] = [
        { from: "R1", to: "N_Conn_R1" },
        { from: "R0", to: "N_Conn_R0" },
      ];

      const sorted = barycentricSort(layer, ref, edges, "down");
      expect(sorted.map((n) => n.id)).toEqual(["N_Conn_R0", "N_Conn_R1", "N_Disc"]);
    });
  });

  describe("minimizeCrossingsBarycenter", () => {
    it("untangles bipartite X-crossing graph to 0 crossings", () => {
      const layers: SugiyamaLayer[] = [
        { rank: 0, nodes: [node("u1", 0, 0), node("u2", 0, 1)] },
        { rank: 1, nodes: [node("v1", 1, 0), node("v2", 1, 1)] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "u1", to: "v2" },
        { from: "u2", to: "v1" },
      ];

      expect(countLayerCrossings(layers[0]!.nodes, layers[1]!.nodes, edges)).toBe(1);

      const optimized = minimizeCrossingsBarycenter(layers, edges);
      expect(optimized).toHaveLength(2);
      expect(countLayerCrossings(optimized[0]!.nodes, optimized[1]!.nodes, edges)).toBe(0);
      expect(optimized[1]?.nodes.map((n) => n.id)).toEqual(["v2", "v1"]);
      expect(optimized[1]?.nodes[0]?.order).toBe(0);
      expect(optimized[1]?.nodes[1]?.order).toBe(1);
    });

    it("reduces multi-layer crossings across 3+ layers (double X-crossing pipeline)", () => {
      const layers: SugiyamaLayer[] = [
        { rank: 0, nodes: [node("L0_1", 0, 0), node("L0_2", 0, 1)] },
        { rank: 1, nodes: [node("L1_1", 1, 0), node("L1_2", 1, 1)] },
        { rank: 2, nodes: [node("L2_1", 2, 0), node("L2_2", 2, 1)] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "L0_1", to: "L1_2" },
        { from: "L0_2", to: "L1_1" },
        { from: "L1_1", to: "L2_2" },
        { from: "L1_2", to: "L2_1" },
      ];

      const initialCrossings =
        countLayerCrossings(layers[0]!.nodes, layers[1]!.nodes, edges) +
        countLayerCrossings(layers[1]!.nodes, layers[2]!.nodes, edges);
      expect(initialCrossings).toBe(2);

      const optimized = minimizeCrossingsBarycenter(layers, edges);
      expect(optimized).toHaveLength(3);

      const finalCrossings =
        countLayerCrossings(optimized[0]!.nodes, optimized[1]!.nodes, edges) +
        countLayerCrossings(optimized[1]!.nodes, optimized[2]!.nodes, edges);
      expect(finalCrossings).toBe(0);
    });

    it("optimizes a 4-layer complex DAG with alternating sweeps", () => {
      const layers: SugiyamaLayer[] = [
        { rank: 0, nodes: [node("A1", 0, 0), node("A2", 0, 1), node("A3", 0, 2)] },
        { rank: 1, nodes: [node("B1", 1, 0), node("B2", 1, 1), node("B3", 1, 2)] },
        { rank: 2, nodes: [node("C1", 2, 0), node("C2", 2, 1), node("C3", 2, 2)] },
        { rank: 3, nodes: [node("D1", 3, 0), node("D2", 3, 1)] },
      ];
      const edges: SugiyamaEdge[] = [
        { from: "A1", to: "B3" },
        { from: "A2", to: "B2" },
        { from: "A3", to: "B1" },
        { from: "B1", to: "C3" },
        { from: "B2", to: "C2" },
        { from: "B3", to: "C1" },
        { from: "C1", to: "D2" },
        { from: "C2", to: "D1" },
        { from: "C3", to: "D1" },
      ];

      const optimized = minimizeCrossingsBarycenter(layers, edges, 4);
      expect(optimized).toHaveLength(4);

      let totalOptimizedCrossings = 0;
      for (let i = 0; i < optimized.length - 1; i++) {
        totalOptimizedCrossings += countLayerCrossings(
          optimized[i]!.nodes,
          optimized[i + 1]!.nodes,
          edges,
        );
      }
      expect(totalOptimizedCrossings).toBe(0);
    });

    it("handles edge cases: single layer, empty layers, and updates metadata", () => {
      expect(minimizeCrossingsBarycenter([], [])).toEqual([]);

      const singleLayer: SugiyamaLayer[] = [{ rank: 0, nodes: [node("single", 0, 0)] }];
      const resSingle = minimizeCrossingsBarycenter(singleLayer, []);
      expect(resSingle).toHaveLength(1);
      expect(resSingle[0]?.nodes[0]?.wave).toBe(1);
      expect(resSingle[0]?.nodes[0]?.lane).toBe(1);
      expect(resSingle[0]?.nodes[0]?.coordinates).toEqual({ wave: 1, lane: 1, rank: 0, order: 0 });
    });
  });
});
