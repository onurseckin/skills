import { HarnessError } from "../core/errors/index.ts";
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
  readonly efficiency: number;
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
            (hasJustification
              ? ` despite declared justification: ${justification}`
              : " and no dataflow justification."),
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
  tasks: readonly { readonly id: string; readonly effort?: number | undefined }[],
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
    criticalSpan > 0
      ? Math.round((totalWork / criticalSpan) * 100) / 100
      : tasks.length > 0
        ? 1
        : 0;

  const optimalLanes = Math.max(
    1,
    Math.min(maxLanes, Math.ceil(parallelismFactor > 0 ? parallelismFactor : 1)),
  );

  const efficiency =
    optimalLanes > 0 && parallelismFactor > 0
      ? Math.round((parallelismFactor / optimalLanes) * 100) / 100
      : 0;

  return {
    totalWork,
    criticalSpan,
    parallelismFactor,
    optimalLanes,
    maxSupportedLanes: maxLanes,
    efficiency,
  };
}

export interface DynamicLanePartitioningResult {
  readonly lanes: readonly ParallelLaneAssignment[];
  readonly metrics: ParallelMetrics;
  readonly optimalLanes: number;
  readonly waves: readonly ConcurrencyWave[];
}

export type DynamicLaneTaskInput = {
  readonly id?: string | undefined;
  readonly taskId?: string | undefined;
  readonly effort?: number | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly dependencies?: readonly string[] | undefined;
};

