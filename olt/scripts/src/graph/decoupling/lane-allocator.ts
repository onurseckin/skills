import {
  computeConcurrencyWaves,
  normalizeScopePath,
  type ConcurrencyWave,
  type TaskScopeInput,
} from "../scope-analyzer.ts";
import { topologicalOrder } from "../topology.ts";

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
  readonly wave?: number | undefined;
};

export function computeWorkSpanMetrics(
  tasks: readonly {
    readonly id?: string | undefined;
    readonly taskId?: string | undefined;
    readonly effort?: number | undefined;
    readonly dependencies?: readonly string[] | undefined;
  }[],
  dependencies?: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  maxLanes = 40,
): ParallelMetrics {
  const effortMap = new Map<string, number>();
  let totalWork = 0;

  for (const task of tasks) {
    const id = task.id ?? task.taskId ?? "";
    if (!id) continue;
    const rawEffort = task.effort;
    const effort = typeof rawEffort === "number" && rawEffort > 0 ? rawEffort : 1;
    effortMap.set(id, effort);
    totalWork += effort;
  }

  let depsMap: ReadonlyMap<string, ReadonlySet<string>>;
  if (dependencies instanceof Map) {
    depsMap = dependencies;
  } else {
    const derived = new Map<string, Set<string>>();
    for (const task of tasks) {
      const id = task.id ?? task.taskId ?? "";
      if (id) {
        derived.set(id, new Set(task.dependencies ?? []));
      }
    }
    depsMap = derived;
  }

  const order = topologicalOrder(depsMap);
  const spanMap = new Map<string, number>();

  for (const taskId of order) {
    const taskEffort = effortMap.get(taskId) ?? 1;
    const prereqs = depsMap.get(taskId) ?? new Set<string>();
    let maxPrereqSpan = 0;
    for (const prereq of prereqs) {
      const prereqSpan = spanMap.get(prereq) ?? 0;
      if (prereqSpan > maxPrereqSpan) {
        maxPrereqSpan = prereqSpan;
      }
    }
    spanMap.set(taskId, maxPrereqSpan + taskEffort);
  }

  for (const task of tasks) {
    const id = task.id ?? task.taskId ?? "";
    if (id && !spanMap.has(id)) {
      spanMap.set(id, effortMap.get(id) ?? 1);
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

export function allocateParallelLanes(
  tasksOrWaves:
    | readonly TaskScopeInput[]
    | readonly {
        readonly waveIndex: number;
        readonly taskIds?: readonly string[];
        readonly tasks?: readonly string[];
      }[],
  dependenciesOrMaxLanes?: ReadonlyMap<string, ReadonlySet<string>> | number | undefined,
  maxLanesOpt = 40,
): readonly ParallelLaneAssignment[] {
  if (tasksOrWaves.length === 0) return [];

  const firstItem = tasksOrWaves[0];
  if (firstItem && ("taskIds" in firstItem || "tasks" in firstItem)) {
    const wavesList = tasksOrWaves as readonly {
      readonly waveIndex: number;
      readonly taskIds?: readonly string[];
      readonly tasks?: readonly string[];
    }[];
    const assignments: ParallelLaneAssignment[] = [];
    for (const wave of wavesList) {
      const ids = wave.taskIds ?? wave.tasks ?? [];
      ids.forEach((taskId, index) => {
        assignments.push({
          laneIndex: index,
          taskId,
          waveIndex: wave.waveIndex,
        });
      });
    }
    return assignments;
  }

  const tasks = tasksOrWaves as readonly TaskScopeInput[];
  let depsMap: ReadonlyMap<string, ReadonlySet<string>>;
  let maxLanes: number;

  if (dependenciesOrMaxLanes instanceof Map) {
    depsMap = dependenciesOrMaxLanes;
    maxLanes = typeof maxLanesOpt === "number" ? maxLanesOpt : 40;
  } else {
    const derived = new Map<string, Set<string>>();
    for (const t of tasks) {
      derived.set(t.taskId, new Set(t.dependencies ?? []));
    }
    depsMap = derived;
    maxLanes = typeof dependenciesOrMaxLanes === "number" ? dependenciesOrMaxLanes : maxLanesOpt;
  }

  const waves = computeConcurrencyWaves(tasks, depsMap);
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

export function partitionDynamicLanes(
  tasks: readonly DynamicLaneTaskInput[],
  dependenciesOrMaxLanes?: ReadonlyMap<string, ReadonlySet<string>> | number | undefined,
  maxLanesOpt?: number | undefined,
): DynamicLanePartitioningResult & readonly ParallelLaneAssignment[] {
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

  return Object.assign([...assignments], {
    lanes: assignments,
    metrics,
    optimalLanes: targetLanes,
    waves,
  });
}
