import { describe, expect, it } from "bun:test";
import {
  assignSugiyamaRanks,
  barycentricSort,
  boundLayerWidthCoffmanGraham,
  computeLexicographicLabels,
  countLayerCrossings,
  detectCyclesTarjan,
  detectIllegalBypasses,
  extractFeedbackArcSet,
  minimizeCrossingsBarycenter,
  reverseCycleEdges,
  validateDiagnosticHealth,
  type SugiyamaEdge,
  type SugiyamaLayer,
  type SugiyamaNode,
  type SugiyamaRankedNode,
} from "../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

function node(id: string, deps: readonly string[] = [], status = "ready"): SugiyamaNode {
  return { id, label: `Task ${id}`, status, dependencies: deps };
}

describe("Sugiyama Ranking and Width Bounding", () => {
  it("computes topological longest path ranks accurately", () => {
    const nodes = [node("A"), node("B", ["A"]), node("C", ["A"]), node("D", ["B", "C"])];
    const edges: SugiyamaEdge[] = [
      { from: "A", to: "B" },
      { from: "A", to: "C" },
      { from: "B", to: "D" },
      { from: "C", to: "D" },
    ];
    const ranks = assignSugiyamaRanks(nodes, edges);
    expect(ranks.get("A")).toBe(0);
    expect(ranks.get("B")).toBe(1);
    expect(ranks.get("C")).toBe(1);
    expect(ranks.get("D")).toBe(2);
  });

  it("computes deterministic lexicographical labels for scheduling", () => {
    const nodes = [node("T1"), node("T2", ["T1"]), node("T3", ["T1"])];
    const edges: SugiyamaEdge[] = [
      { from: "T1", to: "T2" },
      { from: "T1", to: "T3" },
    ];
    const labels = computeLexicographicLabels(nodes, edges);
    expect(labels.size).toBe(3);
    expect(labels.has("T1")).toBe(true);
    expect(labels.has("T2")).toBe(true);
    expect(labels.has("T3")).toBe(true);
  });

  it("bounds layer width with Coffman-Graham algorithm", () => {
    const nodes = [node("N1"), node("N2"), node("N3"), node("N4"), node("N5")];
    const bounded = boundLayerWidthCoffmanGraham(nodes, [], 2);
    const layerCounts = new Map<number, number>();
    for (const rank of bounded.values()) {
      layerCounts.set(rank, (layerCounts.get(rank) ?? 0) + 1);
    }
    for (const count of layerCounts.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });
});

describe("Sugiyama Crossing Minimization", () => {
  it("counts layer crossings correctly for intersecting edges", () => {
    const layerA: SugiyamaRankedNode[] = [
      { ...node("A1"), rank: 0, order: 0 },
      { ...node("A2"), rank: 0, order: 1 },
    ];
    const layerB: SugiyamaRankedNode[] = [
      { ...node("B1"), rank: 1, order: 0 },
      { ...node("B2"), rank: 1, order: 1 },
    ];
    expect(
      countLayerCrossings(layerA, layerB, [
        { from: "A1", to: "B1" },
        { from: "A2", to: "B2" },
      ]),
    ).toBe(0);
    expect(
      countLayerCrossings(layerA, layerB, [
        { from: "A1", to: "B2" },
        { from: "A2", to: "B1" },
      ]),
    ).toBe(1);
  });

  it("sorts layer nodes using barycentric heuristic", () => {
    const refLayer: SugiyamaRankedNode[] = [
      { ...node("R1"), rank: 0, order: 0 },
      { ...node("R2"), rank: 0, order: 1 },
    ];
    const targetLayer: SugiyamaRankedNode[] = [
      { ...node("T1"), rank: 1, order: 0 },
      { ...node("T2"), rank: 1, order: 1 },
    ];
    const edges: SugiyamaEdge[] = [
      { from: "R1", to: "T2" },
      { from: "R2", to: "T1" },
    ];
    const sorted = barycentricSort(targetLayer, refLayer, edges, "down");
    expect(sorted[0]?.id).toBe("T2");
    expect(sorted[1]?.id).toBe("T1");
  });

  it("minimizes crossings across multiple layers with barycenter sweep", () => {
    const layers: SugiyamaLayer[] = [
      {
        rank: 0,
        nodes: [
          { ...node("L0_1"), rank: 0, order: 0 },
          { ...node("L0_2"), rank: 0, order: 1 },
        ],
      },
      {
        rank: 1,
        nodes: [
          { ...node("L1_1"), rank: 1, order: 0 },
          { ...node("L1_2"), rank: 1, order: 1 },
        ],
      },
    ];
    const edges: SugiyamaEdge[] = [
      { from: "L0_1", to: "L1_2" },
      { from: "L0_2", to: "L1_1" },
    ];
    const optimized = minimizeCrossingsBarycenter(layers, edges, 4);
    expect(optimized.length).toBe(2);
    expect(countLayerCrossings(optimized[0]!.nodes, optimized[1]!.nodes, edges)).toBe(0);
  });
});

describe("Sugiyama Tarjan Cycle and Diagnostics", () => {
  it("detects cycles and returns remediation advice", () => {
    const nodes = [node("C1"), node("C2")];
    const edges: SugiyamaEdge[] = [
      { from: "C1", to: "C2" },
      { from: "C2", to: "C1" },
    ];
    const diag = detectCyclesTarjan(nodes, edges);
    expect(diag.hasCycle).toBe(true);
    expect(diag.cyclePaths.length).toBeGreaterThan(0);
    expect(diag.alert).toContain("POISONOUS CYCLE");
  });

  it("extracts feedback arc sets and reverses cycle edges", () => {
    const nodes = [node("X"), node("Y")];
    const edges: SugiyamaEdge[] = [
      { from: "X", to: "Y" },
      { from: "Y", to: "X" },
    ];
    const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
    expect(feedbackArcs.length).toBe(1);
    expect(acyclicEdges.length).toBe(1);
    const reversed = reverseCycleEdges(edges, feedbackArcs);
    expect(reversed.length).toBe(2);
  });

  it("detects illegal transitive bypass edges", () => {
    const nodes = [node("Step1"), node("Step2"), node("Step3")];
    const edges: SugiyamaEdge[] = [
      { from: "Step1", to: "Step2" },
      { from: "Step2", to: "Step3" },
      { from: "Step1", to: "Step3" },
    ];
    const bypassDiag = detectIllegalBypasses(nodes, edges);
    expect(bypassDiag.hasBypass).toBe(true);
    expect(bypassDiag.bypasses.length).toBe(1);
    expect(bypassDiag.bypasses[0]?.from).toBe("Step1");
    expect(bypassDiag.bypasses[0]?.to).toBe("Step3");
  });

  it("validates diagnostic health for clean and unhealthy graphs", () => {
    const cleanNodes = [node("P1"), node("P2", ["P1"])];
    const cleanEdges: SugiyamaEdge[] = [{ from: "P1", to: "P2" }];
    const cleanHealth = validateDiagnosticHealth(cleanNodes, cleanEdges);
    expect(cleanHealth.healthy).toBe(true);
    expect(cleanHealth.cycleCount).toBe(0);

    const badNodes = [node("B1"), node("B2")];
    const badEdges: SugiyamaEdge[] = [
      { from: "B1", to: "B2" },
      { from: "B2", to: "B1" },
    ];
    const badHealth = validateDiagnosticHealth(badNodes, badEdges);
    expect(badHealth.healthy).toBe(false);
    expect(badHealth.cycleCount).toBeGreaterThan(0);
  });
});
