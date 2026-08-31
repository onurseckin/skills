import { describe, expect, it } from "bun:test";
import {
  buildOrthogonalRouteSegments,
  buildSugiyamaDagReport,
  formatCoordinates,
  formatImplementerValidatorTracking,
  formatNodeBadges,
  formatStatusBadge,
  formatSubagentAllocation,
  generateSugiyamaDagReport,
  getNodeStatusGlyph,
  getStatusBadge,
  getStatusGlyph,
  renderInterWaveConnector,
  renderLaneSeparator,
  renderOrthogonalConnectors,
  renderRoundedNodeBox,
  renderSubagentExpandedItems,
  renderSugiyamaDag,
  renderSugiyamaNodeBox,
  type SugiyamaEdge,
  type SugiyamaLayer,
  type SugiyamaNode,
  type SugiyamaRankedNode,
  type SugiyamaSubtask,
} from "../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

function node(id: string, deps: readonly string[] = [], status = "ready"): SugiyamaNode {
  return { id, label: `Task ${id}`, status, dependencies: deps };
}

describe("Sugiyama Routing and Badges", () => {
  it("builds orthogonal route segments across waves and lanes", () => {
    const nodeMap = new Map<string, SugiyamaRankedNode>([
      ["W1", { ...node("W1"), rank: 0, order: 0, wave: 1, lane: 1 }],
      ["W2", { ...node("W2"), rank: 1, order: 0, wave: 2, lane: 1 }],
    ]);
    const edges: SugiyamaEdge[] = [{ from: "W1", to: "W2" }];
    const segments = buildOrthogonalRouteSegments(edges, nodeMap);
    expect(segments.length).toBe(1);
    expect(segments[0]?.fromWave).toBe(1);
    expect(segments[0]?.toWave).toBe(2);
  });

  it("renders orthogonal connectors and lane separators", () => {
    const layer1: SugiyamaLayer = { rank: 0, nodes: [{ ...node("N1"), rank: 0, order: 0 }] };
    const layer2: SugiyamaLayer = { rank: 1, nodes: [{ ...node("N2"), rank: 1, order: 0 }] };
    const edges: SugiyamaEdge[] = [{ from: "N1", to: "N2" }];
    expect(renderOrthogonalConnectors(layer1, layer2, edges).length).toBeGreaterThan(0);
    expect(renderInterWaveConnector(layer1, layer2, edges).length).toBeGreaterThan(0);
    expect(renderLaneSeparator().length).toBe(3);
  });

  it("formats badges, status glyphs, and subagent allocations", () => {
    expect(getNodeStatusGlyph("completed")).toBe("✓");
    expect(getNodeStatusGlyph("running")).toBe("●");
    expect(getStatusBadge("ready")).toBe("○ READY");
    expect(getStatusGlyph("ready")).toBe("(○ READY)");
    expect(formatStatusBadge("active")).toBe("[● ACTIVE]");

    const alloc = formatSubagentAllocation("impl_1", "val_1", "implementer");
    expect(alloc).toBe("[● IMPLEMENTER: impl_1 ──► VALIDATOR: val_1]");
    const singleImpl = formatSubagentAllocation("impl_2", null, "implementer");
    expect(singleImpl).toBe("[● IMPLEMENTER: impl_2]");
    const coords = formatCoordinates({ wave: 2, lane: 3 });
    expect(coords).toBe("[W2:L3]");
  });

  it("formats tracking lines and subagent expansion items", () => {
    const trkNode: SugiyamaNode = {
      ...node("TrkTask"),
      pushes: 2,
      probes: 1,
      attempt: 1,
      inLeaseRepairs: 0,
      coordinatorId: "coord_01",
      coordinatorOwnershipPct: 100,
    };
    const tracking = formatImplementerValidatorTracking(trkNode);
    expect(tracking.length).toBe(2);
    expect(tracking[0]).toContain("Pushes: 2/5");
    expect(tracking[1]).toContain("Coordinator: coord_01 (100%)");

    const badges = formatNodeBadges({
      ...node("BadgeTask"),
      implementerAgent: "worker_1",
      validatorAgent: "val_1",
      round: 2,
      probeRound: 1,
      effort: 5,
      criticalDepth: 2,
    });
    expect(badges).toContain("[I: worker_1]");
    expect(badges).toContain("[V: val_1]");
    expect(badges).toContain("[R2 P1]");
    expect(badges).toContain("W:5 S:3");

    const subtasks: SugiyamaSubtask[] = [
      { id: "sub_1", status: "completed", assignedAgent: "worker_1" },
      { id: "sub_2", status: "running", assignedAgent: "worker_2" },
    ];
    const expanded = renderSubagentExpandedItems(subtasks, "branch_01");
    expect(expanded.length).toBe(3);
    expect(expanded[0]).toContain("Dynamic Branch [branch_01]");
  });
});

describe("Sugiyama Rendering and Report Generation", () => {
  it("renders node box with rounded, sharp, and ascii border styles", () => {
    const boxNode: SugiyamaNode = node("BoxTask");
    expect(renderSugiyamaNodeBox(boxNode, { boxStyle: "rounded" })[0]?.startsWith("╭")).toBe(true);
    expect(renderSugiyamaNodeBox(boxNode, { boxStyle: "sharp" })[0]?.startsWith("┌")).toBe(true);
    expect(renderSugiyamaNodeBox(boxNode, { boxStyle: "ascii" })[0]?.startsWith("+")).toBe(true);
    expect(renderRoundedNodeBox(boxNode)[0]?.startsWith("╭")).toBe(true);
  });

  it("handles empty node set during DAG rendering", () => {
    const emptyRender = renderSugiyamaDag([], []);
    expect(emptyRender.renderedDag).toContain("No tasks declared");
    expect(emptyRender.layers.length).toBe(0);
  });

  it("renders multi-layer DAG and generates complete report", () => {
    const nodes = [
      node("T_Start"),
      node("T_Mid1", ["T_Start"]),
      node("T_Mid2", ["T_Start"]),
      node("T_End", ["T_Mid1", "T_Mid2"]),
    ];
    const edges: SugiyamaEdge[] = [
      { from: "T_Start", to: "T_Mid1" },
      { from: "T_Start", to: "T_Mid2" },
      { from: "T_Mid1", to: "T_End" },
      { from: "T_Mid2", to: "T_End" },
    ];
    const dagResult = renderSugiyamaDag(nodes, edges);
    expect(dagResult.layers.length).toBe(3);
    expect(dagResult.rankedNodes.length).toBe(4);
    expect(dagResult.renderedDag).toContain("WAVE 1");
    expect(dagResult.renderedDag).toContain("WAVE 2");
    expect(dagResult.renderedDag).toContain("WAVE 3");

    const report = generateSugiyamaDagReport(nodes, edges, {
      runId: "test-run-001",
      maxParallel: 4,
    });
    expect(report.totalTasks).toBe(4);
    expect(report.totalLayers).toBe(3);
    expect(report.metrics.totalWaves).toBe(3);
    expect(report.markdown).toContain("### Sugiyama Hierarchical DAG Visualization: test-run-001");
    expect(buildSugiyamaDagReport(nodes, edges).totalTasks).toBe(4);
  });
});
