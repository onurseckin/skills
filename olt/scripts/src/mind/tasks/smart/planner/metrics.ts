import { pathsOverlap } from "./collisions.ts";
import type { SmartTaskPlan, SmartWavePlanResult, ScopeCollision } from "./models.ts";
import type { MacroMetrics } from "./types.ts";
import type { TaskQueueItem } from "../../../../task/queue/index.ts";
import { detectScopeCollisions } from "./collisions.ts";

export function computeMacroMetrics(
  tasks: readonly (
    | SmartTaskPlan
    | TaskQueueItem
    | {
        readonly id: string;
        readonly effort?: number | undefined;
        readonly dependencies?: readonly string[] | undefined;
      }
  )[],
  maxLanes = 40,
): MacroMetrics {
  if (tasks.length === 0) {
    return {
      work: 0,
      span: 0,
      parallelism: 0,
      efficiency: 0,
    };
  }

  const effortMap = new Map<string, number>();
  const depsMap = new Map<string, Set<string>>();
  let totalWork = 0;

  for (const task of tasks) {
    const rawEffort =
      "effort" in task && typeof task.effort === "number" && task.effort > 0 ? task.effort : 1;
    effortMap.set(task.id, rawEffort);
    totalWork += rawEffort;

    const deps = new Set<string>();
    if ("dependencies" in task && Array.isArray(task.dependencies)) {
      for (const d of task.dependencies) {
        if (typeof d === "string" && d.trim().length > 0) {
          deps.add(d.trim());
        }
      }
    }
    depsMap.set(task.id, deps);
  }

  const remaining = new Map<string, number>();
  const downstream = new Map<string, Set<string>>();
  for (const [id, prereqs] of depsMap) {
    downstream.set(id, new Set());
    const validPrereqs = [...prereqs].filter((p) => depsMap.has(p));
    remaining.set(id, validPrereqs.length);
  }
  for (const [id, prereqs] of depsMap) {
    for (const p of prereqs) {
      if (downstream.has(p)) {
        downstream.get(p)!.add(id);
      }
    }
  }

  const ready = [...remaining]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const curr = ready.shift()!;
    order.push(curr);
    for (const next of [...(downstream.get(curr) ?? [])].sort()) {
      const rem = (remaining.get(next) ?? 1) - 1;
      remaining.set(next, rem);
      if (rem === 0) {
        const position = ready.findIndex((id) => id > next);
        ready.splice(position < 0 ? ready.length : position, 0, next);
      }
    }
  }

  const spanMap = new Map<string, number>();
  for (const id of order) {
    const effort = effortMap.get(id) ?? 1;
    const prereqs = depsMap.get(id) ?? new Set<string>();
    let maxPrereqSpan = 0;
    for (const p of prereqs) {
      const pSpan = spanMap.get(p) ?? 0;
      if (pSpan > maxPrereqSpan) {
        maxPrereqSpan = pSpan;
      }
    }
    spanMap.set(id, maxPrereqSpan + effort);
  }

  for (const task of tasks) {
    if (!spanMap.has(task.id)) {
      spanMap.set(task.id, effortMap.get(task.id) ?? 1);
    }
  }

  let criticalSpan = 0;
  for (const s of spanMap.values()) {
    if (s > criticalSpan) {
      criticalSpan = s;
    }
  }

  const parallelism =
    criticalSpan > 0
      ? Math.round((totalWork / criticalSpan) * 100) / 100
      : tasks.length > 0
        ? 1
        : 0;

  const optimalLanes = Math.max(
    1,
    Math.min(maxLanes, Math.ceil(parallelism > 0 ? parallelism : 1)),
  );

  const efficiency =
    optimalLanes > 0 && parallelism > 0 ? Math.round((parallelism / optimalLanes) * 100) / 100 : 0;

  return {
    work: totalWork,
    span: criticalSpan,
    parallelism,
    efficiency,
  };
}
