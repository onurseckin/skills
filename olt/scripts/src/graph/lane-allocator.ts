import { HarnessError } from "../core/errors/index.ts";
import { isRecord } from "../requirements/predicates.ts";
import {
  computeConcurrencyWaves,
  type ConcurrencyWave,
  type TaskScopeInput,
} from "./scope-analyzer.ts";
import { topologicalOrder } from "./topology.ts";

export const FALSE_SERIALIZATION_DEFECT = "FALSE_SERIALIZATION_DEFECT" as const;
export const MAX_LANES_PER_COORDINATOR = 5 as const;
export const FAST_PATH_TASK_COUNT = 1 as const;

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

export type DynamicLaneTaskInput = {
  readonly id?: string | undefined;
  readonly taskId?: string | undefined;
  readonly effort?: number | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly dependencies?: readonly string[] | undefined;
};

export interface DynamicLanePartitioningResult {
  readonly lanes: readonly ParallelLaneAssignment[];
  readonly metrics: ParallelMetrics;
  readonly optimalLanes: number;
  readonly waves: readonly ConcurrencyWave[];
}

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

export function computeWorkSpanMetrics(
  tasks: readonly {
    readonly id: string;
    readonly effort?: number | undefined;
    readonly dependencies?: readonly string[] | undefined;
  }[],
  dependencies?: ReadonlyMap<string, ReadonlySet<string>>,
  maxLanes = 40,
): ParallelMetrics {
  const effortMap = new Map<string, number>();
  let totalWork = 0;
  for (const task of tasks) {
    const effort = typeof task.effort === "number" && task.effort > 0 ? task.effort : 1;
    effortMap.set(task.id, effort);
    totalWork += effort;
  }
  const depsMap = dependencies ?? new Map(tasks.map((t) => [t.id, new Set(t.dependencies ?? [])]));
  const order = topologicalOrder(depsMap);
  const spanMap = new Map<string, number>();
  for (const taskId of order) {
    const taskEffort = effortMap.get(taskId) ?? 1;
    const prereqs = depsMap.get(taskId) ?? new Set<string>();
    let maxPrereqSpan = 0;
    for (const prereq of prereqs) {
      const prereqSpan = spanMap.get(prereq) ?? 0;
      if (prereqSpan > maxPrereqSpan) maxPrereqSpan = prereqSpan;
    }
    spanMap.set(taskId, maxPrereqSpan + taskEffort);
  }
  for (const task of tasks) {
    if (!spanMap.has(task.id)) spanMap.set(task.id, effortMap.get(task.id) ?? 1);
  }
  let criticalSpan = 0;
  for (const span of spanMap.values()) {
    if (span > criticalSpan) criticalSpan = span;
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

export function allocateParallelLanes(
  tasks: readonly TaskScopeInput[],
  dependencies?: ReadonlyMap<string, ReadonlySet<string>> | number,
  maxLanesParam?: number,
): readonly ParallelLaneAssignment[] {
  const maxLanes =
    typeof dependencies === "number"
      ? dependencies
      : typeof maxLanesParam === "number"
        ? maxLanesParam
        : 40;
  const depsMap =
    dependencies instanceof Map
      ? dependencies
      : new Map(tasks.map((t) => [t.taskId, new Set(t.dependencies ?? [])]));
  const waves = computeConcurrencyWaves(tasks, depsMap);
  const assignments: ParallelLaneAssignment[] = [];
  for (const wave of waves) {
    wave.tasks.forEach((taskId, index) => {
      assignments.push({ laneIndex: index % maxLanes, taskId, waveIndex: wave.waveIndex });
    });
  }
  return assignments;
}

export function isFastPathCompactionEligible(taskCount: number | readonly unknown[]): boolean {
  const count =
    typeof taskCount === "number" ? taskCount : Array.isArray(taskCount) ? taskCount.length : 0;
  return count === FAST_PATH_TASK_COUNT;
}

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
      reason: "Fast-Path Compaction active: single task.",
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
      reason: `Multi-Coordinator: ${lanes} lanes across ${requiredCoordinators} coordinators.`,
    };
  }
  return {
    path: "standard_coordinator",
    fastPath: false,
    isMultiCoordinator: false,
    requiredCoordinators: 1,
    maxLanesPerCoordinator: maxLanes,
    optimalLanes: lanes,
    reason: `Standard Hierarchy: ${lanes} lanes.`,
  };
}

export function inferStackOrDomain(filePathOrScope: string | readonly string[]): string {
  const items = typeof filePathOrScope === "string" ? [filePathOrScope] : filePathOrScope;
  for (const item of items) {
    const lower = item.toLowerCase();
    if (
      lower.endsWith(".tsx") ||
      lower.endsWith(".jsx") ||
      lower.endsWith(".css") ||
      lower.includes("/ui/")
    )
      return "ui";
    if (lower.includes("/cli/") || lower.includes("/commands/")) return "cli";
    if (lower.endsWith(".sql") || lower.includes("prisma") || lower.includes("/db/"))
      return "database";
    if (
      lower.includes("/mind/") ||
      lower.includes("/engine/") ||
      lower.includes("/core/") ||
      lower.includes("/graph/")
    )
      return "core";
    if (lower.endsWith(".py")) return "python";
    if (lower.endsWith(".rs")) return "rust";
    if (lower.endsWith(".go")) return "go";
    if (lower.endsWith(".ts") || lower.endsWith(".js")) return "typescript";
  }
  return "core";
}

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
    return {
      passed: false,
      readyLanesCount: readyCount,
      dispatchedCount,
      violation: {
        code: FALSE_SERIALIZATION_DEFECT,
        message: `[FALSE_SERIALIZATION_DEFECT] Wave contains ${readyCount} ready disjoint lanes.`,
        readyTaskIds,
        recommendedDispatchArray: recommendedDispatchArray as SubagentDispatchItem[],
      },
    };
  }
  return { passed: true, readyLanesCount: readyCount, dispatchedCount };
}

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
