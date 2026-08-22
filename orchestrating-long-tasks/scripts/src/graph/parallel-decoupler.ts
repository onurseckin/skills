import { isInteger, isNonblank, isRecord } from "../requirements/predicates.ts";
import {
  checkScopeOverlap,
  computeConcurrencyWaves,
  normalizeScopePath,
  type ConcurrencyWave,
  type TaskScopeInput,
} from "./scope-analyzer.ts";
import { downstreamMap, topologicalOrder, type DependencyMap } from "./topology.ts";

export const ARTIFICIAL_SERIALIZATION_WARNING = "ARTIFICIAL_SERIALIZATION_WARNING" as const;

export interface ArtificialSerializationWarning {
  readonly code: typeof ARTIFICIAL_SERIALIZATION_WARNING;
  readonly blockedTask: string;
  readonly dependencyTask: string;
  readonly message: string;
  readonly dataflowJustified: boolean;
  readonly sourceScope: readonly string[];
  readonly targetScope: readonly string[];
}

export interface ParallelMetrics {
  readonly totalWork: number;
  readonly criticalSpan: number;
  readonly parallelismFactor: number;
  readonly optimalLanes: number;
  readonly maxSupportedLanes: number;
}

export interface ParallelLaneAssignment {
  readonly laneIndex: number;
  readonly taskId: string;
  readonly waveIndex: number;
}

export interface DecoupleOptions {
  readonly maxLanes?: number;
  readonly defaultEffort?: number;
  readonly preserveJustified?: boolean;
}

export interface DecoupledGraphResult {
  readonly graph: Record<string, unknown>;
  readonly decoupledEdges: readonly { readonly source: string; readonly target: string }[];
  readonly warnings: readonly ArtificialSerializationWarning[];
  readonly metrics: ParallelMetrics;
  readonly waves: readonly ConcurrencyWave[];
  readonly lanes: readonly ParallelLaneAssignment[];
}

interface ParsedTaskInfo {
  readonly id: string;
  readonly writeScope: readonly string[];
  readonly effort: number;
  readonly status: string;
  readonly depReasons: Readonly<Record<string, string>>;
  readonly rawNode: Record<string, unknown>;
}

interface ParsedEdgeInfo {
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly justification: string | undefined;
  readonly rawEdge: Record<string, unknown>;
}


function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      result.push(item.trim());
    }
  }
  return result;
}

function extractDepReasons(node: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  const reasons = node.depReasons ?? node.dep_reasons;
  if (isRecord(reasons)) {
    for (const [key, val] of Object.entries(reasons)) {
      if (typeof val === "string" && val.trim().length > 0) {
        result[key] = val.trim();
      }
    }
  }
  return result;
}

function extractEdgeJustification(
  edge: Record<string, unknown>,
  sourceTask?: ParsedTaskInfo,
): string | undefined {
  const directJustification =
    edge.dataflow_justification ?? edge.justification ?? edge.reason ?? edge.dataflow;
  if (typeof directJustification === "string" && directJustification.trim().length > 0) {
    return directJustification.trim();
  }
  if (sourceTask && typeof edge.target === "string") {
    const reasonFromTask = sourceTask.depReasons[edge.target];
    if (typeof reasonFromTask === "string" && reasonFromTask.trim().length > 0) {
      return reasonFromTask.trim();
    }
  }
  return undefined;
}

export function detectArtificialSerialization(
  tasks: readonly TaskScopeInput[],
  justificationsByEdge: ReadonlyMap<string, string> = new Map(),
): ArtificialSerializationWarning[] {
  const normalizedTasks = tasks.map((t) => ({
    taskId: t.taskId,
    writeScope: t.writeScope.map(normalizeScopePath),
    dependencies: (t.dependencies ?? []).filter(isNonblank),
  }));

  const warnings: ArtificialSerializationWarning[] = [];
  for (const task of normalizedTasks) {
    for (const depId of task.dependencies) {
      const depTask = normalizedTasks.find((t) => t.taskId === depId);
      if (!depTask) continue;

      const overlap = checkScopeOverlap(task.writeScope, depTask.writeScope);
      const edgeKey = `${task.taskId}->${depTask.taskId}`;
      const justification = justificationsByEdge.get(edgeKey);
      const hasJustification = typeof justification === "string" && justification.trim().length > 0;

      if (!overlap.hasOverlap) {
        warnings.push({
          code: ARTIFICIAL_SERIALIZATION_WARNING,
          blockedTask: task.taskId,
          dependencyTask: depTask.taskId,
          message:
            `Task ${task.taskId} is artificially serialized behind ${depTask.taskId} with disjoint write scopes ` +
            `([${task.writeScope.join(", ")}] vs [${depTask.writeScope.join(", ")}])` +
            (hasJustification ? ` despite declared justification: ${justification}` : " and no dataflow justification."),
          dataflowJustified: hasJustification,
          sourceScope: task.writeScope,
          targetScope: depTask.writeScope,
        });
      }
    }
  }
  return warnings;
}

