import { isNonblank, isRecord } from "../requirements/predicates.ts";
import {
  allocateParallelLanes,
  computeWorkSpanMetrics,
  inferStackOrDomain,
  MAX_LANES_PER_COORDINATOR,
  type DynamicLanePartitioningResult,
  type DynamicLaneTaskInput,
  type ParallelLaneAssignment,
  type ParallelMetrics,
} from "./lane-allocator.ts";
import {
  checkScopeOverlap,
  computeConcurrencyWaves,
  normalizeScopePath,
  type ConcurrencyWave,
  type TaskScopeInput,
} from "./scope-analyzer.ts";

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

export interface CoordinatorPartition {
  readonly coordinatorId: string;
  readonly coordinatorName: string;
  readonly domainOrStack: string;
  readonly taskIds: readonly string[];
  readonly laneIndices: readonly number[];
  readonly writeScope: readonly string[];
}

export interface MultiCoordinatorWavePartitionResult {
  readonly waveIndex: number;
  readonly totalLanes: number;
  readonly coordinatorCount: number;
  readonly partitions: readonly CoordinatorPartition[];
  readonly isMultiCoordinator: boolean;
  readonly summary: string;
}

export interface MultiCoordinatorPartitionOptions {
  readonly maxLanesPerCoordinator?: number | undefined;
  readonly waveIndex?: number | undefined;
  readonly stackPartitioning?: boolean | undefined;
  readonly domainHints?: Readonly<Record<string, string>> | undefined;
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
  return value
    .filter((i): i is string => typeof i === "string" && i.trim().length > 0)
    .map((s) => s.trim());
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
      const justification = justificationsByEdge.get(`${task.taskId}->${depTask.taskId}`);
      const hasJustification = typeof justification === "string" && justification.trim().length > 0;
      if (!overlap.hasOverlap) {
        warnings.push({
          code: ARTIFICIAL_SERIALIZATION_WARNING,
          blockedTask: task.taskId,
          dependencyTask: depTask.taskId,
          message: `Task ${task.taskId} is artificially serialized behind ${depTask.taskId}`,
          dataflowJustified: hasJustification,
          sourceScope: task.writeScope,
          targetScope: depTask.writeScope,
        });
      }
    }
  }
  return warnings;
}

export function partitionDynamicLanes(
  tasks: readonly DynamicLaneTaskInput[],
  dependenciesOrMaxLanes?: ReadonlyMap<string, ReadonlySet<string>> | number | undefined,
  maxLanesOpt?: number | undefined,
): DynamicLanePartitioningResult {
  const maxLanes =
    typeof dependenciesOrMaxLanes === "number"
      ? dependenciesOrMaxLanes
      : typeof maxLanesOpt === "number"
        ? maxLanesOpt
        : 40;
  const depsMap =
    dependenciesOrMaxLanes instanceof Map
      ? dependenciesOrMaxLanes
      : new Map(tasks.map((t) => [t.taskId ?? t.id ?? "", new Set(t.dependencies ?? [])]));
  const normalizedTasks: TaskScopeInput[] = tasks.map((t) => ({
    taskId: t.taskId ?? t.id ?? "",
    writeScope: (t.writeScope ?? t.write_scope ?? []).map(normalizeScopePath),
    dependencies: t.dependencies ?? [...(depsMap.get(t.taskId ?? t.id ?? "") ?? [])],
  }));
  const metrics = computeWorkSpanMetrics(
    tasks.map((t) => ({
      id: t.taskId ?? t.id ?? "",
      effort: t.effort,
      dependencies: t.dependencies,
    })),
    depsMap,
    maxLanes,
  );
  const targetLanes = Math.max(1, Math.min(maxLanes, metrics.optimalLanes));
  const waves = computeConcurrencyWaves(normalizedTasks, depsMap);
  const assignments: ParallelLaneAssignment[] = [];
  for (const wave of waves) {
    wave.tasks.forEach((taskId, index) => {
      assignments.push({ laneIndex: index % targetLanes, taskId, waveIndex: wave.waveIndex });
    });
  }
  return { lanes: assignments, metrics, optimalLanes: targetLanes, waves };
}

