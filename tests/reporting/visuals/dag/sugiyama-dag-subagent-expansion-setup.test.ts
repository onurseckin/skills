import { describe, expect, it } from "bun:test";
import {
  assignSugiyamaRanks,
  buildOrthogonalRouteSegments,
  buildSugiyamaDagReport,
  generateSugiyamaDagReport,
  minimizeCrossingsBarycenter,
  renderInterWaveConnector,
  renderLaneSeparator,
  renderOrthogonalConnectors,
  renderRoundedNodeBox,
  renderSugiyamaDag,
  renderSugiyamaNodeBox,
  type SugiyamaEdge,
  type SugiyamaNode,
} from "../../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

describe("sugiyama-dag-subagent-expansion-setup", () => {
  describe("Master DAG Layout Compiler & Pipeline Integration", () => {
    it("compiles and renders a full 20-node multi-wave execution DAG", () => {
      const nodes: SugiyamaNode[] = Array.from({ length: 20 }, (_, i) => {
        const id = `task-${i + 1}`;
        const prevWaveNodeId = i >= 4 ? `task-${i - 3}` : undefined;
        const deps = prevWaveNodeId ? [prevWaveNodeId] : [];
        return {
          id,
          label: `Task ${i + 1} Module`,
          status: i < 8 ? "passed" : i === 8 ? "running" : i === 9 ? "validating" : "ready",
          dependencies: deps,
          assignedAgent: i === 8 ? "implementer-1" : i === 9 ? "validator-1" : undefined,
          assignedRole: i === 8 ? "implementer" : i === 9 ? "validator" : undefined,
          effort: 2,
          criticalDepth: Math.floor(i / 4),
          writeScope: [`src/module-${i + 1}.ts`],
        };
      });

      const edges: SugiyamaEdge[] = [];
      for (const node of nodes) {
        for (const dep of node.dependencies) {
          edges.push({ from: dep, to: node.id });
        }
      }

      const result = renderSugiyamaDag(nodes, edges);
      expect(result.layers.length).toBeGreaterThan(1);
      expect(result.rankedNodes.length).toBe(20);
      expect(result.cycleDiagnostic.hasCycle).toBe(false);
      expect(result.bypassDiagnostic.hasBypass).toBe(false);
      expect(result.renderedDag).toContain("WAVE 1");
      expect(result.renderedDag).toContain("task-1");
      expect(result.renderedDag).toContain("task-20");
    });

    it("generates full SugiyamaDagReport and metrics for 20-node DAG", () => {
      const nodes: SugiyamaNode[] = Array.from({ length: 20 }, (_, i) => ({
        id: `t-${i + 1}`,
        label: `Task ${i + 1}`,
        status: i < 5 ? "completed" : "ready",
        dependencies: i > 0 ? [`t-${i}`] : [],
        effort: 1,
        criticalDepth: i,
      }));
      const edges: SugiyamaEdge[] = nodes.slice(1).map((n, idx) => ({
        from: `t-${idx + 1}`,
        to: n.id,
      }));

      const report = generateSugiyamaDagReport(nodes, edges, {
        runId: "master-run-001",
        isCompiled: true,
        graphRevision: 2,
        maxParallel: 4,
      });

      expect(report.totalTasks).toBe(20);
      expect(report.totalNodes).toBe(20);
      expect(report.isCompiled).toBe(true);
      expect(report.graphRevision).toBe(2);
      expect(report.metrics.totalWaves).toBe(20);
      expect(report.metrics.maxParallelLanes).toBe(1);
      expect(report.metrics.totalWork).toBe(20);
      expect(report.markdown).toContain(
        "### Sugiyama Hierarchical DAG Visualization: master-run-001",
      );
      expect(report.markdown).toContain("Compiled (Revision 2)");

      const aliasReport = buildSugiyamaDagReport(nodes, edges, { runId: "master-run-001" });
      expect(aliasReport.totalTasks).toBe(report.totalTasks);
    });
  });

  describe("Width-Bounded Layouts (Coffman-Graham)", () => {
    it("enforces maxWidth limit across all layers for 20 branching nodes", () => {
      const nodes: SugiyamaNode[] = Array.from({ length: 20 }, (_, i) => ({
        id: `node-${i + 1}`,
        label: `Node ${i + 1}`,
        status: "ready",
        dependencies: i >= 4 ? [`node-${(i % 4) + 1}`] : [],
      }));
      const edges: SugiyamaEdge[] = nodes.flatMap((n) =>
        n.dependencies.map((dep) => ({ from: dep, to: n.id })),
      );

      const maxWidth = 3;
      const result = renderSugiyamaDag(nodes, edges, { maxWidth });
      for (const layer of result.layers) {
        expect(layer.nodes.length).toBeLessThanOrEqual(maxWidth);
      }
      expect(result.rankedNodes.length).toBe(20);
    });

    it("bounds layer width with maxWidth=4 on wide diamond graph", () => {
      const nodes: SugiyamaNode[] = [
        { id: "root", label: "root", status: "passed", dependencies: [] },
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `mid-${i + 1}`,
          label: `mid-${i + 1}`,
          status: "ready",
          dependencies: ["root"],
        })),
        {
          id: "sink",
          label: "sink",
          status: "ready",
          dependencies: Array.from({ length: 10 }, (_, i) => `mid-${i + 1}`),
        },
      ];
      const edges: SugiyamaEdge[] = [
        ...Array.from({ length: 10 }, (_, i) => ({ from: "root", to: `mid-${i + 1}` })),
        ...Array.from({ length: 10 }, (_, i) => ({ from: `mid-${i + 1}`, to: "sink" })),
      ];

      const result = renderSugiyamaDag(nodes, edges, { maxWidth: 4 });
      for (const layer of result.layers) {
        expect(layer.nodes.length).toBeLessThanOrEqual(4);
      }
    });
  });

  describe("Orthogonal Connectors Integration & Visual Routing", () => {
    it("integrates fan-out, fan-in, parallel lane connectors and separators", () => {
      const layer1 = {
        rank: 0,
        nodes: [{ id: "A", label: "A", status: "passed", dependencies: [], rank: 0, order: 0 }],
      };
      const layer2 = {
        rank: 1,
        nodes: [
          { id: "B1", label: "B1", status: "ready", dependencies: ["A"], rank: 1, order: 0 },
          { id: "B2", label: "B2", status: "ready", dependencies: ["A"], rank: 1, order: 1 },
        ],
      };
      const edges: SugiyamaEdge[] = [
        { from: "A", to: "B1" },
        { from: "A", to: "B2" },
      ];

      const fanOutLines = renderOrthogonalConnectors(layer1, layer2, edges);
      expect(fanOutLines.length).toBe(3);
      expect(fanOutLines[1]).toContain("FAN-OUT BUS");

      const fanInLines = renderInterWaveConnector(layer2, layer1, [
        { from: "B1", to: "A" },
        { from: "B2", to: "A" },
      ]);
      expect(fanInLines.length).toBe(3);
      expect(fanInLines[1]).toContain("FAN-IN BUS");

      const sepLines = renderLaneSeparator();
      expect(sepLines.length).toBe(3);
      expect(sepLines[1]).toContain("PARALLEL LANE");
    });

    it("computes orthogonal route segments correctly", () => {
      const nodeMap = new Map([
        [
          "src",
          {
            id: "src",
            label: "src",
            status: "passed",
            dependencies: [],
            rank: 0,
            order: 0,
            wave: 1,
            lane: 1,
          },
        ],
        [
          "dst",
          {
            id: "dst",
            label: "dst",
            status: "ready",
            dependencies: ["src"],
            rank: 1,
            order: 2,
            wave: 2,
            lane: 3,
          },
        ],
      ]);
      const edges: SugiyamaEdge[] = [{ from: "src", to: "dst" }];
      const segments = buildOrthogonalRouteSegments(edges, nodeMap);
      expect(segments.length).toBe(1);
      expect(segments[0]?.fromWave).toBe(1);
      expect(segments[0]?.toWave).toBe(2);
      expect(segments[0]?.fromLane).toBe(1);
      expect(segments[0]?.toLane).toBe(3);
    });
  });

  describe("Subagent Expansion & Dynamic Nesting in Master Layout", () => {
    it("renders nested subagent hierarchy inside master compiled layout", () => {
      const nodes: SugiyamaNode[] = [
        {
          id: "parent-task",
          label: "Parent Task",
          status: "running",
          dependencies: [],
          assignedAgent: "impl-master",
          assignedRole: "implementer",
          branchId: "branch-alpha",
          expandedSubtasks: [
            { id: "sub-1", status: "completed", implementerAgent: "sub-impl-1" },
            {
              id: "sub-2",
              status: "running",
              implementerAgent: "sub-impl-2",
              validatorAgent: "sub-val-2",
            },
          ],
        },
      ];
      const result = renderSugiyamaDag(nodes, []);
      expect(result.renderedDag).toContain("parent-task");
      expect(result.renderedDag).toContain("Dynamic Branch [branch-alpha]");
      expect(result.renderedDag).toContain("sub-1");
      expect(result.renderedDag).toContain("sub-2");
    });
  });

  describe("Layout Engine Performance Benchmark (< 50ms for 20 nodes)", () => {
    it("renders a 20-node multi-tier DAG in less than 50 milliseconds", () => {
      const nodes: SugiyamaNode[] = Array.from({ length: 20 }, (_, i) => ({
        id: `bench-${i + 1}`,
        label: `Benchmark Task ${i + 1}`,
        status: i % 2 === 0 ? "passed" : "ready",
        dependencies: i > 0 ? [`bench-${Math.max(1, i - (i % 3))}`] : [],
        effort: 1 + (i % 3),
        criticalDepth: Math.floor(i / 2),
      }));
      const edges: SugiyamaEdge[] = nodes.flatMap((n) =>
        n.dependencies.map((dep) => ({ from: dep, to: n.id })),
      );

      const start = performance.now();
      const report = generateSugiyamaDagReport(nodes, edges, {
        runId: "bench-run",
        maxWidth: 4,
        detailed: true,
      });
      const duration = performance.now() - start;

      expect(report.totalTasks).toBe(20);
      expect(duration).toBeLessThan(50);
    });
  });
});
