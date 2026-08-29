import { describe, expect, it } from "bun:test";
import {
  exportDagToSvg,
  type SugiyamaEdge,
  type SugiyamaNode,
} from "../../../../../../olt/scripts/src/reporting/dag-exporters/index.ts";

function createNode(id: string, overrides: Partial<SugiyamaNode> = {}): SugiyamaNode {
  return {
    id,
    label: `Task ${id}`,
    status: "ready",
    dependencies: [],
    ...overrides,
  };
}

describe("SVG Exporter (exportDagToSvg)", () => {
  it("renders empty graph gracefully", () => {
    const result = exportDagToSvg([], []);
    expect(result.format).toBe("svg");
    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.content).toContain("<svg");
    expect(result.content).toContain("</svg>");
    expect(result.nodeCount).toBe(0);
    expect(result.edgeCount).toBe(0);
  });

  it("renders linear chain with nodes and arrow markers", () => {
    const nodes: SugiyamaNode[] = [
      createNode("task-1", { status: "completed", assignedAgent: "implementer_14" }),
      createNode("task-2", { status: "running", gate: "bun test", validatorAgent: "validator_07" }),
    ];
    const edges: SugiyamaEdge[] = [{ from: "task-1", to: "task-2", reason: "prerequisite" }];

    const result = exportDagToSvg(nodes, edges, { title: "Pipeline DAG" });
    expect(result.format).toBe("svg");
    expect(result.nodeCount).toBe(2);
    expect(result.edgeCount).toBe(1);
    expect(result.layerCount).toBeGreaterThanOrEqual(1);
    expect(result.content).toContain("Pipeline DAG");
    expect(result.content).toContain("id=\"node-task-1\"");
    expect(result.content).toContain("id=\"node-task-2\"");
    expect(result.content).toContain("Agent: implementer_14");
    expect(result.content).toContain("Gate: bun test");
    expect(result.content).toContain("marker-end=\"url(#arrowhead)\"");
  });

  it("renders diamond DAG with horizontal orientation", () => {
    const nodes: SugiyamaNode[] = [
      createNode("A"),
      createNode("B"),
      createNode("C"),
      createNode("D"),
    ];
    const edges: SugiyamaEdge[] = [
      { from: "A", to: "B" },
      { from: "A", to: "C" },
      { from: "B", to: "D" },
      { from: "C", to: "D" },
    ];

    const result = exportDagToSvg(nodes, edges, { direction: "LR" });
    expect(result.nodeCount).toBe(4);
    expect(result.edgeCount).toBe(4);
    expect(result.content).toContain("node-A");
    expect(result.content).toContain("node-D");
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("supports custom theme and light theme options", () => {
    const nodes: SugiyamaNode[] = [createNode("N1", { status: "failed" })];
    const resultLight = exportDagToSvg(nodes, [], { theme: "light" });
    expect(resultLight.content).toContain("fill=\"#ffffff\"");

    const resultCustom = exportDagToSvg(nodes, [], {
      customTheme: { background: "#123456" },
    });
    expect(resultCustom.content).toContain("fill=\"#123456\"");
  });
});
