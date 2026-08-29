import { HarnessError } from "../core/errors/index.ts";
import { isInteger, isRecord } from "../requirements/predicates.ts";
import {
  executionActive,
  gateContractActive,
  producedArtifacts,
  requirementContract,
  sameJson,
  taskContract,
  taskGates,
} from "./plan-contract.ts";
import type { DependencyMap } from "./topology.ts";

function tasksById(graph: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  return new Map(
    nodes
      .filter(
        (node): node is Record<string, unknown> =>
          isRecord(node) && node.type === "task" && typeof node.id === "string",
      )
      .map((task) => [task.id as string, task]),
  );
}

function hasSupersession(graph: Record<string, unknown>, taskId: string): boolean {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRecord) : [];
  const decisions = new Set(
    nodes
      .filter(
        (node) =>
          node.type === "decision" &&
          node.superseded_task_id === taskId &&
          typeof node.explanation === "string" &&
          node.explanation.trim().length > 0 &&
          typeof node.id === "string",
      )
      .map(({ id }) => id as string),
  );
  const taskIds = new Set(
    nodes.filter(({ type, id }) => type === "task" && typeof id === "string").map(({ id }) => id),
  );
  return (
    decisions.size > 0 &&
    Array.isArray(graph.edges) &&
    graph.edges.some(
      (edge) =>
        isRecord(edge) &&
        edge.type === "supersedes" &&
        typeof edge.source === "string" &&
        taskIds.has(edge.source) &&
        typeof edge.target === "string" &&
        decisions.has(edge.target),
    )
  );
}

export function guardPlanRevision(
  state: Record<string, unknown>,
  requirements: Record<string, unknown>,
  graph: Record<string, unknown>,
  dependencies: DependencyMap,
): void {
  if (state.graph === undefined || state.graph === null) {
    if (graph.revision !== 1)
      throw new HarnessError("INVALID_STATE", "initial graph revision must be 1");
    return;
  }
  if (
    !isRecord(state.graph) ||
    !isInteger(state.graph.revision) ||
    graph.revision !== state.graph.revision + 1
  ) {
    throw new HarnessError("INVALID_STATE", "graph revision must increase by exactly one");
  }
  if (
    !isRecord(state.requirements) ||
    !sameJson(requirementContract(requirements), requirementContract(state.requirements))
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      "a plan revision cannot change requirement source contracts",
    );
  }
  if (!isRecord(state.tasks))
    throw new HarnessError("INVALID_STATE", "tasks projection must be an object");
  const newTasks = tasksById(graph);
  const oldTasks = tasksById(state.graph);
  const newProduced = producedArtifacts(graph);
  const oldProduced = producedArtifacts(state.graph);
  for (const [taskId, runtimeValue] of Object.entries(state.tasks)) {
    if (!isRecord(runtimeValue)) continue;
    const active = executionActive(runtimeValue.status);
    if (active && !newTasks.has(taskId)) {
      throw new HarnessError("INVALID_STATE", `plan revision cannot delete active task ${taskId}`);
    }
    if (!active && !newTasks.has(taskId) && !hasSupersession(graph, taskId)) {
      throw new HarnessError(
        "INVALID_STATE",
        `plan revision cannot remove planned task ${taskId} without supersedes explanation`,
      );
    }
    if (!active || !newTasks.has(taskId)) continue;
    const oldTask = oldTasks.get(taskId);
    if (!oldTask)
      throw new HarnessError(
        "INVALID_STATE",
        `active task ${taskId} is missing from the prior graph`,
      );
    if (
      !Array.isArray(runtimeValue.dependencies) ||
      !runtimeValue.dependencies.every((dependency) => typeof dependency === "string")
    ) {
      throw new HarnessError(
        "INVALID_STATE",
        `active task ${taskId} has invalid dependency history`,
      );
    }
    const oldContract = taskContract(
      oldTask,
      new Set(runtimeValue.dependencies as string[]),
      oldProduced.get(taskId) ?? new Set(),
    );
    const newContract = taskContract(
      newTasks.get(taskId)!,
      dependencies.get(taskId) ?? new Set(),
      newProduced.get(taskId) ?? new Set(),
    );
    if (!sameJson(oldContract, newContract)) {
      throw new HarnessError(
        "INVALID_STATE",
        `plan revision cannot change active task ${taskId} contract`,
      );
    }
    if (
      gateContractActive(runtimeValue.status) &&
      !sameJson(taskGates(state.graph, oldTask), taskGates(graph, newTasks.get(taskId)!))
    ) {
      throw new HarnessError(
        "INVALID_STATE",
        `plan revision cannot change active task ${taskId} gates`,
      );
    }
  }
}