export function partitionWaveCoordinators(
  tasks: readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
  options: MultiCoordinatorPartitionOptions = {},
): MultiCoordinatorWavePartitionResult {
  const maxLanes = options.maxLanesPerCoordinator ?? MAX_LANES_PER_COORDINATOR;
  const waveIdx = options.waveIndex ?? 1;
  const normalized = tasks.map((t, idx) => {
    let id = `task-${idx + 1}`;
    let scope: string[] = [];
    if (typeof t === "string") id = t;
    else if (isRecord(t)) {
      if (typeof t.id === "string" && t.id.trim()) id = t.id.trim();
      else if (typeof t.taskId === "string" && t.taskId.trim()) id = t.taskId.trim();
      if (Array.isArray(t.write_scope))
        scope = t.write_scope.filter((s): s is string => typeof s === "string");
      else if (Array.isArray(t.writeScope))
        scope = t.writeScope.filter((s): s is string => typeof s === "string");
    }
    const domain = options.domainHints?.[id] ?? inferStackOrDomain(scope.length > 0 ? scope : id);
    return { id, writeScope: scope, domain, originalIndex: idx };
  });
  const partitions: CoordinatorPartition[] = [];
  for (let i = 0; i < normalized.length; i += maxLanes) {
    const chunk = normalized.slice(i, i + maxLanes);
    const partIdx = Math.floor(i / maxLanes) + 1;
    const domain = chunk[0]?.domain ?? "core";
    const coordId =
      normalized.length <= maxLanes
        ? `coordinator_${domain}`
        : `coordinator_w${waveIdx}_c${partIdx}_${domain}`;
    const chunkScopes = new Set<string>();
    for (const c of chunk) {
      for (const s of c.writeScope) chunkScopes.add(s);
    }
    partitions.push({
      coordinatorId: coordId,
      coordinatorName: `Coordinator ${partIdx} [${domain}]`,
      domainOrStack: domain,
      taskIds: chunk.map((c) => c.id),
      laneIndices: chunk.map((c) => c.originalIndex),
      writeScope: Array.from(chunkScopes),
    });
  }
  return {
    waveIndex: waveIdx,
    totalLanes: normalized.length,
    coordinatorCount: partitions.length,
    partitions,
    isMultiCoordinator: partitions.length > 1,
    summary: `Wave ${waveIdx}: ${normalized.length} lanes across ${partitions.length} coordinators.`,
  };
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
      const taskInfo: ParsedTaskInfo = {
        id,
        writeScope: extractStringArray(node.write_scope ?? node.writeScope).map(normalizeScopePath),
        effort: typeof node.effort === "number" && node.effort > 0 ? node.effort : defaultEffort,
        status: typeof node.status === "string" ? node.status : "proposed",
        depReasons: extractDepReasons(node),
        rawNode: structuredClone(node),
      };
      taskMap.set(id, taskInfo);
      parsedTasks.push(taskInfo);
    }
  }
  const warnings: ArtificialSerializationWarning[] = [];
  const decoupledEdges: { source: string; target: string }[] = [];
  const keptEdges: ParsedEdgeInfo[] = [];
  for (const edge of rawEdges) {
    if (isRecord(edge) && typeof edge.source === "string" && typeof edge.target === "string") {
      const sourceTask = taskMap.get(edge.source);
      const targetTask = taskMap.get(edge.target);
      const justification =
        edge.justification ?? edge.reason ?? sourceTask?.depReasons[edge.target];
      const parsedEdge = {
        source: edge.source,
        target: edge.target,
        type: typeof edge.type === "string" ? edge.type : "depends_on",
        justification: typeof justification === "string" ? justification : undefined,
        rawEdge: structuredClone(edge),
      };
      if (parsedEdge.type === "depends_on" && sourceTask && targetTask) {
        const overlap = checkScopeOverlap(sourceTask.writeScope, targetTask.writeScope);
        const hasJust = isNonblank(parsedEdge.justification);
        if (!overlap.hasOverlap) {
          warnings.push({
            code: ARTIFICIAL_SERIALIZATION_WARNING,
            blockedTask: edge.source,
            dependencyTask: edge.target,
            message: `Disjoint write scopes`,
            dataflowJustified: hasJust,
            sourceScope: sourceTask.writeScope,
            targetScope: targetTask.writeScope,
          });
          if (!hasJust || !preserveJustified) {
            decoupledEdges.push({ source: edge.source, target: edge.target });
            continue;
          }
        }
      }
      keptEdges.push(parsedEdge);
    }
  }
  const decoupledDepsMap = new Map<string, Set<string>>(parsedTasks.map((t) => [t.id, new Set()]));
  for (const edge of keptEdges) {
    if (edge.type === "depends_on" && decoupledDepsMap.has(edge.source))
      decoupledDepsMap.get(edge.source)!.add(edge.target);
  }
  const updatedNodes = rawNodes.map((n) => {
    if (!isRecord(n) || typeof n.id !== "string") return structuredClone(n);
    const cloned = structuredClone(n);
    const task = taskMap.get(n.id);
    if (task && task.status === "proposed" && (decoupledDepsMap.get(n.id)?.size ?? 0) === 0)
      cloned.status = "ready";
    return cloned;
  });
  const taskScopeInputs: TaskScopeInput[] = parsedTasks.map((t) => ({
    taskId: t.id,
    writeScope: t.writeScope,
    dependencies: [...(decoupledDepsMap.get(t.id) ?? [])],
  }));
  return {
    graph: {
      ...structuredClone(graphInput),
      nodes: updatedNodes,
      edges: keptEdges.map((e) => e.rawEdge),
    },
    decoupledEdges,
    warnings,
    metrics: computeWorkSpanMetrics(
      parsedTasks.map((t) => ({ id: t.id, effort: t.effort })),
      decoupledDepsMap,
      maxLanes,
    ),
    waves: computeConcurrencyWaves(taskScopeInputs, decoupledDepsMap),
    lanes: allocateParallelLanes(taskScopeInputs, decoupledDepsMap, maxLanes),
  };
}
