import { describe, expect, it } from "bun:test";
import {
  buildOrthogonalRouteSegments,
  insertVirtualDummyNodes,
  renderInterWaveConnector,
  renderLaneSeparator,
  renderOrthogonalConnectors,
} from "../../../olt/scripts/src/reporting/sugiyama-dag/routing.ts";
import type {
  SugiyamaEdge,
  SugiyamaLayer,
  SugiyamaRankedNode,
} from "../../../olt/scripts/src/reporting/sugiyama-dag/types.ts";

function createRankedNode(
  id: string,
  rank: number,
  order: number,
  wave?: number,
  lane?: number,
): SugiyamaRankedNode {
  return {
    id,
    label: `Node ${id}`,
    status: "ready",
    dependencies: [],
    rank,
    order,
    wave,
    lane,
    coordinates: { rank, order, wave: wave ?? rank + 1, lane: lane ?? order + 1 },
  };
}

describe("sugiyama-dag routing coverage", () => {
  describe("buildOrthogonalRouteSegments", () => {
    it("skips edges when nodes are missing from map and uses explicit wave/lane", () => {
      const n1 = createRankedNode("n1", 0, 0, 10, 20);
      const n2 = createRankedNode("n2", 1, 1, 30, 40);
      const map = new Map<string, SugiyamaRankedNode>([
        ["n1", n1],
        ["n2", n2],
      ]);
      const edges: SugiyamaEdge[] = [
        { from: "n1", to: "n2" },
        { from: "n1", to: "missing" },
        { from: "missing", to: "n2" },
      ];

      const segments = buildOrthogonalRouteSegments(edges, map);
      expect(segments).toEqual([
        {
          fromNodeId: "n1",
          toNodeId: "n2",
          fromWave: 10,
          toWave: 30,
          fromLane: 20,
          toLane: 40,
        },
      ]);
    });

    it("falls back to rank + 1 and order + 1 when wave/lane are undefined", () => {
      const n1 = createRankedNode("n1", 0, 2);
      const n2 = createRankedNode("n2", 3, 5);
      const map = new Map<string, SugiyamaRankedNode>([
        ["n1", n1],
        ["n2", n2],
      ]);

      const segments = buildOrthogonalRouteSegments([{ from: "n1", to: "n2" }], map);
      expect(segments).toEqual([
        {
          fromNodeId: "n1",
          toNodeId: "n2",
          fromWave: 1,
          toWave: 4,
          fromLane: 3,
          toLane: 6,
        },
      ]);
    });
  });

  describe("insertVirtualDummyNodes", () => {
    it("leaves short-span and unranked edges untouched", () => {
      const l0: SugiyamaLayer = { rank: 0, nodes: [createRankedNode("a", 0, 0)] };
      const l1: SugiyamaLayer = { rank: 1, nodes: [createRankedNode("b", 1, 0)] };
      const edges: SugiyamaEdge[] = [
        { from: "a", to: "b" },
        { from: "a", to: "unknown" },
        { from: "unknown", to: "b" },
      ];

      const result = insertVirtualDummyNodes([l0, l1], edges);
      expect(result.dummyNodes).toHaveLength(0);
      expect(result.edges).toEqual(edges);
    });

    it("inserts dummy nodes across multi-rank spans", () => {
      const l0: SugiyamaLayer = { rank: 0, nodes: [createRankedNode("a", 0, 0)] };
      const l1: SugiyamaLayer = { rank: 1, nodes: [createRankedNode("mid", 1, 0)] };
      const l2: SugiyamaLayer = { rank: 2, nodes: [] };
      const l3: SugiyamaLayer = { rank: 3, nodes: [createRankedNode("z", 3, 0)] };
      const edges: SugiyamaEdge[] = [{ from: "a", to: "z", reason: "dependency" }];

      const result = insertVirtualDummyNodes([l0, l1, l2, l3], edges);
      expect(result.dummyNodes).toHaveLength(2);
      expect(result.dummyNodes[0]?.id).toBe("__dummy__a__z__r1");
      expect(result.dummyNodes[0]?.isDummy).toBe(true);
      expect(result.dummyNodes[0]?.origSource).toBe("a");
      expect(result.dummyNodes[0]?.origTarget).toBe("z");
      expect(result.dummyNodes[1]?.id).toBe("__dummy__a__z__r2");

      expect(result.edges).toHaveLength(3);
      expect(result.edges[0]?.to).toBe("__dummy__a__z__r1");
      expect(result.edges[1]?.to).toBe("__dummy__a__z__r2");
      expect(result.edges[2]?.to).toBe("z");
    });
  });

  describe("renderOrthogonalConnectors and renderInterWaveConnector", () => {
    it("returns default connector lines for empty, disjoint, or 1:1 layers", () => {
      const emptyLayer: SugiyamaLayer = { rank: 0, nodes: [] };
      const l1: SugiyamaLayer = { rank: 0, nodes: [createRankedNode("a", 0, 0)] };
      const l2: SugiyamaLayer = { rank: 1, nodes: [createRankedNode("b", 1, 0)] };
      const fallback = ["                              │", "                              ▼"];

      expect(renderOrthogonalConnectors(emptyLayer, l2, [])).toEqual(fallback);
      expect(renderOrthogonalConnectors(l1, l2, [{ from: "x", to: "y" }])).toEqual(fallback);
      expect(renderOrthogonalConnectors(l1, l2, [{ from: "a", to: "b" }])).toEqual(fallback);
      expect(renderInterWaveConnector(l1, l2, [{ from: "a", to: "b" }])).toEqual(fallback);
    });

    it("renders fan-out bus when 1 source targets multiple sinks", () => {
      const l0: SugiyamaLayer = { rank: 0, nodes: [createRankedNode("src", 0, 0)] };
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [
          createRankedNode("dst1", 1, 0),
          createRankedNode("dst2", 1, 1),
          createRankedNode("dst3", 1, 2),
        ],
      };
      const edges: SugiyamaEdge[] = [
        { from: "src", to: "dst1" },
        { from: "src", to: "dst2" },
        { from: "src", to: "dst3" },
      ];

      const lines = renderOrthogonalConnectors(l0, l1, edges, 20);
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain("[W2 FAN-OUT BUS]");
      expect(lines[0]).toContain("│");
      expect(lines[2]).toContain("▼");
    });

    it("renders fan-in bus when multiple sources target 1 sink", () => {
      const l0: SugiyamaLayer = {
        rank: 0,
        nodes: [createRankedNode("src1", 0, 0), createRankedNode("src2", 0, 1)],
      };
      const l1: SugiyamaLayer = { rank: 1, nodes: [createRankedNode("dst", 1, 0)] };
      const edges: SugiyamaEdge[] = [
        { from: "src1", to: "dst" },
        { from: "src2", to: "dst" },
      ];

      const lines = renderOrthogonalConnectors(l0, l1, edges, 20);
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain("[W2 FAN-IN BUS]");
    });

    it("renders cross-lane junction and parallel channel in M:N configurations", () => {
      const l0: SugiyamaLayer = {
        rank: 0,
        nodes: [createRankedNode("s1", 0, 0), createRankedNode("s2", 0, 1)],
      };
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [createRankedNode("t1", 1, 0), createRankedNode("t2", 1, 1)],
      };

      const crossEdges: SugiyamaEdge[] = [
        { from: "s1", to: "t2" },
        { from: "s2", to: "t1" },
      ];
      const crossLines = renderOrthogonalConnectors(l0, l1, crossEdges, 20);
      expect(crossLines[1]).toContain("[W2 CROSS-LANE JUNCTION]");

      const parallelEdges: SugiyamaEdge[] = [
        { from: "s1", to: "t1" },
        { from: "s2", to: "t2" },
      ];
      const parallelLines = renderOrthogonalConnectors(l0, l1, parallelEdges, 20);
      expect(parallelLines[1]).toContain("[W2 PARALLEL CHANNEL]");
    });
  });

  describe("renderLaneSeparator", () => {
    it("renders separator with default and small indentation", () => {
      const defaultSep = renderLaneSeparator();
      expect(defaultSep).toHaveLength(3);
      expect(defaultSep[1]).toContain("[PARALLEL LANE]");

      const smallSep = renderLaneSeparator(3);
      expect(smallSep).toHaveLength(3);
      expect(smallSep[1]).toContain("[PARALLEL LANE]");
    });
  });
});
