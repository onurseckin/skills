import { topologicalOrder, type DependencyMap } from "../../../graph/topology.ts";
import { isInteger } from "../../../requirements/predicates.ts";
import type { WorkflowState } from "../../../workflow/types.ts";
import type {
  ClosedLoopRepairPayload,
  CompiledRepairDag,
  CompiledRepairDagNode,
} from "./critic-types.ts";

export function compileRepairDag(
  payloads: readonly ClosedLoopRepairPayload[],
  state: WorkflowState,
  roundNumber: number,
): CompiledRepairDag {
  const nodes: CompiledRepairDagNode[] = [];
  const dominatingDirectives: string[] = [];

  dominatingDirectives.push(
    `[DOMINATING REPAIR DAG COMPILATION — ROUND ${roundNumber}]`,
    "1. Strict Hierarchical Execution: Repairers must execute only within their leased write scope.",
    "2. Zero Scope Creep: Modification outside scoped write paths is blocked by Harness Doctor.",
    "3. Mandatory Counterfactual Proof: All revalidation gates must pass before submitting task.",
  );

  const depsMap: DependencyMap = new Map();
  const taskMap = new Map<string, { effort: number }>();

  for (const payload of payloads) {
    const task = state.tasks[payload.taskId];
    const taskDeps = task?.dependencies ?? [];
    depsMap.set(payload.taskId, new Set(taskDeps));
    taskMap.set(payload.taskId, {
      effort: isInteger(task?.effort) && task.effort > 0 ? task.effort : 1,
    });

    const revalCmd =
      payload.revalidationGates.length > 0
        ? payload.revalidationGates[0]!
        : `bun test --filter ${payload.taskId}`;

    nodes.push({
      taskId: payload.taskId,
      role: "repairer",
      tier: 2,
      status: payload.newStatus,
      repairRound: payload.repairRound,
      assignee: payload.binding.implementerId,
      validatorAssignee: payload.binding.validatorId,
      writeScope: [...payload.writeScope],
      dependencies: [...taskDeps],
      counterfactualRequirements: [...payload.counterfactualRequirements],
      revalidationCommand: revalCmd,
      directives: payload.repairDirectives,
    });
  }

  let isAcyclic = true;
  let criticalPath: string[] = [];
  let totalWork = 0;
  let totalSpan = 0;

  try {
    const order = topologicalOrder(depsMap);
    isAcyclic = order.length === depsMap.size;

    for (const id of depsMap.keys()) {
      totalWork += taskMap.get(id)?.effort ?? 1;
    }

    const cumulativeSpan = new Map<string, number>();
    const parentPath = new Map<string, string | null>();

    for (const taskId of order) {
      const effort = taskMap.get(taskId)?.effort ?? 1;
      const prereqs = depsMap.get(taskId) ?? new Set();
      let maxPrereq = 0;
      let bestP: string | null = null;
      for (const p of prereqs) {
        const s = cumulativeSpan.get(p) ?? 0;
        if (s > maxPrereq) {
          maxPrereq = s;
          bestP = p;
        }
      }
      cumulativeSpan.set(taskId, maxPrereq + effort);
      parentPath.set(taskId, bestP);
    }

    let maxSpan = 0;
    let endTask: string | null = null;
    for (const [id, span] of cumulativeSpan.entries()) {
      if (span > maxSpan) {
        maxSpan = span;
        endTask = id;
      }
    }

    let curr = endTask;
    while (curr !== null) {
      criticalPath.unshift(curr);
      curr = parentPath.get(curr) ?? null;
    }
    totalSpan = Math.max(1, maxSpan);
  } catch {
    isAcyclic = false;
    totalWork = Math.max(1, payloads.length);
    totalSpan = Math.max(1, payloads.length);
  }

  const work = Math.max(1, totalWork);
  const span = Math.max(1, totalSpan);
  const parallelismFactor = Number((work / span).toFixed(2));

  return {
    revision: (state.graph_revision ?? 1) + 1,
    roundNumber,
    nodes,
    totalWork: work,
    totalSpan: span,
    parallelismFactor,
    isAcyclic,
    criticalPath,
    dominatingDirectives,
  };
}

export function evaluateRepairCycleConvergence(state: WorkflowState): {
  readonly isConverged: boolean;
  readonly tasksInRepair: readonly string[];
  readonly escalatedTasks: readonly string[];
  readonly openFindingsCount: number;
} {
  const inRepair: string[] = [];
  const escalated: string[] = [];
  let openFindingsCount = 0;

  for (const task of Object.values(state.tasks)) {
    if (task.status === "changes_requested") {
      inRepair.push(task.id);
    } else if (task.status === "escalated") {
      escalated.push(task.id);
    }

    if (Array.isArray(task.findings)) {
      for (const f of task.findings) {
        if (f.status === "open") openFindingsCount += 1;
      }
    }
  }

  return {
    isConverged: inRepair.length === 0 && escalated.length === 0 && openFindingsCount === 0,
    tasksInRepair: inRepair.sort(),
    escalatedTasks: escalated.sort(),
    openFindingsCount,
  };
}
