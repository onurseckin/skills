import { describe, expect, it } from "bun:test";
import {
  assignSugiyamaRanks,
  boundLayerWidthCoffmanGraham,
  computeLexicographicLabels,
} from "../../olt/scripts/src/reporting/sugiyama-dag/ranking.ts";
import type {
  SugiyamaEdge,
  SugiyamaNode,
} from "../../olt/scripts/src/reporting/sugiyama-dag/types.ts";

function createNode(id: string, dependencies: readonly string[] = []): SugiyamaNode {
  return {
    id,
    label: `Node ${id}`,
    status: "ready",
    dependencies,
  };
}

describe("sugiyama-dag ranking coverage", () => {
  describe("computeLexicographicLabels", () => {
    it("returns empty map when nodes array is empty", () => {
      const res = computeLexicographicLabels([], [{ from: "a", to: "b" }]);
      expect(res.size).toBe(0);
    });

    it("assigns labels to single node and skips self-loops or unknown edges", () => {
      const nodes = [createNode("n1")];
      const edges: SugiyamaEdge[] = [
        { from: "n1", to: "n1" },
        { from: "n1", to: "nonexistent" },
        { from: "nonexistent", to: "n1" },
      ];
      const res = computeLexicographicLabels(nodes, edges);
      expect(res.get("n1")).toBe(1);
    });

    it("labels multi-node graph with branches and breaks ties lexicographically", () => {
      const nodes = [
        createNode("a"),
        createNode("b"),
        createNode("c"),
        createNode("d"),
        createNode("e"),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "a", to: "c" },
        { from: "a", to: "d" },
        { from: "b", to: "c" },
        { from: "c", to: "e" },
        { from: "d", to: "e" },
      ];
      const res = computeLexicographicLabels(nodes, edges);
      expect(res.size).toBe(5);
      expect(res.get("e")).toBe(1);
      expect(typeof res.get("a")).toBe("number");
      expect(typeof res.get("b")).toBe("number");
    });
  });

  describe("boundLayerWidthCoffmanGraham", () => {
    it("handles edge cases: empty nodes and single node", () => {
      expect(boundLayerWidthCoffmanGraham([], []).size).toBe(0);

      const single = [createNode("root")];
      const singleRes = boundLayerWidthCoffmanGraham(single, []);
      expect(singleRes.get("root")).toBe(0);
    });

    it("bounds layer width strictly and handles width=1 linearization", () => {
      const nodes = [createNode("p1"), createNode("p2"), createNode("p3"), createNode("p4")];
      const resWidth1 = boundLayerWidthCoffmanGraham(nodes, [], 1);
      expect(resWidth1.get("p1")).toBe(3);
      expect(resWidth1.get("p2")).toBe(2);
      expect(resWidth1.get("p3")).toBe(1);
      expect(resWidth1.get("p4")).toBe(0);

      const resWidth2 = boundLayerWidthCoffmanGraham(nodes, [], 2);
      const layers = [...resWidth2.values()];
      const layer0Count = layers.filter((l) => l === 0).length;
      const layer1Count = layers.filter((l) => l === 1).length;
      expect(layer0Count).toBe(2);
      expect(layer1Count).toBe(2);
    });

    it("respects predecessor dependency hierarchy when bounding layer widths", () => {
      const nodes = [createNode("a"), createNode("b"), createNode("c")];
      const edges: SugiyamaEdge[] = [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "a" },
        { from: "unknown", to: "b" },
      ];
      const res = boundLayerWidthCoffmanGraham(nodes, edges, 2);
      const rankA = res.get("a") ?? -1;
      const rankB = res.get("b") ?? -1;
      const rankC = res.get("c") ?? -1;

      expect(rankB).toBeGreaterThan(rankA);
      expect(rankC).toBeGreaterThan(rankB);
    });
  });

  describe("assignSugiyamaRanks", () => {
    it("delegates to boundLayerWidthCoffmanGraham when maxWidth is provided", () => {
      const nodes = [createNode("n1"), createNode("n2"), createNode("n3")];
      const res = assignSugiyamaRanks(nodes, [], [], 1);
      expect(new Set(res.values()).size).toBe(3);
    });

    it("ranks DAG using topological longest-path when maxWidth is omitted", () => {
      const nodes = [
        createNode("root"),
        createNode("left"),
        createNode("right"),
        createNode("sink"),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "root", to: "left" },
        { from: "root", to: "right" },
        { from: "left", to: "sink" },
        { from: "right", to: "sink" },
      ];

      const res = assignSugiyamaRanks(nodes, edges);
      expect(res.get("root")).toBe(0);
      expect(res.get("left")).toBe(1);
      expect(res.get("right")).toBe(1);
      expect(res.get("sink")).toBe(2);
    });

    it("filters out cycle edges and ranks unvisited or disconnected nodes", () => {
      const nodes = [
        createNode("c1"),
        createNode("c2"),
        createNode("c3"),
        createNode("orphan"),
        createNode("child", ["orphan"]),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "c1", to: "c2" },
        { from: "c2", to: "c3" },
        { from: "c3", to: "c1" },
        { from: "orphan", to: "child" },
      ];

      const resWithFilter = assignSugiyamaRanks(nodes, edges, ["c1", "c2", "c3"]);
      expect(typeof resWithFilter.get("c1")).toBe("number");
      expect(typeof resWithFilter.get("orphan")).toBe("number");
      expect(resWithFilter.get("child")).toBeGreaterThan(resWithFilter.get("orphan") ?? 0);

      const resUnfiltered = assignSugiyamaRanks(nodes, edges, []);
      expect(typeof resUnfiltered.get("c1")).toBe("number");
      expect(typeof resUnfiltered.get("c2")).toBe("number");
      expect(typeof resUnfiltered.get("c3")).toBe("number");
    });
  });
});
