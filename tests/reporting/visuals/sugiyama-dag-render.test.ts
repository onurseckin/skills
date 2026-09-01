import { describe, expect, it } from "bun:test";
import {
  buildOrthogonalRouteSegments,
  buildSugiyamaDagReport,
  expandSubagentSubgraphs,
  formatImplementerValidatorTracking,
  formatNodeBadges,
  generateSugiyamaDagReport,
  renderLaneSeparator,
  renderOrthogonalConnectors,
  renderSubagentExpandedItems,
  renderSugiyamaDag,
  renderSugiyamaNodeBox,
  type DirectedGraph,
  type SubagentNode,
  type SugiyamaDag,
  type SugiyamaEdge,
  type SugiyamaLayer,
  type SugiyamaNode,
  type SugiyamaRankedNode,
  type SugiyamaSubtask,
} from "../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";

export const sugiyamaDagRenderSuiteName =
  "Sugiyama Visual DAG Rendering (Boxes, Routing, Markdown Reports)";

function createNode(id: string, deps: readonly string[] = [], status = "ready"): SugiyamaNode {
  return { id, label: `Task ${id}`, status, dependencies: deps };
}

describe(sugiyamaDagRenderSuiteName, () => {
  describe("Subagent Subgraph Expansion", () => {
    it("expands hierarchical child subagent clusters inside visual box containers", () => {
      const dag: SugiyamaDag = {
        nodes: [createNode("ParentTask1"), createNode("ParentTask2")],
        edges: [],
      };
      const subagents: SubagentNode[] = [
        {
          id: "sub_1",
          parentTaskId: "ParentTask1",
          label: "Subtask 1",
          status: "completed",
          role: "implementer",
          implementerAgent: "impl_01",
          validatorAgent: "val_01",
        },
        {
          id: "sub_2",
          parentTaskId: "ParentTask1",
          label: "Subtask 2",
          status: "running",
          role: "implementer",
          implementerAgent: "impl_02",
        },
      ];
      const expandedDag = expandSubagentSubgraphs(dag, subagents);
      expect(expandedDag.nodes.length).toBe(2);
      const parent1 = expandedDag.nodes.find((n) => n.id === "ParentTask1");
      expect(parent1?.expandedSubtasks?.length).toBe(2);
      const parent2 = expandedDag.nodes.find((n) => n.id === "ParentTask2");
      expect(parent2?.expandedSubtasks).toBeUndefined();
    });

    it("renders expanded subtask tree items cleanly", () => {
      const subtasks: SugiyamaSubtask[] = [
        { id: "step_a", status: "completed", implementerAgent: "worker_a" },
        { id: "step_b", status: "running", implementerAgent: "worker_b" },
      ];
      const rendered = renderSubagentExpandedItems(subtasks, "dyn_branch_1");
      expect(rendered.length).toBe(3);
      expect(rendered[0]).toContain("Dynamic Branch [dyn_branch_1]");
      expect(rendered[1]).toContain("[step_a]");
      expect(rendered[2]).toContain("[step_b]");
    });
  });

  describe("Routing, Box Rendering, and Full DAG Visualization", () => {
    it("builds orthogonal route segments and renders connectors", () => {
      const nodeMap = new Map<string, SugiyamaRankedNode>([
        ["Source", { ...createNode("Source"), rank: 0, order: 0, wave: 1, lane: 1 }],
        ["Target", { ...createNode("Target"), rank: 1, order: 0, wave: 2, lane: 1 }],
      ]);
      const edges: SugiyamaEdge[] = [{ from: "Source", to: "Target" }];
      const segments = buildOrthogonalRouteSegments(edges, nodeMap);
      expect(segments.length).toBe(1);
      expect(segments[0]?.fromWave).toBe(1);
      expect(segments[0]?.toWave).toBe(2);

      const layer1: SugiyamaLayer = { rank: 0, nodes: [nodeMap.get("Source")!] };
      const layer2: SugiyamaLayer = { rank: 1, nodes: [nodeMap.get("Target")!] };
      const connectors = renderOrthogonalConnectors(layer1, layer2, edges);
      expect(connectors.length).toBeGreaterThan(0);
      const laneSep = renderLaneSeparator();
      expect(laneSep.length).toBe(3);
    });

    it("renders node boxes with badges, coordinates, and tracking metrics", () => {
      const testNode: SugiyamaNode = {
        ...createNode("ComplexTask"),
        assignedAgent: "impl_worker_4",
        assignedRole: "implementer",
        validatorId: "val_worker_2",
        round: 2,
        probeRound: 1,
        pushes: 3,
        probes: 2,
        attempt: 1,
        inLeaseRepairs: 1,
        coordinatorId: "coord_01",
        coordinatorOwnershipPct: 100,
        effort: 8,
        criticalDepth: 3,
        wave: 2,
        lane: 1,
      };

      const box = renderSugiyamaNodeBox(testNode, { boxStyle: "rounded", detailed: true });
      expect(box.length).toBeGreaterThan(5);
      expect(box[0]?.startsWith("╭")).toBe(true);
      expect(box[box.length - 1]?.startsWith("╰")).toBe(true);

      const badges = formatNodeBadges(testNode);
      expect(badges).toContain("[I: impl_worker_4]");
      expect(badges).toContain("[V: val_worker_2]");
      expect(badges).toContain("[R2 P1]");
      expect(badges).toContain("W:8 S:4");

      const tracking = formatImplementerValidatorTracking(testNode);
      expect(tracking[0]).toContain("Pushes: 3/5 | Probes: 2/5");
    });

    it("renders DAG using DirectedGraph object overload", () => {
      const graph: DirectedGraph = {
        nodes: [createNode("NodeA"), createNode("NodeB", ["NodeA"])],
        edges: [{ from: "NodeA", to: "NodeB" }],
      };
      const result = renderSugiyamaDag(graph, { boxStyle: "sharp" });
      expect(result.layers.length).toBe(2);
      expect(result.rankedNodes.length).toBe(2);
      expect(result.renderedDag).toContain("WAVE 1");
      expect(result.renderedDag).toContain("WAVE 2");
    });

    it("generates full markdown report with metrics and summary", () => {
      const nodes = [
        createNode("TaskAlpha"),
        createNode("TaskBeta", ["TaskAlpha"]),
        createNode("TaskGamma", ["TaskAlpha"]),
        createNode("TaskDelta", ["TaskBeta", "TaskGamma"]),
      ];
      const edges: SugiyamaEdge[] = [
        { from: "TaskAlpha", to: "TaskBeta" },
        { from: "TaskAlpha", to: "TaskGamma" },
        { from: "TaskBeta", to: "TaskDelta" },
        { from: "TaskGamma", to: "TaskDelta" },
      ];
      const report = generateSugiyamaDagReport(nodes, edges, {
        runId: "pipeline-run-42",
        maxParallel: 4,
      });
      expect(report.totalTasks).toBe(4);
      expect(report.totalLayers).toBe(3);
      expect(report.metrics.totalWaves).toBe(3);
      expect(report.markdown).toContain(
        "### Sugiyama Hierarchical DAG Visualization: pipeline-run-42",
      );
      expect(buildSugiyamaDagReport(nodes, edges).totalTasks).toBe(4);
    });
  });
});