export function computeWorkSpanMetrics(
  tasks: readonly { readonly id: string; readonly effort?: number }[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  maxLanes = 40,
): ParallelMetrics {
  const effortMap = new Map<string, number>();
  let totalWork = 0;

  for (const task of tasks) {
    const rawEffort = task.effort;
    const effort = typeof rawEffort === "number" && rawEffort > 0 ? rawEffort : 1;
    effortMap.set(task.id, effort);
    totalWork += effort;
  }

  const order = topologicalOrder(dependencies);
  const spanMap = new Map<string, number>();

  for (const taskId of order) {
    const taskEffort = effortMap.get(taskId) ?? 1;
    const prereqs = dependencies.get(taskId) ?? new Set<string>();
    let maxPrereqSpan = 0;
    for (const prereq of prereqs) {
      const prereqSpan = spanMap.get(prereq) ?? 0;
      if (prereqSpan > maxPrereqSpan) {
        maxPrereqSpan = prereqSpan;
      }
    }
    spanMap.set(taskId, maxPrereqSpan + taskEffort);
  }

  // If there are unresolved tasks (e.g. cycles), calculate baseline for all nodes
  for (const task of tasks) {
    if (!spanMap.has(task.id)) {
      spanMap.set(task.id, effortMap.get(task.id) ?? 1);
    }
  }

  let criticalSpan = 0;
  for (const span of spanMap.values()) {
    if (span > criticalSpan) {
      criticalSpan = span;
    }
  }

  const parallelismFactor =
    criticalSpan > 0 ? Math.round((totalWork / criticalSpan) * 100) / 100 : tasks.length > 0 ? 1 : 0;

  const optimalLanes = Math.max(
    1,
    Math.min(maxLanes, Math.ceil(parallelismFactor > 0 ? parallelismFactor : 1)),
  );

  return {
    totalWork,
    criticalSpan,
    parallelismFactor,
    optimalLanes,
    maxSupportedLanes: maxLanes,
  };
}

export function allocateParallelLanes(
  tasks: readonly TaskScopeInput[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  maxLanes = 40,
): readonly ParallelLaneAssignment[] {
  const waves = computeConcurrencyWaves(tasks, dependencies);
  const assignments: ParallelLaneAssignment[] = [];

  for (const wave of waves) {
    wave.tasks.forEach((taskId, index) => {
      const laneIndex = index % maxLanes;
      assignments.push({
        laneIndex,
        taskId,
        waveIndex: wave.waveIndex,
      });
    });
  }

  return assignments;
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
    if (isRecord(node) && (node.type === "task" || typeof node.id === "string")) {
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
          `Task ${edge.source} is artificially serialized behind ${edge.target} with disjoint write scopes ` +
          `([${sourceTask.writeScope.join(", ")}] vs [${targetTask.writeScope.join(", ")}])` +
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

  // Recompute dependencies map after decoupling
  const decoupledDepsMap = new Map<string, Set<string>>();
  for (const task of parsedTasks) {
    decoupledDepsMap.set(task.id, new Set());
  }
  for (const edge of keptEdges) {
    if (edge.type === "depends_on" && decoupledDepsMap.has(edge.source)) {
      decoupledDepsMap.get(edge.source)!.add(edge.target);
    }
  }

  // Update task statuses and node documents
  const updatedNodes = rawNodes.map((rawNode) => {
    if (!isRecord(rawNode) || typeof rawNode.id !== "string") {
      return structuredClone(rawNode);
    }
    const clonedNode = structuredClone(rawNode);
    const taskId = rawNode.id;
    const task = taskMap.get(taskId);
    if (task) {
      const remainingPrereqs = decoupledDepsMap.get(taskId) ?? new Set();
      if (task.status === "proposed" && remainingPrereqs.size === 0) {
        clonedNode.status = "ready";
      }
    }
    return clonedNode;
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

  return {
    graph: newGraph,
    decoupledEdges,
    warnings,
    metrics,
    waves,
    lanes,
  };
}
