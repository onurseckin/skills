import { HarnessError } from "../../core/errors/index.ts";
import { isRecord } from "../../requirements/predicates.ts";
import { validateGraph } from "../validate-graph.ts";
import { jsonCopy } from "../plan-contract.ts";
import { detectTransitiveBypasses } from "./bypass-detector.ts";
import { allocateTaskElements } from "./subtask-allocator.ts";
import { expandDeeper } from "./task-decomposition.ts";
import type {
  BypassViolation,
  CognitiveGuidance,
  DeeperExpansionRequest,
  DynamicExpansionOptions,
  DynamicExpansionPlan,
  DynamicExpansionResult,
  WiderExpansionRequest,
} from "./types.ts";

export function expandWider(
  graph: Record<string, unknown>,
  request: WiderExpansionRequest,
  options: DynamicExpansionOptions = {},
): DynamicExpansionResult {
  const currentGraph = jsonCopy(graph);
  const nodes = Array.isArray(currentGraph.nodes)
    ? (currentGraph.nodes as Record<string, unknown>[])
    : [];
  const edges = Array.isArray(currentGraph.edges)
    ? (currentGraph.edges as Record<string, unknown>[])
    : [];
  const gates = Array.isArray(currentGraph.gates)
    ? (currentGraph.gates as Record<string, unknown>[])
    : [];

  if (request.newTasks.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "wider expansion requires at least one task to admit",
    );
  }

  const existingTaskIds = new Set(
    nodes.filter((n) => isRecord(n) && n.type === "task").map((n) => String(n.id)),
  );

  for (const t of request.newTasks) {
    if (existingTaskIds.has(t.id)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `cannot admit task '${t.id}'; task ID already exists in graph`,
      );
    }
  }

  const existingReqIds = nodes
    .filter((n) => isRecord(n) && n.type === "requirement" && typeof n.requirement_id === "string")
    .map((n) => String(n.requirement_id));
  const fallbackReqId = existingReqIds.length > 0 ? existingReqIds[0]! : "req-1";

  const addedTasks: Record<string, unknown>[] = [];
  const addedEdges: Record<string, unknown>[] = [];
  const addedGates: Record<string, unknown>[] = [];
  const pairedTasks: { implementerTaskId: string; validatorTaskId: string }[] = [];
  const warnings: string[] = [];

  const autoPair = request.autoPairValidators ?? true;
  let taskCounter = nodes.filter((n) => isRecord(n) && n.type === "task").length;

  for (const task of request.newTasks) {
    taskCounter += 1;
    const initialStatus = task.deps && task.deps.length > 0 ? "proposed" : "ready";

    const allocated = allocateTaskElements(
      task,
      [fallbackReqId],
      50,
      2,
      "implementer",
      initialStatus,
      autoPair,
      taskCounter,
    );
    taskCounter = allocated.nextOrder;

    nodes.push(...allocated.nodes);
    edges.push(...allocated.edges);
    gates.push(...allocated.gates);
    addedTasks.push(...allocated.addedTasks);
    addedEdges.push(...allocated.addedEdges);
    addedGates.push(...allocated.addedGates);
    if (allocated.pairedTask) {
      pairedTasks.push(allocated.pairedTask);
    }

    for (const dep of task.deps ?? []) {
      const depTarget =
        autoPair &&
        existingTaskIds.has(dep) &&
        nodes.some((n) => n.id === `val-${dep.replace(/^task-?/, "")}`)
          ? `val-${dep.replace(/^task-?/, "")}`
          : dep;
      const edge: Record<string, unknown> = {
        source: task.id,
        target: depTarget,
        type: "depends_on",
      };
      if (task.depReasons?.[dep]) {
        edge.dataflow_justification = task.depReasons[dep];
      }
      edges.push(edge);
      addedEdges.push(edge);
    }
  }

  const nextRevision =
    options.revision ?? (typeof currentGraph.revision === "number" ? currentGraph.revision + 1 : 2);
  currentGraph.revision = nextRevision;
  currentGraph.nodes = nodes;
  currentGraph.edges = edges;
  currentGraph.gates = gates;

  const bypassResult = detectTransitiveBypasses(nodes, edges);
  if ((options.strictBypassCheck ?? true) && bypassResult.hasBypass) {
    const firstBypass = bypassResult.violations[0]!;
    throw new HarnessError(
      "INTEGRITY",
      `Dynamic wider expansion failed bypass validation: ${firstBypass.reason}. Cognitive guidance: ${firstBypass.guidance.remediationAction}`,
    );
  }

  return {
    success: true,
    graphDocument: currentGraph,
    addedTasks,
    addedEdges,
    addedGates,
    pairedTasks,
    bypassViolations: bypassResult.violations,
    cognitiveGuidance: bypassResult.violations.map((v) => v.guidance),
    revision: nextRevision,
    warnings: [...warnings, ...bypassResult.warnings],
  };
}

