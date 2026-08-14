import { HarnessError } from "../errors/harness-error.ts";
import { isRecord } from "../requirements/predicates.ts";
import { RUNTIME_TASK_FIELDS } from "./constants.ts";
import { jsonCopy } from "./plan-contract.ts";
import type { DependencyMap } from "./topology.ts";
import { validateGraph } from "./validate-graph.ts";

function graphTasks(graph: Record<string, unknown>): Record<string, unknown>[] {
  return (graph.nodes as unknown[]).filter(
    (node): node is Record<string, unknown> => isRecord(node) && node.type === "task",
  );
}

function preserveRequirementRuntime(projected: Record<string, unknown>, previous: unknown): void {
  if (
    !isRecord(previous) ||
    !Array.isArray(previous.requirements) ||
    !Array.isArray(projected.requirements)
  )
    return;
  const existing = new Map(
    previous.requirements.filter(isRecord).map((requirement) => [requirement.id, requirement]),
  );
  for (const value of projected.requirements)
    if (isRecord(value)) {
      const prior = existing.get(value.id);
      if (!prior) continue;
      for (const key of ["status", "evidence", "authority_status", "authority_history"] as const) {
        if (key in prior) value[key] = jsonCopy(prior[key]);
      }
    }
}

export function projectPlan(
  state: Record<string, unknown>,
  requirements: Record<string, unknown>,
  graph: Record<string, unknown>,
  dependencies: DependencyMap,
): void {
  const oldGraph = state.graph;
  const oldRequirements = state.requirements;
  const existingTasks = isRecord(state.tasks) ? state.tasks : {};
  const projectedRequirements = jsonCopy(requirements);
  preserveRequirementRuntime(projectedRequirements, oldRequirements);
  const projectedGraph = jsonCopy(graph);
  const projectedGraphTasks = new Map(
    graphTasks(projectedGraph).map((task) => [task.id as string, task]),
  );
  const projectedTasks: Record<string, Record<string, unknown>> = {};
  const order: string[] = [];
  for (const graphTask of graphTasks(graph)) {
    const taskId = graphTask.id as string;
    order.push(taskId);
    const projected = jsonCopy(graphTask);
    const existing = existingTasks[taskId];
    if (isRecord(existing))
      for (const key of RUNTIME_TASK_FIELDS) {
        if (key !== "dependencies" && key in existing) projected[key] = jsonCopy(existing[key]);
      }
    projected.dependencies = [...(dependencies.get(taskId) ?? [])].sort();
    if (!("history" in projected)) projected.history = [];
    projectedTasks[taskId] = projected;
    projectedGraphTasks.get(taskId)!.status = projected.status;
  }
  const projectionIssues = validateGraph(projectedGraph, projectedRequirements, {
    allowRuntimeStatuses: true,
  });
  if (projectionIssues.length)
    throw new HarnessError("INTEGRITY", "projected plan is invalid", projectionIssues);
  if (projectedGraphTasks.size !== Object.keys(projectedTasks).length) {
    throw new HarnessError("INVALID_STATE", "graph and task projections have different task IDs");
  }
  for (const [taskId, task] of Object.entries(projectedTasks)) {
    if (projectedGraphTasks.get(taskId)?.status !== task.status) {
      throw new HarnessError(
        "INVALID_STATE",
        `graph and task projections disagree on ${taskId} status`,
      );
    }
    if (
      !Array.isArray(task.dependencies) ||
      !sameStrings(task.dependencies, [...(dependencies.get(taskId) ?? [])].sort())
    ) {
      throw new HarnessError(
        "INVALID_STATE",
        `graph and task projections disagree on ${taskId} dependencies`,
      );
    }
  }
  const history = Array.isArray(state.plan_history) ? jsonCopy(state.plan_history) : undefined;
  if (!history) throw new HarnessError("INVALID_STATE", "plan_history must be a list");
  if (oldGraph !== undefined && oldGraph !== null)
    history.push({
      requirements: jsonCopy(oldRequirements),
      graph: jsonCopy(oldGraph),
      replaced_by_revision: graph.revision,
      recorded_state_revision: state.revision,
    });
  state.requirements = projectedRequirements;
  state.graph = projectedGraph;
  state.task_order = order;
  state.tasks = projectedTasks;
  state.plan_history = history;
}

function sameStrings(left: unknown[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
