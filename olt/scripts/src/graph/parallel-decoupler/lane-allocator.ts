import {
  computeConcurrencyWaves,
  normalizeScopePath,
  type TaskScopeInput,
} from "../scope-analyzer.ts";
import { computeWorkSpanMetrics } from "./metrics.ts";
import type {
  DynamicLanePartitioningResult,
  DynamicLaneTaskInput,
  ParallelLaneAssignment,
} from "./types.ts";

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
  const first = tasksOrWaves[0];
  if (first && ("taskIds" in first || "tasks" in first)) {
    const list = tasksOrWaves as readonly {
      readonly waveIndex: number;
      readonly taskIds?: readonly string[];
      readonly tasks?: readonly string[];
    }[];
    const out: ParallelLaneAssignment[] = [];
    for (const w of list) {
      const ids = w.taskIds ?? w.tasks ?? [];
      ids.forEach((taskId, idx) => out.push({ laneIndex: idx, taskId, waveIndex: w.waveIndex }));
    }
    return out;
  }
  const tasks = tasksOrWaves as readonly TaskScopeInput[];
  let depsMap: ReadonlyMap<string, ReadonlySet<string>>;
  let maxLanes: number;
  if (dependenciesOrMaxLanes instanceof Map) {
    depsMap = dependenciesOrMaxLanes;
    maxLanes = typeof maxLanesOpt === "number" ? maxLanesOpt : 40;
  } else {
    const derived = new Map<string, Set<string>>();
    for (const t of tasks) derived.set(t.taskId, new Set(t.dependencies ?? []));
    depsMap = derived;
    maxLanes = typeof dependenciesOrMaxLanes === "number" ? dependenciesOrMaxLanes : maxLanesOpt;
  }
  const waves = computeConcurrencyWaves(tasks, depsMap);
  const assignments: ParallelLaneAssignment[] = [];
  for (const wave of waves) {
    wave.tasks.forEach((taskId, index) => {
      assignments.push({ laneIndex: index % maxLanes, taskId, waveIndex: wave.waveIndex });
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
    const derived = new Map<string, Set<string>>();
    for (const t of tasks) {
      const id = t.taskId ?? t.id ?? "";
      if (id) derived.set(id, new Set(t.dependencies ?? []));
    }
    depsMap = derived;
  } else if (dependenciesOrMaxLanes instanceof Map) {
    depsMap = dependenciesOrMaxLanes;
    maxLanes = typeof maxLanesOpt === "number" ? maxLanesOpt : 40;
  } else {
    const derived = new Map<string, Set<string>>();
    for (const t of tasks) {
      const id = t.taskId ?? t.id ?? "";
      if (id) derived.set(id, new Set(t.dependencies ?? []));
    }
    depsMap = derived;
    maxLanes = typeof maxLanesOpt === "number" ? maxLanesOpt : 40;
  }
  const normTasks: TaskScopeInput[] = tasks.map((t) => ({
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
  const waves = computeConcurrencyWaves(normTasks, depsMap);
  const assignments: ParallelLaneAssignment[] = [];
  for (const wave of waves) {
    wave.tasks.forEach((taskId, index) => {
      assignments.push({ laneIndex: index % targetLanes, taskId, waveIndex: wave.waveIndex });
    });
  }
  return Object.assign([...assignments], {
    lanes: assignments,
    metrics,
    optimalLanes: targetLanes,
    waves,
  });
}
