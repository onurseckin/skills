import { downstreamMap, topologicalOrder } from "../topology.ts";
import type { CriticalPathDrag, ForensicTaskNode, TaskSlack } from "./types.ts";

export function extractNeighbors(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  nodeId: string,
): string[] {
  const set = dependencies.get(nodeId);
  if (set !== undefined) {
    return Array.from(set).sort();
  }
  return [];
}

export function extractEffort(task: ForensicTaskNode): number {
  if (typeof task.effort === "number" && task.effort >= 0) {
    return task.effort;
  }
  return 1;
}

export function extractEffortById(effortMap: ReadonlyMap<string, number>, taskId: string): number {
  const val = effortMap.get(taskId);
  if (typeof val === "number" && val >= 0) {
    return val;
  }
  return 1;
}

export function internalComputeSpan(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  overrideEffort?: ReadonlyMap<string, number> | undefined,
): {
  readonly spanMap: Map<string, number>;
  readonly criticalSpan: number;
  readonly criticalPath: readonly string[];
} {
  const effortMap = new Map<string, number>();
  for (const task of tasks) {
    if (overrideEffort !== undefined && overrideEffort.has(task.id)) {
      const ov = overrideEffort.get(task.id);
      if (typeof ov === "number") {
        effortMap.set(task.id, Math.max(0, ov));
      } else {
        effortMap.set(task.id, extractEffort(task));
      }
    } else {
      effortMap.set(task.id, extractEffort(task));
    }
  }

  const order = topologicalOrder(dependencies);
  const spanMap = new Map<string, number>();
  const parentOnCriticalPath = new Map<string, string | null>();

  for (const taskId of order) {
    const taskEffort = extractEffortById(effortMap, taskId);
    const prereqs = extractNeighbors(dependencies, taskId);
    let maxPrereqSpan = 0;
    let criticalParent: string | null = null;

    for (const prereq of prereqs) {
      const pSpan = spanMap.get(prereq);
      const prereqSpan = typeof pSpan === "number" ? pSpan : 0;
      if (prereqSpan > maxPrereqSpan) {
        maxPrereqSpan = prereqSpan;
        criticalParent = prereq;
      }
    }

    spanMap.set(taskId, maxPrereqSpan + taskEffort);
    parentOnCriticalPath.set(taskId, criticalParent);
  }

  for (const task of tasks) {
    if (!spanMap.has(task.id)) {
      spanMap.set(task.id, extractEffortById(effortMap, task.id));
      parentOnCriticalPath.set(task.id, null);
    }
  }

  let criticalSpan = 0;
  let criticalEndTask: string | null = null;

  for (const [taskId, span] of spanMap.entries()) {
    if (span > criticalSpan) {
      criticalSpan = span;
      criticalEndTask = taskId;
    }
  }

  const criticalPathReversed: string[] = [];
  let curr = criticalEndTask;
  while (curr !== null) {
    criticalPathReversed.push(curr);
    const next = parentOnCriticalPath.get(curr);
    if (next !== undefined && next !== null) {
      curr = next;
    } else {
      curr = null;
    }
  }
  const criticalPath = criticalPathReversed.reverse();

  return { spanMap, criticalSpan, criticalPath };
}

