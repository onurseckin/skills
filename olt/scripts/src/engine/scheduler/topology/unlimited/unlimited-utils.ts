import { HarnessError } from "../../../../core/errors/index.ts";
import { type DependencyMap, topologicalOrder } from "../../../../graph/dag-forensics.ts";
import { isInteger } from "../../../../requirements/predicates.ts";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
import { scopeConflict, resourceConflict } from "../../conflict/conflicts.ts";
import { type ScheduledTask } from "../../conflict/rank.ts";
import { type CriticalPathDepthResult } from "./unlimited-types.ts";

export function taskRecord(value: unknown): value is ScheduledTask {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isInteger(value.priority) &&
    isInteger(value.created_order) &&
    isInteger(value.effort) &&
    Array.isArray(value.requirement_ids) &&
    value.requirement_ids.every((id) => typeof id === "string") &&
    (value.resource_scope === undefined ||
      (Array.isArray(value.resource_scope) &&
        value.resource_scope.every((scope) => typeof scope === "string"))) &&
    Array.isArray(value.write_scope) &&
    value.write_scope.every((scope) => typeof scope === "string")
  );
}
export function conflicting(left: ScheduledTask, right: ScheduledTask): boolean {
  const leftResource = Array.isArray(left.resource_scope) ? left.resource_scope : [];
  const rightResource = Array.isArray(right.resource_scope) ? right.resource_scope : [];
  return (
    scopeConflict(left.write_scope, right.write_scope) ||
    resourceConflict(leftResource, rightResource)
  );
}
export function derivedRationale(
  wave: number,
  prerequisites: readonly string[],
  overlaps: readonly string[],
  maxParallel: number,
): string {
  const clauses: string[] = [];
  if (prerequisites.length > 0) clauses.push(`depends on ${prerequisites.join(", ")}`);
  if (overlaps.length > 0) clauses.push(`write scope overlaps ${overlaps.join(", ")}`);
  if (clauses.length === 0) {
    clauses.push(
      `no dependency or scope conflict; ranked into wave ${wave} with max_parallel ${maxParallel}`,
    );
  }
  return `wave ${wave}: ${clauses.join("; ")}`;
}
export function computeCriticalPathDepth(
  dependencies: DependencyMap | ReadonlyMap<string, ReadonlySet<string>>,
  tasks:
    | ReadonlyMap<string, ScheduledTask>
    | readonly ScheduledTask[]
    | Readonly<Record<string, ScheduledTask>>,
): CriticalPathDepthResult {
  const taskMap = new Map<string, ScheduledTask>();
  if (tasks instanceof Map) {
    for (const [id, t] of tasks) {
      taskMap.set(id, t);
    }
  } else if (Array.isArray(tasks)) {
    for (const t of tasks) {
      taskMap.set(t.id, t);
    }
  } else if (isRecord(tasks)) {
    for (const [id, t] of Object.entries(tasks)) {
      if (taskRecord(t)) {
        taskMap.set(id, t);
      }
    }
  }

  const order = topologicalOrder(dependencies);
  if (order.length !== dependencies.size) {
    throw new HarnessError("INTEGRITY", "depends_on edges contain an execution cycle");
  }

  if (order.length === 0) {
    return {
      depth: 0,
      criticalPath: [],
      longestChainEffort: 0,
    };
  }

  const cumulativeNodes = new Map<string, number>();
  const cumulativeEffort = new Map<string, number>();
  const parentOnCriticalPath = new Map<string, string | null>();

  for (const taskId of order) {
    const task = taskMap.get(taskId);
    const taskEffort = task && isInteger(task.effort) && task.effort > 0 ? task.effort : 1;
    const prereqsSet = dependencies.get(taskId);
    const prereqs = prereqsSet !== undefined ? prereqsSet : new Set<string>();

    let maxPrereqNodes = 0;
    let maxPrereqEffort = 0;
    let bestPrereq: string | null = null;

    for (const prereqId of prereqs) {
      const nodesVal = cumulativeNodes.get(prereqId);
      const prereqNodes = typeof nodesVal === "number" ? nodesVal : 0;
      const effortVal = cumulativeEffort.get(prereqId);
      const prereqEffort = typeof effortVal === "number" ? effortVal : 0;

      if (
        prereqNodes > maxPrereqNodes ||
        (prereqNodes === maxPrereqNodes && prereqEffort > maxPrereqEffort)
      ) {
        maxPrereqNodes = prereqNodes;
        maxPrereqEffort = prereqEffort;
        bestPrereq = prereqId;
      }
    }

    cumulativeNodes.set(taskId, maxPrereqNodes + 1);
    let previousEffort = 0;
    if (bestPrereq !== null) {
      const bestVal = cumulativeEffort.get(bestPrereq);
      if (typeof bestVal === "number") {
        previousEffort = bestVal;
      }
    }
    cumulativeEffort.set(taskId, previousEffort + taskEffort);
    parentOnCriticalPath.set(taskId, bestPrereq);
  }

  let maxDepth = 0;
  let maxEffort = 0;
  let criticalEndTask: string | null = null;

  for (const [taskId, depth] of cumulativeNodes.entries()) {
    const rawEffort = cumulativeEffort.get(taskId);
    const effort = typeof rawEffort === "number" ? rawEffort : 0;
    if (depth > maxDepth || (depth === maxDepth && effort > maxEffort)) {
      maxDepth = depth;
      maxEffort = effort;
      criticalEndTask = taskId;
    }
  }

  const criticalPath: string[] = [];
  let curr = criticalEndTask;
  while (curr !== null) {
    criticalPath.unshift(curr);
    const parent = parentOnCriticalPath.get(curr);
    curr = typeof parent === "string" ? parent : null;
  }

  return {
    depth: maxDepth,
    criticalPath,
    longestChainEffort: maxEffort,
  };
}
