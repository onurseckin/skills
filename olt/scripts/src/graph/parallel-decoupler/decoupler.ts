import { isNonblank, isRecord } from "../../requirements/predicates.ts";
import {
  checkScopeOverlap,
  computeConcurrencyWaves,
  normalizeScopePath,
  type TaskScopeInput,
} from "../scope-analyzer.ts";
import { allocateParallelLanes, partitionDynamicLanes } from "./lane-allocator.ts";
import { computeWorkSpanMetrics } from "./metrics.ts";
import {
  ARTIFICIAL_SERIALIZATION_WARNING,
  type ArtificialSerializationWarning,
  type DecoupleOptions,
  type DecoupledGraphResult,
  type ParsedEdgeInfo,
  type ParsedTaskInfo,
} from "./types.ts";

export { allocateParallelLanes, partitionDynamicLanes };

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) result.push(item.trim());
  }
  return result;
}

function extractDepReasons(node: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  const reasons = node.depReasons ?? node.dep_reasons;
  if (isRecord(reasons)) {
    for (const [key, val] of Object.entries(reasons)) {
      if (typeof val === "string" && val.trim().length > 0) result[key] = val.trim();
    }
  }
  return result;
}

function extractEdgeJustification(
  edge: Record<string, unknown>,
  sourceTask?: ParsedTaskInfo,
): string | undefined {
  const direct = edge.dataflow_justification ?? edge.justification ?? edge.reason ?? edge.dataflow;
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  if (sourceTask && typeof edge.target === "string") {
    const fromTask = sourceTask.depReasons[edge.target];
    if (typeof fromTask === "string" && fromTask.trim().length > 0) return fromTask.trim();
  }
  return undefined;
}

export function decoupleDisjointTasks(
  graphInput: unknown,
  options: DecoupleOptions = {},
): DecoupledGraphResult {
  const maxLanes = options.maxLanes ?? 40;
  const defaultEffort = options.defaultEffort ?? 1;
  const preserveJustified = options.preserveJustified ?? true;
  if (!isRecord(graphInput)) {
    return {
      graph: {},
      decoupledEdges: [],
      warnings: [],
      metrics: {
        totalWork: 0,
        criticalSpan: 0,
        parallelismFactor: 0,
        optimalLanes: 1,
        maxSupportedLanes: maxLanes,
        efficiency: 0,
      },
      waves: [],
      lanes: [],
    };
  }
  const rawNodes = Array.isArray(graphInput.nodes) ? graphInput.nodes : [];
  const rawEdges = Array.isArray(graphInput.edges) ? graphInput.edges : [];
  const taskMap = new Map<string, ParsedTaskInfo>();
  const parsedTasks: ParsedTaskInfo[] = [];
  for (const node of rawNodes) {
    if (
      isRecord(node) &&
      (node.type === "task" || (node.type === undefined && typeof node.id === "string"))
    ) {
      const id = String(node.id ?? "");
      if (!id) continue;
      const rawScopes = extractStringArray(node.write_scope ?? node.writeScope);
      const effort =
        typeof node.effort === "number" && node.effort > 0 ? node.effort : defaultEffort;
      const status = typeof node.status === "string" ? node.status : "proposed";
      const depReasons = extractDepReasons(node);
      const taskInfo: ParsedTaskInfo = {
        id,
        writeScope: rawScopes.map(normalizeScopePath),
        effort,
        status,
        depReasons,
        rawNode: structuredClone(node),
      };
      taskMap.set(id, taskInfo);
      parsedTasks.push(taskInfo);
    }
  }
  const parsedEdges: ParsedEdgeInfo[] = [];
  for (const edge of rawEdges) {
    if (isRecord(edge) && typeof edge.source === "string" && typeof edge.target === "string") {
      const sourceTask = taskMap.get(edge.source);
      const justification = extractEdgeJustification(edge, sourceTask);
      parsedEdges.push({
        source: edge.source,
        target: edge.target,
        type: typeof edge.type === "string" ? edge.type : "depends_on",
        justification,
        rawEdge: structuredClone(edge),
      });
    }
  }
  const warnings: ArtificialSerializationWarning[] = [];
  const decoupledEdges: { source: string; target: string }[] = [];
  const keptEdges: ParsedEdgeInfo[] = [];
  for (const edge of parsedEdges) {
    if (edge.type !== "depends_on") {
      keptEdges.push(edge);
      continue;
    }
    const sourceTask = taskMap.get(edge.source);
    const targetTask = taskMap.get(edge.target);
    if (!sourceTask || !targetTask) {
      keptEdges.push(edge);
      continue;
    }
    const overlap = checkScopeOverlap(sourceTask.writeScope, targetTask.writeScope);
    const hasJustification = isNonblank(edge.justification);
    if (!overlap.hasOverlap) {
      const isArtificial = !hasJustification || !preserveJustified;
      warnings.push({
        code: ARTIFICIAL_SERIALIZATION_WARNING,
        blockedTask: edge.source,
        dependencyTask: edge.target,
        message:
          `Task ${edge.source} is artificially serialized behind ${edge.target} with disjoint write scopes ([${sourceTask.writeScope.join(", ")}] vs [${targetTask.writeScope.join(", ")}])` +
          (hasJustification
            ? ` with declared justification: '${edge.justification}'.`
            : " and no dataflow justification."),
        dataflowJustified: hasJustification,
        sourceScope: sourceTask.writeScope,
        targetScope: targetTask.writeScope,
      });
      if (isArtificial) {
        decoupledEdges.push({ source: edge.source, target: edge.target });
        continue;
      }
    }
    keptEdges.push(edge);
  }
  const decoupledDepsMap = new Map<string, Set<string>>();
  for (const task of parsedTasks) decoupledDepsMap.set(task.id, new Set());
  for (const edge of keptEdges) {
    if (edge.type === "depends_on" && decoupledDepsMap.has(edge.source))
      decoupledDepsMap.get(edge.source)!.add(edge.target);
  }
  const updatedNodes = rawNodes.map((rawNode) => {
    if (!isRecord(rawNode) || typeof rawNode.id !== "string") return structuredClone(rawNode);
    const cloned = structuredClone(rawNode);
    const taskId = rawNode.id;
    const task = taskMap.get(taskId);
    if (task) {
      const rem = decoupledDepsMap.get(taskId) ?? new Set();
      if (task.status === "proposed" && rem.size === 0) cloned.status = "ready";
    }
    return cloned;
  });
  const updatedEdges = keptEdges.map((e) => e.rawEdge);
  const newGraph: Record<string, unknown> = {
    ...structuredClone(graphInput),
    nodes: updatedNodes,
    edges: updatedEdges,
  };
  const taskScopeInputs: TaskScopeInput[] = parsedTasks.map((t) => ({
    taskId: t.id,
    writeScope: t.writeScope,
    dependencies: [...(decoupledDepsMap.get(t.id) ?? [])],
  }));
  const waves = computeConcurrencyWaves(taskScopeInputs, decoupledDepsMap);
  const lanes = allocateParallelLanes(taskScopeInputs, decoupledDepsMap, maxLanes);
  const metrics = computeWorkSpanMetrics(
    parsedTasks.map((t) => ({ id: t.id, effort: t.effort })),
    decoupledDepsMap,
    maxLanes,
  );
  return { graph: newGraph, decoupledEdges, warnings, metrics, waves, lanes };
}
