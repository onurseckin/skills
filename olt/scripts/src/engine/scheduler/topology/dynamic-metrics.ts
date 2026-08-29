import { WorkSpanMetrics, ResourceDisjointnessMetrics } from "..";
import { HarnessError } from "../../../core/errors";
import { DependencyMap, topologicalOrder } from "../../../graph/dag-forensics";
import { isInteger } from "../../../requirements/predicates";
import { ScheduledTask } from "../conflict/rank";
import { conflicting } from "./unlimited-utils";

export function computeWorkSpanMetrics(
  dependencies: DependencyMap,
  tasks: ReadonlyMap<string, ScheduledTask>,
): WorkSpanMetrics {
  const order = topologicalOrder(dependencies);
  if (order.length !== dependencies.size) {
    throw new HarnessError("INTEGRITY", "depends_on edges contain an execution cycle");
  }

  let totalWork = 0;
  for (const taskId of dependencies.keys()) {
    const task = tasks.get(taskId);
    const effort = task && isInteger(task.effort) && task.effort > 0 ? task.effort : 1;
    totalWork += effort;
  }

  // Calculate critical path and cumulative span weights
  const cumulativeSpan = new Map<string, number>();
  const parentOnCriticalPath = new Map<string, string | null>();

  for (const taskId of order) {
    const task = tasks.get(taskId);
    const taskEffort = task && isInteger(task.effort) && task.effort > 0 ? task.effort : 1;
    const prereqs = dependencies.get(taskId) ?? [];
    let maxPrereqSpan = 0;
    let bestPrereq: string | null = null;

    for (const prereqId of prereqs) {
      const prereqSpan = cumulativeSpan.get(prereqId) ?? 0;
      if (prereqSpan > maxPrereqSpan) {
        maxPrereqSpan = prereqSpan;
        bestPrereq = prereqId;
      }
    }

    cumulativeSpan.set(taskId, maxPrereqSpan + taskEffort);
    parentOnCriticalPath.set(taskId, bestPrereq);
  }

  let maxSpan = 0;
  let criticalEndTask: string | null = null;

  for (const [taskId, span] of cumulativeSpan.entries()) {
    if (span > maxSpan) {
      maxSpan = span;
      criticalEndTask = taskId;
    }
  }

  const criticalPath: string[] = [];
  let curr = criticalEndTask;
  while (curr !== null) {
    criticalPath.unshift(curr);
    curr = parentOnCriticalPath.get(curr) ?? null;
  }

  const span = Math.max(1, maxSpan);
  const work = Math.max(1, totalWork);
  const parallelismFactor = Number((work / span).toFixed(2));
  const minWaves = criticalPath.length > 0 ? criticalPath.length : 1;

  return {
    work,
    span,
    parallelismFactor,
    criticalPath,
    minWaves,
  };
}
export function computeResourceDisjointness(
  tasks: readonly ScheduledTask[],
  dependencies?: DependencyMap | undefined,
): ResourceDisjointnessMetrics {
  if (tasks.length === 0) {
    return {
      disjointComponentCount: 0,
      disjointnessScore: 1,
      componentTaskIds: [],
    };
  }

  const adj = new Map<string, Set<string>>();
  for (const t of tasks) {
    adj.set(t.id, new Set<string>());
  }

  for (let i = 0; i < tasks.length; i++) {
    const left = tasks[i]!;
    for (let j = i + 1; j < tasks.length; j++) {
      const right = tasks[j]!;
      const isConflicting = conflicting(left, right);
      const isDep =
        (dependencies?.get(left.id)?.has(right.id) ?? false) ||
        (dependencies?.get(right.id)?.has(left.id) ?? false);
      if (isConflicting || isDep) {
        adj.get(left.id)?.add(right.id);
        adj.get(right.id)?.add(left.id);
      }
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const t of tasks) {
    if (visited.has(t.id)) continue;
    const comp: string[] = [];
    const queue: string[] = [t.id];
    visited.add(t.id);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(curr);
      const neighbors = adj.get(curr) ?? new Set<string>();
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }

    comp.sort();
    components.push(comp);
  }

  const disjointComponentCount = components.length;
  const disjointnessScore = Number((disjointComponentCount / Math.max(1, tasks.length)).toFixed(2));

  return {
    disjointComponentCount,
    disjointnessScore,
    componentTaskIds: components,
  };
}