export function computeCriticalPathDrag(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): CriticalPathDrag[] {
  const base = internalComputeSpan(tasks, dependencies);
  const criticalSet = new Set(base.criticalPath);
  const results: CriticalPathDrag[] = [];

  for (const task of tasks) {
    const effort = extractEffort(task);
    const isCritical = criticalSet.has(task.id);

    if (!isCritical) {
      results.push({
        taskId: task.id,
        effort,
        isCritical: false,
        drag: 0,
        dragPercentage: 0,
        dragCostSummary: `Task ${task.id} has 0 drag (non-critical, slack > 0).`,
      });
      continue;
    }

    if (base.criticalSpan <= 0) {
      results.push({
        taskId: task.id,
        effort,
        isCritical: true,
        drag: 0,
        dragPercentage: 0,
        dragCostSummary: `Task ${task.id} has 0 drag (total span is 0).`,
      });
      continue;
    }

    const override = new Map<string, number>([[task.id, 0]]);
    const counterfactual = internalComputeSpan(tasks, dependencies, override);
    const drag = Math.max(0, base.criticalSpan - counterfactual.criticalSpan);
    const dragPercentage =
      base.criticalSpan > 0 ? Math.round((drag / base.criticalSpan) * 10000) / 100 : 0;

    results.push({
      taskId: task.id,
      effort,
      isCritical: true,
      drag,
      dragPercentage,
      dragCostSummary:
        `Task ${task.id} exerts ${drag} units of critical path drag (${dragPercentage}% of total span ${base.criticalSpan}). ` +
        `Shortening ${task.id} by ${drag} reduces total project duration to ${counterfactual.criticalSpan}.`,
    });
  }

  return results;
}

export function computeTaskSlack(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, TaskSlack> {
  const effortMap = new Map<string, number>();
  for (const t of tasks) {
    effortMap.set(t.id, extractEffort(t));
  }

  const order = topologicalOrder(dependencies);
  const estMap = new Map<string, number>();
  const eftMap = new Map<string, number>();

  for (const id of order) {
    const effort = extractEffortById(effortMap, id);
    const prereqs = extractNeighbors(dependencies, id);
    let maxEft = 0;
    for (const p of prereqs) {
      const pEft = eftMap.get(p);
      const val = typeof pEft === "number" ? pEft : 0;
      if (val > maxEft) maxEft = val;
    }
    estMap.set(id, maxEft);
    eftMap.set(id, maxEft + effort);
  }

  let totalSpan = 0;
  for (const eft of eftMap.values()) {
    if (eft > totalSpan) totalSpan = eft;
  }

  const downstream = downstreamMap(dependencies);
  const lstMap = new Map<string, number>();
  const lftMap = new Map<string, number>();

  const reversedOrder = Array.from(order).reverse();
  for (const id of reversedOrder) {
    const effort = extractEffortById(effortMap, id);
    const childrenSet = downstream.get(id);
    const children: string[] = [];
    if (childrenSet !== undefined) {
      for (const c of childrenSet) {
        children.push(c);
      }
    }

    let minLst = totalSpan;
    for (const c of children) {
      const cLst = lstMap.get(c);
      const val = typeof cLst === "number" ? cLst : totalSpan;
      if (val < minLst) minLst = val;
    }
    lftMap.set(id, minLst);
    lstMap.set(id, minLst - effort);
  }

  const result = new Map<string, TaskSlack>();
  for (const t of tasks) {
    const effort = extractEffortById(effortMap, t.id);
    const rawEst = estMap.get(t.id);
    const est = typeof rawEst === "number" ? rawEst : 0;

    const rawEft = eftMap.get(t.id);
    const eft = typeof rawEft === "number" ? rawEft : effort;

    const rawLft = lftMap.get(t.id);
    const lft = typeof rawLft === "number" ? rawLft : totalSpan;

    const rawLst = lstMap.get(t.id);
    const lst = typeof rawLst === "number" ? rawLst : totalSpan - effort;

    const totalSlack = Math.max(0, lst - est);

    const childrenSet = downstream.get(t.id);
    let minChildEst = totalSpan;
    if (childrenSet !== undefined && childrenSet.size > 0) {
      for (const childId of childrenSet) {
        const childEst = estMap.get(childId);
        const val = typeof childEst === "number" ? childEst : totalSpan;
        if (val < minChildEst) {
          minChildEst = val;
        }
      }
    }
    const freeSlack = Math.max(0, minChildEst - eft);
    const isCritical = totalSlack === 0;

    result.set(t.id, {
      taskId: t.id,
      effort,
      earliestStartTime: est,
      earliestFinishTime: eft,
      latestStartTime: lst,
      latestFinishTime: lft,
      totalSlack,
      freeSlack,
      isCritical,
    });
  }

  return result;
}
