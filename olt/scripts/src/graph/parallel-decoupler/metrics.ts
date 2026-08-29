import { topologicalOrder } from "../topology.ts";
import type { ParallelMetrics } from "./types.ts";

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
