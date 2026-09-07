import { describe, expect, test } from "bun:test";
import {
  assignSugiyamaRanks,
  buildSugiyamaDagReport,
  insertVirtualDummyNodes,
  minimizeCrossingsBarycenter,
  type SugiyamaEdge,
  type SugiyamaLayer,
  type SugiyamaNode,
} from "../../../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

describe("dag-view sugiyama layout suite", () => {
  test("Sugiyama layout algorithm computes ranks, crossings, and dummy routes", () => {
    const sNodes: SugiyamaNode[] = [
      { id: "s1", label: "S1", status: "done", writeScope: ["src/1"], dependencies: [] },
      { id: "s2", label: "S2", status: "ready", writeScope: ["src/2"], dependencies: ["s1"] },
      { id: "s3", label: "S3", status: "ready", writeScope: ["src/3"], dependencies: ["s1"] },
      {
        id: "s4",
        label: "S4",
        status: "blocked",
        writeScope: ["src/4"],
        dependencies: ["s2", "s3"],
      },
    ];
    const sEdges: SugiyamaEdge[] = [
      { from: "s1", to: "s2", type: "dependency" },
      { from: "s1", to: "s3", type: "dependency" },
      { from: "s2", to: "s4", type: "dependency" },
      { from: "s3", to: "s4", type: "dependency" },
    ];

    const ranks = assignSugiyamaRanks(sNodes, sEdges);
    expect(ranks.get("s1")).toBe(0);
    expect(ranks.get("s4")).toBe(2);

    const initialLayers: SugiyamaLayer[] = [
      {
        rank: 0,
        nodes: [{ ...sNodes[0]!, rank: 0, order: 0, criticalDepth: 2, descendantCount: 3 }],
      },
      {
        rank: 1,
        nodes: [
          { ...sNodes[1]!, rank: 1, order: 0, criticalDepth: 1, descendantCount: 1 },
          { ...sNodes[2]!, rank: 1, order: 1, criticalDepth: 1, descendantCount: 1 },
        ],
      },
      {
        rank: 2,
        nodes: [{ ...sNodes[3]!, rank: 2, order: 0, criticalDepth: 0, descendantCount: 0 }],
      },
    ];

    const withDummies = insertVirtualDummyNodes(initialLayers, sEdges);
    expect(withDummies.layers.length).toBe(3);

    const reordered = minimizeCrossingsBarycenter(withDummies.layers, withDummies.edges);
    expect(reordered.length).toBe(3);

    const report = buildSugiyamaDagReport(sNodes, sEdges, { detailed: true });
    expect(report.metrics.totalWaves).toBe(3);
    expect(report.metrics.criticalPathLength).toBe(3);
    expect(report.renderedDag.length).toBeGreaterThan(0);
  });
});