function isDeeperRequest(request: unknown): request is DeeperExpansionRequest {
  return (
    isRecord(request) && typeof request.parentTaskId === "string" && Array.isArray(request.subtasks)
  );
}

function isWiderRequest(request: unknown): request is WiderExpansionRequest {
  return isRecord(request) && Array.isArray(request.newTasks);
}

export function expandDynamicPlan(
  currentGraph: Record<string, unknown>,
  expansion: DynamicExpansionPlan | DeeperExpansionRequest | WiderExpansionRequest,
  requirementsDocument?: Record<string, unknown>,
  options: DynamicExpansionOptions = {},
): DynamicExpansionResult {
  let workingGraph = jsonCopy(currentGraph);
  const allAddedTasks: Record<string, unknown>[] = [];
  const allAddedEdges: Record<string, unknown>[] = [];
  const allAddedGates: Record<string, unknown>[] = [];
  const allPairedTasks: { implementerTaskId: string; validatorTaskId: string }[] = [];
  const allWarnings: string[] = [];
  const allViolations: BypassViolation[] = [];
  const allGuidance: CognitiveGuidance[] = [];

  let nextRevision =
    options.revision ?? (typeof workingGraph.revision === "number" ? workingGraph.revision + 1 : 2);

  if (isDeeperRequest(expansion)) {
    const res = expandDeeper(workingGraph, expansion, { ...options, revision: nextRevision });
    workingGraph = res.graphDocument;
    allAddedTasks.push(...res.addedTasks);
    allAddedEdges.push(...res.addedEdges);
    allAddedGates.push(...res.addedGates);
    allPairedTasks.push(...res.pairedTasks);
    allWarnings.push(...res.warnings);
    allViolations.push(...res.bypassViolations);
    allGuidance.push(...res.cognitiveGuidance);
    nextRevision = res.revision;
  } else if (isWiderRequest(expansion)) {
    const res = expandWider(workingGraph, expansion, { ...options, revision: nextRevision });
    workingGraph = res.graphDocument;
    allAddedTasks.push(...res.addedTasks);
    allAddedEdges.push(...res.addedEdges);
    allAddedGates.push(...res.addedGates);
    allPairedTasks.push(...res.pairedTasks);
    allWarnings.push(...res.warnings);
    allViolations.push(...res.bypassViolations);
    allGuidance.push(...res.cognitiveGuidance);
    nextRevision = res.revision;
  } else if (isRecord(expansion)) {
    const plan = expansion as DynamicExpansionPlan;
    if (plan.deeper) {
      for (const deepReq of plan.deeper) {
        const res = expandDeeper(workingGraph, deepReq, { ...options, revision: nextRevision });
        workingGraph = res.graphDocument;
        allAddedTasks.push(...res.addedTasks);
        allAddedEdges.push(...res.addedEdges);
        allAddedGates.push(...res.addedGates);
        allPairedTasks.push(...res.pairedTasks);
        allWarnings.push(...res.warnings);
        allViolations.push(...res.bypassViolations);
        allGuidance.push(...res.cognitiveGuidance);
      }
    }
    if (plan.wider) {
      for (const wideReq of plan.wider) {
        const res = expandWider(workingGraph, wideReq, { ...options, revision: nextRevision });
        workingGraph = res.graphDocument;
        allAddedTasks.push(...res.addedTasks);
        allAddedEdges.push(...res.addedEdges);
        allAddedGates.push(...res.addedGates);
        allPairedTasks.push(...res.pairedTasks);
        allWarnings.push(...res.warnings);
        allViolations.push(...res.bypassViolations);
        allGuidance.push(...res.cognitiveGuidance);
      }
    }
  }

  if (requirementsDocument) {
    const issues = validateGraph(workingGraph, requirementsDocument, {
      allowRuntimeStatuses: true,
    });
    if (issues.length > 0) {
      throw new HarnessError(
        "INTEGRITY",
        `dynamic expansion resulted in invalid graph: ${issues.join("; ")}`,
      );
    }
  }

  return {
    success: true,
    graphDocument: workingGraph,
    addedTasks: allAddedTasks,
    addedEdges: allAddedEdges,
    addedGates: allAddedGates,
    pairedTasks: allPairedTasks,
    bypassViolations: allViolations,
    cognitiveGuidance: allGuidance,
    revision: nextRevision,
    warnings: allWarnings,
  };
}
