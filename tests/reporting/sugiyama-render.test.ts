import { describe, expect, it } from "bun:test";
import {
  buildSugiyamaDagReport,
  generateSugiyamaDagReport,
  renderSugiyamaDag,
} from "../../olt/scripts/src/reporting/sugiyama-dag/render.ts";
import type {
  DirectedGraph,
  SugiyamaEdge,
  SugiyamaNode,
} from "../../olt/scripts/src/reporting/sugiyama-dag/types.ts";

function createNode(
  id: string,
  status: SugiyamaNode["status"] = "ready",
  dependencies: readonly string[] = [],
  extra: Partial<SugiyamaNode> = {},
): SugiyamaNode {
  return {
    id,
    label: `Node ${id}`,
    status,
    dependencies,
    ...extra,
  };
}

describe("sugiyama-dag render coverage", () => {
  describe("renderSugiyamaDag", () => {
    it("handles empty nodes input across array and graph signatures", () => {
      const emptyArrRes = renderSugiyamaDag([]);
      expect(emptyArrRes.renderedDag).toContain("(No tasks declared in planning buffer/graph)");
      expect(emptyArrRes.layers).toHaveLength(0);
      expect(emptyArrRes.rankedNodes).toHaveLength(0);

      const emptyGraph: DirectedGraph = { nodes: [], edges: [] };
      const emptyGraphRes = renderSugiyamaDag(emptyGraph);
      expect(emptyGraphRes.renderedDag).toContain("(No tasks declared in planning buffer/graph)");
    });

    it("renders active execution subgraph banner when active statuses exist", () => {
      const nodes: SugiyamaNode[] = [
        createNode("n1", "running"),
        createNode("n2", "leased", ["n1"]),
        createNode("n3", "validating", ["n2"]),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
      ];

      const res = renderSugiyamaDag(nodes, edges, { detailed: true });
      expect(res.renderedDag).toContain("⚡ [ACTIVE EXECUTION SUBGRAPH]");
      expect(res.renderedDag).toContain("WAVE 1");
      expect(res.renderedDag).toContain("WAVE 2");
      expect(res.renderedDag).toContain("WAVE 3");
      expect(res.layers).toHaveLength(3);
      expect(res.rankedNodes).toHaveLength(3);
    });

    it("supports DirectedGraph input signature with options", () => {
      const graph: DirectedGraph = {
        nodes: [createNode("a", "ready"), createNode("b", "completed", ["a"])],
        edges: [{ from: "a", to: "b" }],
      };
      const res = renderSugiyamaDag(graph, { passes: 2 });
      expect(res.layers).toHaveLength(2);
      expect(res.renderedDag).toContain("Node a");
      expect(res.renderedDag).toContain("Node b");
    });

    it("supports nodes + options 2-parameter signature", () => {
      const nodes: SugiyamaNode[] = [createNode("only1", "ready")];
      const res = renderSugiyamaDag(nodes, { detailed: false });
      expect(res.layers).toHaveLength(1);
      expect(res.renderedDag).toContain("Node only1");
    });

    it("renders virtual dummy transit nodes across multi-rank spans", () => {
      const nodes: SugiyamaNode[] = [
        createNode("src", "ready"),
        createNode("mid", "ready", ["src"]),
        createNode("dst", "ready", ["src", "mid"]),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "src", to: "mid" },
        { from: "mid", to: "dst" },
        { from: "src", to: "dst" },
      ];

      const res = renderSugiyamaDag(nodes, edges);
      expect(res.renderedDag).toContain("[TRANSIT CONDUIT]");
      expect(res.layers).toHaveLength(3);
    });

    it("renders cycle and bypass diagnostic headers when anomalies exist", () => {
      const nodes: SugiyamaNode[] = [
        createNode("c1", "ready", ["c2"]),
        createNode("c2", "ready", ["c1"]),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "c1", to: "c2" },
        { from: "c2", to: "c1" },
      ];

      const res = renderSugiyamaDag(nodes, edges);
      expect(res.cycleDiagnostic.hasCycle).toBe(true);
      expect(res.renderedDag).toContain("⚡ [POISONOUS CYCLE] ⚡");
      expect(res.renderedDag).toContain("Cycle detected: c1 ➔ c2 ➔ c1");
    });
  });

  describe("generateSugiyamaDagReport and buildSugiyamaDagReport", () => {
    it("computes metrics, span, and produces rich markdown report", () => {
      const nodes: SugiyamaNode[] = [
        createNode("t1", "completed", [], { effort: 2, criticalDepth: 0, descendantCount: 3 }),
        createNode("t2", "running", ["t1"], { effort: 3, criticalDepth: 1 }),
        createNode("t3", "ready", ["t1"], { effort: 1, criticalDepth: 1 }),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "t1", to: "t2" },
        { from: "t1", to: "t3" },
      ];

      const report = generateSugiyamaDagReport(nodes, edges, {
        runId: "custom-run-id",
        graphRevision: 4,
        isCompiled: true,
        maxParallel: 6,
      });

      expect(report.markdown).toContain("Sugiyama Hierarchical DAG Visualization: custom-run-id");
      expect(report.markdown).toContain("Compiled (Revision 4)");
      expect(report.markdown).toContain("Critical Path");
      expect(report.metrics.totalWork).toBe(6);
      expect(report.metrics.serialBottlenecks).toBe(1);
      expect(report.totalTasks).toBe(3);
      expect(report.totalLayers).toBe(2);

      const built = buildSugiyamaDagReport(nodes, edges, { isCompiled: false });
      expect(built.markdown).toContain("Draft (Planning Buffer)");
    });

    it("includes cycle and bypass markdown sections when issues are detected", () => {
      const nodes: SugiyamaNode[] = [
        createNode("x", "failed", ["y"]),
        createNode("y", "failed", ["x"]),
        createNode("z", "ready", ["x", "y"]),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "x", to: "y" },
        { from: "y", to: "x" },
        { from: "x", to: "z" },
        { from: "y", to: "z" },
      ];

      const report = generateSugiyamaDagReport(nodes, edges);
      expect(report.markdown).toContain("#### ⚡ [POISONOUS CYCLE] ⚡");
      expect(report.markdown).toContain("Cycle Path");
      expect(report.markdown).toContain("Remediation");

      const bypassNodes: SugiyamaNode[] = [
        createNode("b1", "ready"),
        createNode("b2", "ready", ["b1"]),
        createNode("b3", "ready", ["b1", "b2"]),
      ];
      const bypassEdges: SugiyamaEdge[] = [
        { from: "b1", to: "b2" },
        { from: "b2", to: "b3" },
        { from: "b1", to: "b3" },
      ];
      const bypassReport = generateSugiyamaDagReport(bypassNodes, bypassEdges);
      expect(bypassReport.markdown).toContain("#### ❌ [ILLEGAL BYPASS] ❌");
    });
  });
});
