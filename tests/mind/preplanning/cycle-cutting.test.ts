import { describe, expect, test } from "bun:test";
import {
  detectCyclesTarjan,
  detectIllegalBypasses,
  extractFeedbackArcSet,
  reverseCycleEdges,
} from "../../../olt/scripts/src/reporting/sugiyama-dag/tarjan.ts";
import type {
  SugiyamaEdge,
  SugiyamaNode,
} from "../../../olt/scripts/src/reporting/sugiyama-dag/types.ts";
import { compileSmartTasksToWavePlan } from "../../../olt/scripts/src/mind/tasks/smart/planner/waves.ts";
import type { SmartTaskPlan } from "../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";

describe("Mind Strategic Tarjan SCC Cycle-Cutting & Acyclic Wave Partitioning", () => {
  test("detects and diagnoses simple 3-node cyclic graph", () => {
    const nodes: SugiyamaNode[] = [
      { id: "task-a", label: "Task A" },
      { id: "task-b", label: "Task B" },
      { id: "task-c", label: "Task C" },
    ];
    const edges: SugiyamaEdge[] = [
      { from: "task-a", to: "task-b" },
      { from: "task-b", to: "task-c" },
      { from: "task-c", to: "task-a" },
    ];

    const diag = detectCyclesTarjan(nodes, edges);
    expect(diag.hasCycle).toBe(true);
    expect(diag.cycleNodeIds.sort()).toEqual(["task-a", "task-b", "task-c"]);
    expect(diag.alert).toContain("POISONOUS CYCLE");
    expect(diag.remediation.length).toBeGreaterThanOrEqual(1);

    const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
    expect(feedbackArcs.length).toBe(1);
    expect(acyclicEdges.length).toBe(2);

    const acyclicDiag = detectCyclesTarjan(nodes, acyclicEdges);
    expect(acyclicDiag.hasCycle).toBe(false);
  });

  test("isolates self-dependency loops into single-node SCCs and provides remediation", () => {
    const nodes: SugiyamaNode[] = [
      { id: "task-self", label: "Self Task" },
      { id: "task-other", label: "Other Task" },
    ];
    const edges: SugiyamaEdge[] = [
      { from: "task-self", to: "task-self" },
      { from: "task-self", to: "task-other" },
    ];

    const diag = detectCyclesTarjan(nodes, edges);
    expect(diag.hasCycle).toBe(true);
    expect(diag.cycleNodeIds).toContain("task-self");
    expect(diag.remediation.some((r) => r.includes("Drop self-dependency"))).toBe(true);

    const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
    expect(feedbackArcs).toEqual([{ from: "task-self", to: "task-self" }]);
    expect(acyclicEdges).toEqual([{ from: "task-self", to: "task-other" }]);

    const checkAfterCut = detectCyclesTarjan(nodes, acyclicEdges);
    expect(checkAfterCut.hasCycle).toBe(false);
  });

  test("resolves interconnected multi-cycle figure-8 graph via FAS extraction", () => {
    const nodes: SugiyamaNode[] = [
      { id: "n1", label: "N1" },
      { id: "n2", label: "N2" },
      { id: "pivot", label: "Pivot" },
      { id: "n3", label: "N3" },
      { id: "n4", label: "N4" },
    ];
    const edges: SugiyamaEdge[] = [
      { from: "n1", to: "n2" },
      { from: "n2", to: "pivot" },
      { from: "pivot", to: "n1" },
      { from: "pivot", to: "n3" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "pivot" },
    ];

    const initialDiag = detectCyclesTarjan(nodes, edges);
    expect(initialDiag.hasCycle).toBe(true);
    expect(initialDiag.cycleNodeIds.length).toBe(5);

    const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
    expect(feedbackArcs.length).toBeGreaterThanOrEqual(1);

    const postCutDiag = detectCyclesTarjan(nodes, acyclicEdges);
    expect(postCutDiag.hasCycle).toBe(false);
  });

  test("reverseCycleEdges flips back-edges to form topologically valid DAG", () => {
    const nodes: SugiyamaNode[] = [
      { id: "v1", label: "V1" },
      { id: "v2", label: "V2" },
      { id: "v3", label: "V3" },
    ];
    const edges: SugiyamaEdge[] = [
      { from: "v1", to: "v2" },
      { from: "v2", to: "v3" },
      { from: "v3", to: "v1" },
    ];

    const { feedbackArcs } = extractFeedbackArcSet(nodes, edges);
    const reversed = reverseCycleEdges(edges, feedbackArcs);
    expect(reversed.length).toBe(3);

    const reversedDiag = detectCyclesTarjan(nodes, reversed);
    expect(reversedDiag.hasCycle).toBe(false);
  });

  test("synthesizes acyclic wave execution partition following cycle-cutting", () => {
    const rawCyclicTasks: readonly SmartTaskPlan[] = [
      {
        id: "step-1",
        title: "Step 1",
        tier: 3,
        estimated_duration_seconds: 45,
        write_scope: ["src/step1.ts"],
        dependencies: ["step-3"],
        gate: "G1",
      },
      {
        id: "step-2",
        title: "Step 2",
        tier: 3,
        estimated_duration_seconds: 45,
        write_scope: ["src/step2.ts"],
        dependencies: ["step-1"],
        gate: "G1",
      },
      {
        id: "step-3",
        title: "Step 3",
        tier: 3,
        estimated_duration_seconds: 45,
        write_scope: ["src/step3.ts"],
        dependencies: ["step-2"],
        gate: "G1",
      },
    ];

    const nodes: SugiyamaNode[] = rawCyclicTasks.map((t) => ({ id: t.id, label: t.title }));
    const edges: SugiyamaEdge[] = [];
    for (const t of rawCyclicTasks) {
      for (const d of t.dependencies) {
        edges.push({ from: d, to: t.id });
      }
    }

    const { feedbackArcs } = extractFeedbackArcSet(nodes, edges);
    expect(feedbackArcs.length).toBe(1);

    const cutEdgeSet = new Set(feedbackArcs.map((fa) => `${fa.from}->${fa.to}`));
    const remediatedTasks: SmartTaskPlan[] = rawCyclicTasks.map((task) => ({
      ...task,
      dependencies: task.dependencies.filter((dep) => !cutEdgeSet.has(`${dep}->${task.id}`)),
    }));

    const waveResult = compileSmartTasksToWavePlan(remediatedTasks);
    expect(waveResult.total_tasks).toBe(3);
    expect(waveResult.waves.length).toBe(3);
    expect(waveResult.waves[0]!.task_ids).toContain("step-1");
    expect(waveResult.waves[1]!.task_ids).toContain("step-2");
    expect(waveResult.waves[2]!.task_ids).toContain("step-3");
    expect(waveResult.macro_metrics.span).toBe(3);
    expect(waveResult.macro_metrics.parallelism).toBe(1);
  });

  test("detects illegal transitive bypass edges across layered subgraphs", () => {
    const nodes: SugiyamaNode[] = [
      { id: "layer-1", label: "Layer 1" },
      { id: "layer-2", label: "Layer 2" },
      { id: "layer-3", label: "Layer 3" },
    ];
    const edges: SugiyamaEdge[] = [
      { from: "layer-1", to: "layer-2" },
      { from: "layer-2", to: "layer-3" },
      { from: "layer-1", to: "layer-3" },
    ];

    const bypassResult = detectIllegalBypasses(nodes, edges);
    expect(bypassResult.hasBypass).toBe(true);
    expect(bypassResult.bypassEdges.length).toBe(1);
    expect(bypassResult.bypassEdges[0]!).toEqual({ from: "layer-1", to: "layer-3" });
    expect(bypassResult.alert).toContain("BYPASS DETECTED");
  });

  test("preserves forward critical paths and multi-branch DAG topology while severing cycle back-edges", () => {
    // Pipeline: start -> b1 -> join -> end
    //           start -> b2 -> join -> end
    // Back-edge: join -> start (poisonous cycle)
    const nodes: SugiyamaNode[] = [
      { id: "start", label: "Start" },
      { id: "b1", label: "Branch 1" },
      { id: "b2", label: "Branch 2" },
      { id: "join", label: "Join" },
      { id: "end", label: "End" },
    ];
    const edges: SugiyamaEdge[] = [
      { from: "start", to: "b1" },
      { from: "start", to: "b2" },
      { from: "b1", to: "join" },
      { from: "b2", to: "join" },
      { from: "join", to: "end" },
      { from: "join", to: "start" }, // Back-edge
    ];

    const diag = detectCyclesTarjan(nodes, edges);
    expect(diag.hasCycle).toBe(true);

    const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
    expect(feedbackArcs).toEqual([{ from: "join", to: "start" }]);
    expect(acyclicEdges.length).toBe(5);
    expect(acyclicEdges.some((e) => e.from === "start" && e.to === "b1")).toBe(true);
    expect(acyclicEdges.some((e) => e.from === "start" && e.to === "b2")).toBe(true);
    expect(acyclicEdges.some((e) => e.from === "b1" && e.to === "join")).toBe(true);
    expect(acyclicEdges.some((e) => e.from === "b2" && e.to === "join")).toBe(true);
    expect(acyclicEdges.some((e) => e.from === "join" && e.to === "end")).toBe(true);

    const checkDiag = detectCyclesTarjan(nodes, acyclicEdges);
    expect(checkDiag.hasCycle).toBe(false);
  });
});
