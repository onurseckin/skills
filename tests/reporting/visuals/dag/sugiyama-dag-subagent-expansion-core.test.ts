import { describe, expect, it } from "bun:test";
import {
  buildOrthogonalRouteSegments,
  renderInterWaveConnector,
  renderLaneSeparator,
  renderOrthogonalConnectors,
} from "../../../../../olt/scripts/src/reporting/sugiyama-dag/routing.ts";
import type {
  SugiyamaEdge,
  SugiyamaLayer,
  SugiyamaRankedNode,
} from "../../../../../olt/scripts/src/reporting/sugiyama-dag/types.ts";

describe("sugiyama-dag-subagent-expansion-core (Orthogonal Box-Drawing Routing)", () => {
  describe("buildOrthogonalRouteSegments", () => {
    it("computes accurate 1-indexed wave and lane coordinates from ranked node metadata", () => {
      const nodeMap = new Map<string, SugiyamaRankedNode>([
        ["t1", { id: "t1", label: "T1", status: "done", dependencies: [], rank: 0, order: 0 }],
        ["t2", { id: "t2", label: "T2", status: "ready", dependencies: ["t1"], rank: 1, order: 1 }],
        ["t3", { id: "t3", label: "T3", status: "ready", dependencies: ["t1"], rank: 1, order: 0 }],
      ]);
      const edges: readonly SugiyamaEdge[] = [
        { from: "t1", to: "t2" },
        { from: "t1", to: "t3" },
      ];
      const segments = buildOrthogonalRouteSegments(edges, nodeMap);

      expect(segments).toHaveLength(2);
      expect(segments[0]).toEqual({
        fromNodeId: "t1",
        toNodeId: "t2",
        fromWave: 1,
        toWave: 2,
        fromLane: 1,
        toLane: 2,
      });
      expect(segments[1]).toEqual({
        fromNodeId: "t1",
        toNodeId: "t3",
        fromWave: 1,
        toWave: 2,
        fromLane: 1,
        toLane: 1,
      });
    });

    it("respects explicit wave and lane overrides when specified on node objects", () => {
      const nodeMap = new Map<string, SugiyamaRankedNode>([
        [
          "A",
          {
            id: "A",
            label: "A",
            status: "done",
            dependencies: [],
            rank: 0,
            order: 0,
            wave: 5,
            lane: 3,
          },
        ],
        [
          "B",
          {
            id: "B",
            label: "B",
            status: "ready",
            dependencies: ["A"],
            rank: 1,
            order: 0,
            wave: 6,
            lane: 7,
          },
        ],
      ]);
      const segments = buildOrthogonalRouteSegments([{ from: "A", to: "B" }], nodeMap);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({
        fromNodeId: "A",
        toNodeId: "B",
        fromWave: 5,
        toWave: 6,
        fromLane: 3,
        toLane: 7,
      });
    });

    it("silently ignores edges where source or destination is missing in nodeMap", () => {
      const nodeMap = new Map<string, SugiyamaRankedNode>([
        ["N1", { id: "N1", label: "N1", status: "done", dependencies: [], rank: 0, order: 0 }],
      ]);
      const segments = buildOrthogonalRouteSegments(
        [
          { from: "N1", to: "MISSING" },
          { from: "MISSING", to: "N1" },
        ],
        nodeMap,
      );
      expect(segments).toHaveLength(0);
    });
  });

  describe("renderOrthogonalConnectors (1-to-1 Direct Downward Flow)", () => {
    it("renders direct vertical and downward arrow connector for single-lane transitions", () => {
      const l0: SugiyamaLayer = {
        rank: 0,
        nodes: [{ id: "A", label: "A", status: "done", dependencies: [], rank: 0, order: 0 }],
      };
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [{ id: "B", label: "B", status: "ready", dependencies: ["A"], rank: 1, order: 0 }],
      };
      const lines = renderOrthogonalConnectors(l0, l1, [{ from: "A", to: "B" }], 20);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe("                    │");
      expect(lines[1]).toBe("                    ▼");
    });

    it("handles empty layers or disconnected layers with fallback downward flow", () => {
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [{ id: "B", label: "B", status: "ready", dependencies: [], rank: 1, order: 0 }],
      };
      const emptyRes = renderOrthogonalConnectors({ rank: 0, nodes: [] }, l1, [], 10);
      expect(emptyRes).toHaveLength(2);
      expect(emptyRes[0]).toBe("          │");
      expect(emptyRes[1]).toBe("          ▼");
    });
  });

  describe("renderOrthogonalConnectors (Fan-Out & Fan-In Buses)", () => {
    it("renders 1-to-2 symmetric fan-out bus with valid corners and branch connectors", () => {
      const l0: SugiyamaLayer = {
        rank: 0,
        nodes: [{ id: "src", label: "S", status: "done", dependencies: [], rank: 0, order: 0 }],
      };
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [
          { id: "d1", label: "D1", status: "ready", dependencies: ["src"], rank: 1, order: 0 },
          { id: "d2", label: "D2", status: "ready", dependencies: ["src"], rank: 1, order: 1 },
        ],
      };
      const edges: readonly SugiyamaEdge[] = [
        { from: "src", to: "d1" },
        { from: "src", to: "d2" },
      ];
      const lines = renderOrthogonalConnectors(l0, l1, edges, 20);

      expect(lines).toHaveLength(3);
      expect(lines[0]?.includes("│")).toBe(true);
      const busLine = lines[1] ?? "";
      expect(busLine).toContain("┌");
      expect(busLine).toContain("┴");
      expect(busLine).toContain("┐");
      expect(busLine).toContain("──▶ [W2 FAN-OUT BUS]");
      expect(lines[2]?.includes("▼")).toBe(true);
    });

    it("renders 1-to-3 fan-out bus containing 4-way cross junction (┼) at center drop", () => {
      const l0: SugiyamaLayer = {
        rank: 0,
        nodes: [{ id: "root", label: "R", status: "done", dependencies: [], rank: 0, order: 0 }],
      };
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [
          { id: "c1", label: "C1", status: "ready", dependencies: ["root"], rank: 1, order: 0 },
          { id: "c2", label: "C2", status: "ready", dependencies: ["root"], rank: 1, order: 1 },
          { id: "c3", label: "C3", status: "ready", dependencies: ["root"], rank: 1, order: 2 },
        ],
      };
      const edges = [
        { from: "root", to: "c1" },
        { from: "root", to: "c2" },
        { from: "root", to: "c3" },
      ];
      const lines = renderOrthogonalConnectors(l0, l1, edges, 20);

      expect(lines).toHaveLength(3);
      const busLine = lines[1] ?? "";
      expect(busLine).toContain("┌");
      expect(busLine).toContain("┼");
      expect(busLine).toContain("┐");
      expect(busLine).toContain("──▶ [W2 FAN-OUT BUS]");
      const arrowCount = ((lines[2] ?? "").match(/▼/g) || []).length;
      expect(arrowCount).toBe(3);
    });

    it("renders 2-to-1 fan-in bus with bottom corners and downward-tee connector", () => {
      const l0: SugiyamaLayer = {
        rank: 0,
        nodes: [
          { id: "p1", label: "P1", status: "done", dependencies: [], rank: 0, order: 0 },
          { id: "p2", label: "P2", status: "done", dependencies: [], rank: 0, order: 1 },
        ],
      };
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [
          {
            id: "sink",
            label: "Sk",
            status: "ready",
            dependencies: ["p1", "p2"],
            rank: 1,
            order: 0,
          },
        ],
      };
      const lines = renderOrthogonalConnectors(
        l0,
        l1,
        [
          { from: "p1", to: "sink" },
          { from: "p2", to: "sink" },
        ],
        20,
      );

      expect(lines).toHaveLength(3);
      const busLine = lines[1] ?? "";
      expect(busLine).toContain("└");
      expect(busLine).toContain("┬");
      expect(busLine).toContain("┘");
      expect(busLine).toContain("──▶ [W2 FAN-IN BUS]");
      expect(lines[2]?.includes("▼")).toBe(true);
    });

    it("renders 3-to-1 fan-in bus with 4-way cross junction (┼) at center node", () => {
      const l0: SugiyamaLayer = {
        rank: 0,
        nodes: [
          { id: "p1", label: "P1", status: "done", dependencies: [], rank: 0, order: 0 },
          { id: "p2", label: "P2", status: "done", dependencies: [], rank: 0, order: 1 },
          { id: "p3", label: "P3", status: "done", dependencies: [], rank: 0, order: 2 },
        ],
      };
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [
          {
            id: "sink",
            label: "Sk",
            status: "ready",
            dependencies: ["p1", "p2", "p3"],
            rank: 1,
            order: 0,
          },
        ],
      };
      const edges = [
        { from: "p1", to: "sink" },
        { from: "p2", to: "sink" },
        { from: "p3", to: "sink" },
      ];
      const lines = renderOrthogonalConnectors(l0, l1, edges, 20);

      expect(lines).toHaveLength(3);
      const busLine = lines[1] ?? "";
      expect(busLine).toContain("└");
      expect(busLine).toContain("┼");
      expect(busLine).toContain("┘");
      expect(busLine).toContain("──▶ [W2 FAN-IN BUS]");
      expect(lines[2]?.includes("▼")).toBe(true);
    });
  });

  describe("renderOrthogonalConnectors (N-to-M Cross-Lane Junctions)", () => {
    it("renders 2-to-2 cross-lane permutation with side-tee junctions (├ and ┤)", () => {
      const l0: SugiyamaLayer = {
        rank: 0,
        nodes: [
          { id: "u1", label: "U1", status: "done", dependencies: [], rank: 0, order: 0 },
          { id: "u2", label: "U2", status: "done", dependencies: [], rank: 0, order: 1 },
        ],
      };
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [
          { id: "v1", label: "V1", status: "ready", dependencies: ["u2"], rank: 1, order: 0 },
          { id: "v2", label: "V2", status: "ready", dependencies: ["u1"], rank: 1, order: 1 },
        ],
      };
      const edges = [
        { from: "u1", to: "v2" },
        { from: "u2", to: "v1" },
      ];
      const lines = renderOrthogonalConnectors(l0, l1, edges, 20);

      expect(lines).toHaveLength(3);
      const busLine = lines[1] ?? "";
      expect(busLine).toContain("├");
      expect(busLine).toContain("┤");
      expect(busLine).toContain("──▶ [W2 CROSS-LANE JUNCTION]");
      expect(lines[0]?.includes("│")).toBe(true);
      expect(lines[2]?.includes("▼")).toBe(true);
    });

    it("renders parallel multi-lane flow with parallel channel label when no cross edges exist", () => {
      const l0: SugiyamaLayer = {
        rank: 0,
        nodes: [
          { id: "p1", label: "P1", status: "done", dependencies: [], rank: 0, order: 0 },
          { id: "p2", label: "P2", status: "done", dependencies: [], rank: 0, order: 1 },
        ],
      };
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [
          { id: "s1", label: "S1", status: "ready", dependencies: ["p1"], rank: 1, order: 0 },
          { id: "s2", label: "S2", status: "ready", dependencies: ["p2"], rank: 1, order: 1 },
        ],
      };
      const lines = renderOrthogonalConnectors(
        l0,
        l1,
        [
          { from: "p1", to: "s1" },
          { from: "p2", to: "s2" },
        ],
        20,
      );
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain("──▶ [W2 PARALLEL CHANNEL]");
    });

    it("only emits strictly valid Unicode box-drawing characters in the routing grid", () => {
      const validGlyphs = new Set([
        "┌",
        "┐",
        "└",
        "┘",
        "│",
        "─",
        "├",
        "┤",
        "┬",
        "┴",
        "┼",
        "▶",
        "▼",
        " ",
        "[",
        "]",
        "W",
        "2",
        "3",
        "4",
        "5",
        "F",
        "A",
        "N",
        "O",
        "U",
        "T",
        "B",
        "S",
        "I",
        "C",
        "R",
        "L",
        "E",
        "J",
        "P",
        "H",
        "-",
      ]);
      const l0: SugiyamaLayer = {
        rank: 1,
        nodes: [
          { id: "x1", label: "X1", status: "done", dependencies: [], rank: 1, order: 0 },
          { id: "x2", label: "X2", status: "done", dependencies: [], rank: 1, order: 1 },
        ],
      };
      const l1: SugiyamaLayer = {
        rank: 2,
        nodes: [
          { id: "y1", label: "Y1", status: "ready", dependencies: ["x1"], rank: 2, order: 0 },
          { id: "y2", label: "Y2", status: "ready", dependencies: ["x1", "x2"], rank: 2, order: 1 },
          { id: "y3", label: "Y3", status: "ready", dependencies: ["x2"], rank: 2, order: 2 },
        ],
      };
      const edges = [
        { from: "x1", to: "y1" },
        { from: "x1", to: "y2" },
        { from: "x2", to: "y2" },
        { from: "x2", to: "y3" },
      ];
      const lines = renderOrthogonalConnectors(l0, l1, edges, 24);
      for (const line of lines) {
        for (const char of line) {
          expect(validGlyphs.has(char)).toBe(true);
        }
      }
    });
  });

  describe("Backward-Compatible Helpers (renderInterWaveConnector & renderLaneSeparator)", () => {
    it("renderInterWaveConnector delegates to renderOrthogonalConnectors seamlessly", () => {
      const l0: SugiyamaLayer = {
        rank: 0,
        nodes: [{ id: "A", label: "A", status: "done", dependencies: [], rank: 0, order: 0 }],
      };
      const l1: SugiyamaLayer = {
        rank: 1,
        nodes: [{ id: "B", label: "B", status: "ready", dependencies: ["A"], rank: 1, order: 0 }],
      };
      const connector = renderInterWaveConnector(l0, l1, [{ from: "A", to: "B" }], 15);
      expect(connector).toHaveLength(2);
      expect(connector[0]).toBe("               │");
      expect(connector[1]).toBe("               ▼");
    });

    it("renderLaneSeparator returns valid intra-wave parallel lane separation lines", () => {
      const sep = renderLaneSeparator(20);
      expect(sep).toHaveLength(3);
      expect(sep[0]).toBe("                    │");
      expect(sep[1]).toContain("──▶ [PARALLEL LANE]");
      expect(sep[2]).toBe("                    │");
    });
  });
});
