import { HarnessError } from "../../core/errors/index.ts";
import { isRecord } from "../../requirements/predicates.ts";
import { normalizeScopePath } from "../scope-analyzer.ts";
import { jsonCopy } from "../plan-contract.ts";
import { detectTransitiveBypasses } from "./bypass-detector.ts";
import { allocateTaskElements } from "./subtask-allocator.ts";
import type {
  DeeperExpansionRequest,
  DynamicExpansionOptions,
  DynamicExpansionResult,
} from "./types.ts";

export function expandDeeper(
  graph: Record<string, unknown>,
  request: DeeperExpansionRequest,
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

  const parentNode = nodes.find(
    (n) => isRecord(n) && n.type === "task" && n.id === request.parentTaskId,
  );
  if (!parentNode) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `parent task '${request.parentTaskId}' not found in graph for deeper expansion`,
    );
  }

  if (request.subtasks.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `deeper expansion of '${request.parentTaskId}' requires at least one subtask decomposition`,
    );
  }

  const parentWriteScope = Array.isArray(parentNode.write_scope)
    ? (parentNode.write_scope as string[]).map(normalizeScopePath)
    : [];

  const allowGrowth = options.allowScopeGrowth ?? false;
  if (!allowGrowth) {
    for (const sub of request.subtasks) {
      const subScopes = sub.writeScope.map(normalizeScopePath);
      for (const s of subScopes) {
        const withinParent = parentWriteScope.some(
          (p) => s === p || s.startsWith(`${p}/`) || p === ".",
        );
        if (!withinParent) {
          throw new HarnessError(
            "INTEGRITY",
            `subtask '${sub.id}' write scope '${s}' exceeds parent scope [${parentWriteScope.join(", ")}]; deeper expansion must stay confined or set allowScopeGrowth=true`,
          );
        }
      }
    }
  }

  const addedTasks: Record<string, unknown>[] = [];
  const addedEdges: Record<string, unknown>[] = [];
  const addedGates: Record<string, unknown>[] = [];
  const pairedTasks: { implementerTaskId: string; validatorTaskId: string }[] = [];
  const warnings: string[] = [];

  const parentReqIds =
    Array.isArray(parentNode.requirement_ids) && (parentNode.requirement_ids as string[]).length > 0
      ? (parentNode.requirement_ids as string[])
      : [`req-${request.parentTaskId.replace(/^task-?/, "")}`];

  const parentPrereqs: string[] = [];
  const parentDownstreamTasks: string[] = [];

  for (const edge of edges) {
    if (isRecord(edge) && edge.type === "depends_on") {
      if (edge.source === request.parentTaskId && typeof edge.target === "string") {
        parentPrereqs.push(edge.target);
      }
      if (edge.target === request.parentTaskId && typeof edge.source === "string") {
        parentDownstreamTasks.push(edge.source);
      }
    }
  }

  const subtaskIds = new Set(request.subtasks.map((s) => s.id));
  const autoPair = request.autoPairValidators ?? true;
  const rewirePrereqs = request.rewirePrerequisites ?? true;
  const rewireDownstream = request.rewireDependents ?? true;

  let taskCounter = nodes.filter((n) => isRecord(n) && n.type === "task").length;

  for (let idx = 0; idx < request.subtasks.length; idx++) {
    const sub = request.subtasks[idx]!;
    const hasExplicitDeps = Array.isArray(sub.deps) && sub.deps.length > 0;
    const hasInheritedPrereqs =
      rewirePrereqs &&
      parentPrereqs.length > 0 &&
      (!sub.deps || sub.deps.filter((d) => subtaskIds.has(d)).length === 0);
    const initialStatus = hasExplicitDeps || hasInheritedPrereqs ? "proposed" : "ready";

    taskCounter += 1;
    const fallbackPriority = typeof parentNode.priority === "number" ? parentNode.priority : 50;

    const allocated = allocateTaskElements(
      sub,
      parentReqIds,
      fallbackPriority,
      1,
      "sub_implementer",
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

    for (const dep of sub.deps ?? []) {
      const depTarget = autoPair && subtaskIds.has(dep) ? `val-${dep.replace(/^task-?/, "")}` : dep;
      const subEdge: Record<string, unknown> = {
        source: sub.id,
        target: depTarget,
        type: "depends_on",
      };
      edges.push(subEdge);
      addedEdges.push(subEdge);
    }
  }

  if (rewirePrereqs && parentPrereqs.length > 0) {
    const initialSubtasks = request.subtasks.filter(
      (s) => !s.deps || s.deps.filter((d) => subtaskIds.has(d)).length === 0,
    );
    for (const initial of initialSubtasks) {
      for (const prereq of parentPrereqs) {
        const inheritedEdge: Record<string, unknown> = {
          source: initial.id,
          target: prereq,
          type: "depends_on",
        };
        edges.push(inheritedEdge);
        addedEdges.push(inheritedEdge);
      }
    }
  }

  if (rewireDownstream && parentDownstreamTasks.length > 0) {
    const dependedOnSubtasks = new Set<string>();
    for (const s of request.subtasks) {
      for (const d of s.deps ?? []) {
        if (subtaskIds.has(d)) dependedOnSubtasks.add(d);
      }
    }
    const terminalSubtasks = request.subtasks.filter((s) => !dependedOnSubtasks.has(s.id));
    const terminalTargets = terminalSubtasks.map((t) =>
      autoPair ? (t.validatorId ?? `val-${t.id.replace(/^task-?/, "")}`) : t.id,
    );

    for (const edge of edges) {
      if (isRecord(edge) && edge.type === "depends_on" && edge.target === request.parentTaskId) {
        if (terminalTargets.length > 0) {
          edge.target = terminalTargets[0]!;
          for (let i = 1; i < terminalTargets.length; i++) {
            const extraEdge: Record<string, unknown> = {
              source: edge.source,
              target: terminalTargets[i]!,
              type: "depends_on",
            };
            edges.push(extraEdge);
            addedEdges.push(extraEdge);
          }
        }
      }
    }
  }

  parentNode.status = "done";
  parentNode.decomposition_state = "expanded_deeper";
  parentNode.decomposed_subtasks = request.subtasks.map((s) => s.id);
  if (request.decompositionRationale) {
    parentNode.decomposition_rationale = request.decompositionRationale;
  }

  const decisionNode: Record<string, unknown> = {
    id: `decision-decompose-${request.parentTaskId}`,
    type: "decision",
    label: `Dynamic Deeper Decomposition of ${request.parentTaskId}`,
    superseded_task_id: request.parentTaskId,
    explanation:
      request.decompositionRationale ?? `Task decomposed into ${request.subtasks.length} subtasks`,
  };
  nodes.push(decisionNode);

  const supersedesEdge: Record<string, unknown> = {
    source: request.subtasks[0]!.id,
    target: decisionNode.id,
    type: "supersedes",
  };
  edges.push(supersedesEdge);

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
      `Dynamic expansion failed bypass validation: ${firstBypass.reason}. Cognitive guidance: ${firstBypass.guidance.remediationAction}`,
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