export function partitionDynamicLanes(
  tasks: readonly DynamicLaneTaskInput[],
  dependenciesOrMaxLanes?: ReadonlyMap<string, ReadonlySet<string>> | number | undefined,
  maxLanesOpt?: number | undefined,
): DynamicLanePartitioningResult {
  let depsMap: ReadonlyMap<string, ReadonlySet<string>>;
  let maxLanes: number;

  if (typeof dependenciesOrMaxLanes === "number") {
    maxLanes = dependenciesOrMaxLanes;
    const derivedDeps = new Map<string, Set<string>>();
    for (const t of tasks) {
      const id = t.taskId ?? t.id ?? "";
      if (id) {
        derivedDeps.set(id, new Set(t.dependencies ?? []));
      }
    }
    depsMap = derivedDeps;
  } else if (dependenciesOrMaxLanes instanceof Map) {
    depsMap = dependenciesOrMaxLanes;
    maxLanes = typeof maxLanesOpt === "number" ? maxLanesOpt : 40;
  } else {
    const derivedDeps = new Map<string, Set<string>>();
    for (const t of tasks) {
      const id = t.taskId ?? t.id ?? "";
      if (id) {
        derivedDeps.set(id, new Set(t.dependencies ?? []));
      }
    }
    depsMap = derivedDeps;
    maxLanes = typeof maxLanesOpt === "number" ? maxLanesOpt : 40;
  }

  const normalizedTasks: TaskScopeInput[] = tasks.map((t) => ({
    taskId: t.taskId ?? t.id ?? "",
    writeScope: (t.writeScope ?? t.write_scope ?? []).map(normalizeScopePath),
    dependencies: t.dependencies ?? [...(depsMap.get(t.taskId ?? t.id ?? "") ?? [])],
  }));

  const metrics = computeWorkSpanMetrics(
    tasks.map((t) => ({ id: t.taskId ?? t.id ?? "", effort: t.effort })),
    depsMap,
    maxLanes,
  );

  const targetLanes = Math.max(1, Math.min(maxLanes, metrics.optimalLanes));
  const waves = computeConcurrencyWaves(normalizedTasks, depsMap);
  const assignments: ParallelLaneAssignment[] = [];

  for (const wave of waves) {
    wave.tasks.forEach((taskId, index) => {
      const laneIndex = index % targetLanes;
      assignments.push({
        laneIndex,
        taskId,
        waveIndex: wave.waveIndex,
      });
    });
  }

  return {
    lanes: assignments,
    metrics,
    optimalLanes: targetLanes,
    waves,
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

export const FALSE_SERIALIZATION_DEFECT = "FALSE_SERIALIZATION_DEFECT" as const;
export const MAX_LANES_PER_COORDINATOR = 5 as const;
export const FAST_PATH_TASK_COUNT = 1 as const;

export type HierarchyScalingPath =
  | "fast_path_compaction"
  | "standard_coordinator"
  | "multi_coordinator_expansion";

export interface HierarchyScalingResult {
  readonly path: HierarchyScalingPath;
  readonly fastPath: boolean;
  readonly isMultiCoordinator: boolean;
  readonly requiredCoordinators: number;
  readonly maxLanesPerCoordinator: number;
  readonly optimalLanes: number;
  readonly reason: string;
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

export interface AntiSerializationInterlockResult {
  readonly passed: boolean;
  readonly readyLanesCount: number;
  readonly dispatchedCount: number;
  readonly violation?:
    | {
        readonly code: typeof FALSE_SERIALIZATION_DEFECT;
        readonly message: string;
        readonly readyTaskIds: readonly string[];
        readonly recommendedDispatchArray: readonly SubagentDispatchItem[];
      }
    | undefined;
}

export interface SubagentDispatchItem {
  readonly TypeName: string;
  readonly Role: string;
  readonly Prompt: string;
  readonly Workspace: string;
  readonly [key: string]: unknown;
}

export interface SubagentDispatchFormatOptions {
  readonly defaultTypeName?: string | undefined;
  readonly defaultWorkspace?: string | undefined;
  readonly rolePrefix?: string | undefined;
  readonly basePromptTemplate?: string | undefined;
}

/**
 * Checks if a task set qualifies for Fast-Path Compaction (exactly N = 1 task).
 */
export function isFastPathCompactionEligible(taskCount: number | readonly unknown[]): boolean {
  const count =
    typeof taskCount === "number" ? taskCount : Array.isArray(taskCount) ? taskCount.length : 0;
  return count === FAST_PATH_TASK_COUNT;
}

/**
 * Evaluates the appropriate hierarchy scaling path based on task count, wave lanes, and domain diversity.
 */
export function evaluateHierarchyScaling(options: {
  readonly taskCount: number | readonly unknown[];
  readonly waveLanes?: number | undefined;
  readonly multiStack?: boolean | undefined;
  readonly maxLanesPerCoordinator?: number | undefined;
  readonly domainCount?: number | undefined;
}): HierarchyScalingResult {
  const count =
    typeof options.taskCount === "number"
      ? options.taskCount
      : Array.isArray(options.taskCount)
        ? options.taskCount.length
        : 0;

  const maxLanes = options.maxLanesPerCoordinator ?? MAX_LANES_PER_COORDINATOR;
  const lanes =
    typeof options.waveLanes === "number" && options.waveLanes > 0 ? options.waveLanes : count;

  if (count === FAST_PATH_TASK_COUNT) {
    return {
      path: "fast_path_compaction",
      fastPath: true,
      isMultiCoordinator: false,
      requiredCoordinators: 0,
      maxLanesPerCoordinator: maxLanes,
      optimalLanes: 1,
      reason:
        "Fast-Path Compaction active: single task ($N = 1$) supervised directly by Orchestrator without coordinator middleman.",
    };
  }

  if (
    lanes > maxLanes ||
    options.multiStack ||
    (typeof options.domainCount === "number" && options.domainCount > 1)
  ) {
    const requiredCoordinators = Math.max(2, Math.ceil(lanes / maxLanes));
    return {
      path: "multi_coordinator_expansion",
      fastPath: false,
      isMultiCoordinator: true,
      requiredCoordinators,
      maxLanesPerCoordinator: maxLanes,
      optimalLanes: lanes,
      reason: `Multi-Coordinator Expansion active: ${lanes} parallel lane(s) partitioned across ${requiredCoordinators} specialized Tier 2 Coordinators (max ${maxLanes} lanes per coordinator).`,
    };
  }

  return {
    path: "standard_coordinator",
    fastPath: false,
    isMultiCoordinator: false,
    requiredCoordinators: 1,
    maxLanesPerCoordinator: maxLanes,
    optimalLanes: lanes,
    reason: `Standard Hierarchy active: single Tier 2 Coordinator managing ${lanes} wave lane(s) (<= ${maxLanes} lanes).`,
  };
}

/**
 * Infers functional stack or domain from file paths or write scopes.
 */
export function inferStackOrDomain(filePathOrScope: string | readonly string[]): string {
  const items = typeof filePathOrScope === "string" ? [filePathOrScope] : filePathOrScope;
  for (const item of items) {
    const lower = item.toLowerCase();
    if (
      lower.endsWith(".tsx") ||
      lower.endsWith(".jsx") ||
      lower.endsWith(".css") ||
      lower.endsWith(".html") ||
      lower.endsWith(".svg") ||
      lower.includes("/ui/") ||
      lower.includes("/components/") ||
      lower.includes("/views/")
    ) {
      return "ui";
    }
    if (lower.includes("/cli/") || lower.includes("/commands/") || lower.includes("/scripts/")) {
      return "cli";
    }
    if (
      lower.endsWith(".sql") ||
      lower.endsWith(".prisma") ||
      lower.includes("prisma") ||
      lower.includes("database") ||
      lower.includes("/db/") ||
      lower.startsWith("db/")
    ) {
      return "database";
    }
    if (
      lower.includes("/mind/") ||
      lower.includes("/engine/") ||
      lower.includes("/core/") ||
      lower.includes("/graph/")
    ) {
      return "core";
    }
    if (lower.endsWith(".py")) {
      return "python";
    }
    if (lower.endsWith(".rs")) {
      return "rust";
    }
    if (lower.endsWith(".go")) {
      return "go";
    }
    if (
      lower.endsWith(".ts") ||
      lower.endsWith(".mts") ||
      lower.endsWith(".cts") ||
      lower.endsWith(".js") ||
      lower.endsWith(".mjs")
    ) {
      return "typescript";
    }
  }
  return "core";
}

/**
 * Partitions wave tasks into chunks of at most maxLanesPerCoordinator (default: 5)
 * assigned to specialized Tier 2 Coordinators.
 */
export function partitionWaveCoordinators(
  tasks: readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
  options: MultiCoordinatorPartitionOptions = {},
): MultiCoordinatorWavePartitionResult {
  const maxLanes = options.maxLanesPerCoordinator ?? MAX_LANES_PER_COORDINATOR;
  const waveIdx = options.waveIndex ?? 1;

  if (tasks.length === 0) {
    return {
      waveIndex: waveIdx,
      totalLanes: 0,
      coordinatorCount: 0,
      partitions: [],
      isMultiCoordinator: false,
      summary: "Empty wave: 0 coordinators required.",
    };
  }

  interface NormalizedTaskEntry {
    readonly id: string;
    readonly writeScope: readonly string[];
    readonly domain: string;
    readonly originalIndex: number;
  }

  const normalized: NormalizedTaskEntry[] = tasks.map((t, idx) => {
    let id = `task-${idx + 1}`;
    let scope: string[] = [];
    if (typeof t === "string") {
      id = t;
    } else if (isRecord(t)) {
      if (typeof t.id === "string" && t.id.trim()) id = t.id.trim();
      else if (typeof t.taskId === "string" && t.taskId.trim()) id = t.taskId.trim();
      if (Array.isArray(t.write_scope))
        scope = t.write_scope.filter((s): s is string => typeof s === "string");
      else if (Array.isArray(t.writeScope))
        scope = t.writeScope.filter((s): s is string => typeof s === "string");
    }

    const domainHint = options.domainHints?.[id];
    const domain = domainHint ?? inferStackOrDomain(scope.length > 0 ? scope : id);

    return {
      id,
      writeScope: scope,
      domain,
      originalIndex: idx,
    };
  });

  const partitions: CoordinatorPartition[] = [];

  if (options.stackPartitioning) {
    // Group by stack/domain first
    const byDomain = new Map<string, NormalizedTaskEntry[]>();
    for (const entry of normalized) {
      const list = byDomain.get(entry.domain) ?? [];
      list.push(entry);
      byDomain.set(entry.domain, list);
    }

    for (const [domain, domainEntries] of byDomain.entries()) {
      for (let i = 0; i < domainEntries.length; i += maxLanes) {
        const chunk = domainEntries.slice(i, i + maxLanes);
        const partIdx = Math.floor(i / maxLanes) + 1;
        const coordId =
          domainEntries.length <= maxLanes
            ? `coordinator_${domain}`
            : `coordinator_${domain}_part${partIdx}`;
        const coordName = `Coordinator [${domain.toUpperCase()}] (Wave ${waveIdx}${domainEntries.length > maxLanes ? ` Part ${partIdx}` : ""})`;

        const chunkScopes = new Set<string>();
        for (const c of chunk) {
          for (const s of c.writeScope) chunkScopes.add(s);
        }

        partitions.push({
          coordinatorId: coordId,
          coordinatorName: coordName,
          domainOrStack: domain,
          taskIds: chunk.map((c) => c.id),
          laneIndices: chunk.map((c) => c.originalIndex),
          writeScope: Array.from(chunkScopes),
        });
      }
    }
  } else {
    // Partition linearly by maxLanes
    for (let i = 0; i < normalized.length; i += maxLanes) {
      const chunk = normalized.slice(i, i + maxLanes);
      const partIdx = Math.floor(i / maxLanes) + 1;
      const primaryDomain = chunk[0]?.domain ?? "core";
      const coordId =
        normalized.length <= maxLanes
          ? `coordinator_${primaryDomain}`
          : `coordinator_w${waveIdx}_c${partIdx}_${primaryDomain}`;
      const coordName = `Coordinator ${partIdx} [${primaryDomain}] (Lanes ${i + 1}-${Math.min(i + maxLanes, normalized.length)})`;

      const chunkScopes = new Set<string>();
      for (const c of chunk) {
        for (const s of c.writeScope) chunkScopes.add(s);
      }

      partitions.push({
        coordinatorId: coordId,
        coordinatorName: coordName,
        domainOrStack: primaryDomain,
        taskIds: chunk.map((c) => c.id),
        laneIndices: chunk.map((c) => c.originalIndex),
        writeScope: Array.from(chunkScopes),
      });
    }
  }

  const isMultiCoordinator = partitions.length > 1;
  const summary = isMultiCoordinator
    ? `Wave ${waveIdx}: ${normalized.length} parallel lanes partitioned across ${partitions.length} specialized Coordinators (max ${maxLanes} lanes per coordinator).`
    : `Wave ${waveIdx}: ${normalized.length} parallel lanes managed by single Coordinator (${partitions[0]?.coordinatorId ?? "coordinator_core"}).`;

  return {
    waveIndex: waveIdx,
    totalLanes: normalized.length,
    coordinatorCount: partitions.length,
    partitions,
    isMultiCoordinator,
    summary,
  };
}

/**
 * Formats a parallel batch array for host-native invoke_subagent dispatch.
 */
export function formatParallelSubagentsDispatchArray(
  tasks: readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
  options: SubagentDispatchFormatOptions = {},
): readonly SubagentDispatchItem[] {
  const typeName = options.defaultTypeName ?? "self";
  const workspace = options.defaultWorkspace ?? "share";
  const prefix = options.rolePrefix ?? "Implementer Lane";

  return tasks.map((t, idx) => {
    let taskId = `task-${idx + 1}`;
    let label = `Task ${idx + 1}`;
    let prompt =
      options.basePromptTemplate ?? `Execute assigned task ${taskId} within disjoint write scope.`;

    if (typeof t === "string") {
      taskId = t;
      label = t;
    } else if (isRecord(t)) {
      const rec = t as Record<string, unknown>;
      if (typeof rec["id"] === "string" && rec["id"].trim()) taskId = rec["id"].trim();
      else if (typeof rec["taskId"] === "string" && rec["taskId"].trim())
        taskId = rec["taskId"].trim();

      if (typeof rec["label"] === "string" && rec["label"].trim()) label = rec["label"].trim();
      else if (typeof rec["title"] === "string" && rec["title"].trim()) label = rec["title"].trim();
      else label = taskId;

      if (
        typeof rec["zero_exploration_prompt"] === "string" &&
        rec["zero_exploration_prompt"].trim()
      ) {
        prompt = rec["zero_exploration_prompt"].trim();
      } else if (
        isRecord(rec["metadata"]) &&
        typeof (rec["metadata"] as Record<string, unknown>)["zero_exploration_1shot_brief"] ===
          "string"
      ) {
        prompt = String(
          (rec["metadata"] as Record<string, unknown>)["zero_exploration_1shot_brief"],
        ).trim();
      }
    }

    return {
      TypeName: typeName,
      Role: `${prefix} ${idx + 1}: ${label}`,
      Prompt: prompt,
      Workspace: workspace,
    };
  });
}

/**
 * Verifies the Hard-Coded Anti-Serialization Mechanical Interlock:
 * If a wave has N >= 2 ready disjoint lanes, single-subagent dispatches are mechanically blocked.
 */
export function verifyAntiSerializationInterlock(
  readyLanes:
    | number
    | readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
  dispatchedCount: number,
  tasks?: readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
): AntiSerializationInterlockResult {
  const readyCount =
    typeof readyLanes === "number" ? readyLanes : Array.isArray(readyLanes) ? readyLanes.length : 0;

  const targetTasks = tasks ?? (Array.isArray(readyLanes) ? readyLanes : []);

  const readyTaskIds: string[] = targetTasks.map((t, idx) => {
    if (typeof t === "string") return t;
    if (isRecord(t)) {
      const rec = t as Record<string, unknown>;
      if (typeof rec["id"] === "string" && rec["id"].trim()) return rec["id"].trim();
      if (typeof rec["taskId"] === "string" && rec["taskId"].trim()) return rec["taskId"].trim();
    }
    return `task-${idx + 1}`;
  });

  if (readyCount >= 2 && dispatchedCount < readyCount) {
    const recommendedDispatchArray = formatParallelSubagentsDispatchArray(targetTasks);
    const message = `[FALSE_SERIALIZATION_DEFECT] Wave contains ${readyCount} ready disjoint lanes. You MUST invoke all ${readyCount} subagents in parallel via Subagents: [...].`;

    return {
      passed: false,
      readyLanesCount: readyCount,
      dispatchedCount,
      violation: {
        code: FALSE_SERIALIZATION_DEFECT,
        message,
        readyTaskIds,
        recommendedDispatchArray: recommendedDispatchArray as SubagentDispatchItem[],
      },
    };
  }

  return {
    passed: true,
    readyLanesCount: readyCount,
    dispatchedCount,
  };
}

/**
 * Asserts the Anti-Serialization Interlock, throwing a HarnessError if a serialization defect is detected.
 */
export function assertAntiSerializationInterlock(
  readyLanes:
    | number
    | readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
  dispatchedCount: number,
  tasks?: readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
): void {
  const result = verifyAntiSerializationInterlock(readyLanes, dispatchedCount, tasks);
  if (!result.passed && result.violation) {
    throw new HarnessError("INVALID_STATE", result.violation.message);
  }
}
