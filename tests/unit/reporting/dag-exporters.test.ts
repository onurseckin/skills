import { describe, expect, it } from "bun:test";
import {
  computeOptimizedLayout,
  DARK_THEME,
  exportAllVisualDagFormats,
  exportDagToAscii,
  exportDagToDot,
  exportDagToJson,
  exportDagToMermaid,
  exportDagToSvg,
  exportVisualDag,
  getStatusStyle,
  HIGH_CONTRAST_THEME,
  LIGHT_THEME,
  resolveDimensions,
  resolveExporterTheme,
  type SugiyamaEdge,
  type SugiyamaNode,
} from "../../../olt/scripts/src/reporting/dag-exporters/index.ts";

function createNode(id: string, overrides: Partial<SugiyamaNode> = {}): SugiyamaNode {
  return {
    id,
    label: `Task ${id}`,
    status: "ready",
    dependencies: [],
    ...overrides,
  };
}

describe("Visual DAG Layout Optimizer & Exporters (dag-exporters)", () => {
  describe("computeOptimizedLayout", () => {
    it("handles empty graphs cleanly with zero metrics", () => {
      const layout = computeOptimizedLayout([], []);
      expect(layout.nodes.length).toBe(0);
      expect(layout.edges.length).toBe(0);
      expect(layout.clusters.length).toBe(0);
      expect(layout.metrics.totalWaves).toBe(0);
      expect(layout.metrics.totalWork).toBe(0);
    });

    it("optimizes layout and computes coordinates for linear chains", () => {
      const nodes = [
        createNode("step-1", { effort: 2 }),
        createNode("step-2", { effort: 3 }),
        createNode("step-3", { effort: 1 }),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "step-1", to: "step-2" },
        { from: "step-2", to: "step-3" },
      ];

      const layout = computeOptimizedLayout(nodes, edges);
      expect(layout.nodes.length).toBe(3);
      expect(layout.edges.length).toBe(2);
      expect(layout.clusters.length).toBe(3);
      expect(layout.metrics.totalWaves).toBe(3);
      expect(layout.metrics.span).toBe(3);
      expect(layout.metrics.totalWork).toBe(6);
      expect(layout.metrics.maxParallelLanes).toBe(1);

      const n1 = layout.nodes.find((n) => n.id === "step-1")!;
      const n2 = layout.nodes.find((n) => n.id === "step-2")!;
      const n3 = layout.nodes.find((n) => n.id === "step-3")!;
      expect(n1.y).toBeLessThan(n2.y);
      expect(n2.y).toBeLessThan(n3.y);
    });

    it("computes diamond DAG parallel lanes and wave cluster bounds", () => {
      const nodes = [
        createNode("root", { status: "completed" }),
        createNode("branch-A", { status: "running", assignedAgent: "agent-1" }),
        createNode("branch-B", { status: "validating", validatorAgent: "val-1" }),
        createNode("join", { status: "proposed", gate: "all:pass" }),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "root", to: "branch-A" },
        { from: "root", to: "branch-B" },
        { from: "branch-A", to: "join" },
        { from: "branch-B", to: "join" },
      ];

      const layout = computeOptimizedLayout(nodes, edges, { title: "Diamond Pipeline" });
      expect(layout.title).toBe("Diamond Pipeline");
      expect(layout.nodes.length).toBe(4);
      expect(layout.edges.length).toBe(4);
      expect(layout.metrics.totalWaves).toBe(3);
      expect(layout.metrics.maxParallelLanes).toBe(2);
      expect(layout.clusters.length).toBe(3);

      const wave2Cluster = layout.clusters.find((c) => c.id === "wave-2")!;
      expect(wave2Cluster.nodeIds).toContain("branch-A");
      expect(wave2Cluster.nodeIds).toContain("branch-B");
      expect(wave2Cluster.width).toBeGreaterThan(0);
      expect(wave2Cluster.height).toBeGreaterThan(0);
    });

    it("supports direction toggles (TB vs LR)", () => {
      const nodes = [createNode("A"), createNode("B")];
      const edges: SugiyamaEdge[] = [{ from: "A", to: "B" }];

      const layoutTB = computeOptimizedLayout(nodes, edges, { direction: "TB" });
      const layoutLR = computeOptimizedLayout(nodes, edges, { direction: "LR" });

      const n1TB = layoutTB.nodes.find((n) => n.id === "A")!;
      const n2TB = layoutTB.nodes.find((n) => n.id === "B")!;
      expect(n1TB.y).toBeLessThan(n2TB.y);

      const n1LR = layoutLR.nodes.find((n) => n.id === "A")!;
      const n2LR = layoutLR.nodes.find((n) => n.id === "B")!;
      expect(n1LR.x).toBeLessThan(n2LR.x);
    });

    it("resolves custom dimension options", () => {
      const dims = resolveDimensions({
        nodeWidth: 300,
        nodeHeight: 120,
        layerSpacing: 100,
        nodeSpacing: 50,
      });
      expect(dims.nodeWidth).toBe(300);
      expect(dims.nodeHeight).toBe(120);
      expect(dims.layerSpacing).toBe(100);
      expect(dims.nodeSpacing).toBe(50);
    });
  });

  describe("Theme Management", () => {
    it("provides standard dark, light, and high contrast themes", () => {
      expect(DARK_THEME.background).toBe("#0d1117");
      expect(LIGHT_THEME.background).toBe("#ffffff");
      expect(HIGH_CONTRAST_THEME.background).toBe("#000000");

      const resolvedLight = resolveExporterTheme("light");
      expect(resolvedLight.background).toBe("#ffffff");

      const resolvedHighContrast = resolveExporterTheme("high-contrast");
      expect(resolvedHighContrast.background).toBe("#000000");
    });

    it("merges custom theme overrides cleanly", () => {
      const custom = resolveExporterTheme("dark", {
        background: "#112233",
        fontSize: 16,
      });
      expect(custom.background).toBe("#112233");
      expect(custom.fontSize).toBe(16);
      expect(custom.textPrimary).toBe(DARK_THEME.textPrimary);
    });

    it("retrieves status styling safely for known and unknown statuses", () => {
      const readyStyle = getStatusStyle("ready", DARK_THEME);
      expect(readyStyle.stroke).toBe("#58a6ff");

      const unknownStyle = getStatusStyle("unknown_state", DARK_THEME);
      expect(unknownStyle.fill).toBe(DARK_THEME.nodeFill);
    });
  });

  describe("Exporters", () => {
    const sampleNodes: SugiyamaNode[] = [
      createNode("alpha", { status: "completed", effort: 2 }),
      createNode("beta", { status: "running", assignedAgent: "worker-1", gate: "tsc" }),
      createNode("gamma", { status: "validating", validatorAgent: "val-1" }),
    ];
    const sampleEdges: SugiyamaEdge[] = [
      { from: "alpha", to: "beta", type: "prerequisite_gate" },
      { from: "alpha", to: "gamma", type: "scope_conflict", reason: "shared resource" },
    ];

    it("exports to SVG with valid XML and elements", () => {
      const svg = exportDagToSvg(sampleNodes, sampleEdges, { title: "Sample DAG" });
      expect(svg.format).toBe("svg");
      expect(svg.mimeType).toBe("image/svg+xml");
      expect(svg.content).toContain("<svg");
      expect(svg.content).toContain("Sample DAG");
      expect(svg.content).toContain('id="node-alpha"');
      expect(svg.content).toContain('id="node-beta"');
      expect(svg.nodeCount).toBe(3);
      expect(svg.edgeCount).toBe(2);
    });

    it("exports to Mermaid flowchart format", () => {
      const mermaid = exportDagToMermaid(sampleNodes, sampleEdges, { title: "Mermaid Flow" });
      expect(mermaid.format).toBe("mermaid");
      expect(mermaid.mimeType).toBe("text/vnd.mermaid");
      expect(mermaid.content).toContain("flowchart TD");
      expect(mermaid.content).toContain("subgraph Wave_1");
      expect(mermaid.content).toContain("classDef ready");
      expect(mermaid.content).toContain("alpha");
      expect(mermaid.nodeCount).toBe(3);
    });

    it("exports to ASCII / Unicode table format", () => {
      const ascii = exportDagToAscii(sampleNodes, sampleEdges, { title: "ASCII Table" });
      expect(ascii.format).toBe("ascii");
      expect(ascii.mimeType).toBe("text/plain");
      expect(ascii.content).toContain("ASCII Table");
      expect(ascii.content).toContain("── Wave 1");
      expect(ascii.content).toContain("Wave Metrics");
      expect(ascii.content).toContain("Total Work: 4");
    });

    it("exports to Graphviz DOT digraph format", () => {
      const dot = exportDagToDot(sampleNodes, sampleEdges, { title: "DOT Digraph" });
      expect(dot.format).toBe("dot");
      expect(dot.mimeType).toBe("text/vnd.graphviz");
      expect(dot.content).toContain("digraph VisualDag {");
      expect(dot.content).toContain("subgraph cluster_wave_1");
      expect(dot.content).toContain('"alpha"');
    });

    it("exports to JSON format with structure", () => {
      const jsonResult = exportDagToJson(sampleNodes, sampleEdges, { title: "JSON Export" });
      expect(jsonResult.format).toBe("json");
      expect(jsonResult.mimeType).toBe("application/json");
      const parsed = JSON.parse(jsonResult.content) as { title: string; nodes: unknown[] };
      expect(parsed.title).toBe("JSON Export");
      expect(parsed.nodes.length).toBe(3);
    });

    it("dispatches dynamically via exportVisualDag", () => {
      const svgRes = exportVisualDag(sampleNodes, sampleEdges, { format: "svg" });
      expect(svgRes.format).toBe("svg");

      const mermaidRes = exportVisualDag(sampleNodes, sampleEdges, { format: "mermaid" });
      expect(mermaidRes.format).toBe("mermaid");

      const asciiRes = exportVisualDag(sampleNodes, sampleEdges, { format: "ascii" });
      expect(asciiRes.format).toBe("ascii");

      const dotRes = exportVisualDag(sampleNodes, sampleEdges, { format: "dot" });
      expect(dotRes.format).toBe("dot");

      const jsonRes = exportVisualDag(sampleNodes, sampleEdges, { format: "json" });
      expect(jsonRes.format).toBe("json");
    });

    it("exports all formats simultaneously via exportAllVisualDagFormats", () => {
      const all = exportAllVisualDagFormats(sampleNodes, sampleEdges);
      expect(all.svg?.format).toBe("svg");
      expect(all.mermaid?.format).toBe("mermaid");
      expect(all.ascii?.format).toBe("ascii");
      expect(all.dot?.format).toBe("dot");
      expect(all.json?.format).toBe("json");
    });
  });
});
