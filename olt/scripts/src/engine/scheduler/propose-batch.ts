import { dependencyMap } from "../../graph/dependency-map.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { isInteger, isRecord } from "../../requirements/predicates.ts";
import { taskExecutionState } from "../../workflow/authority/execution-state.ts";
import { hasActiveOwnership, resourceConflict, scopeConflict } from "./conflicts.ts";
import { schedulingMetrics } from "./metrics.ts";
import { rankTasks, type ScheduledTask } from "./rank.ts";

function taskRecord(value: unknown): value is ScheduledTask {
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

const DISPATCHABLE_STATUSES = new Set(["proposed", "ready", "retry_ready"]);

function dispatchable(task: ScheduledTask): boolean {
  return DISPATCHABLE_STATUSES.has(String(task.status));
}

function occupiesScope(task: ScheduledTask): boolean {
  return hasActiveOwnership(task.status) && !dispatchable(task);
}

function conflicts(left: ScheduledTask, right: ScheduledTask): boolean {
  return (
    scopeConflict(left.write_scope, right.write_scope) ||
    resourceConflict(left.resource_scope ?? [], right.resource_scope ?? [])
  );
}

export function proposeBatch(state: unknown, maxParallel: number | null = null): ScheduledTask[] {
  if (maxParallel !== null && (!isInteger(maxParallel) || maxParallel < 1)) {
    throw new HarnessError("INVALID_ARGUMENT", "maxParallel must be a positive integer or null");
  }
  if (!isRecord(state) || !isRecord(state.graph) || !isRecord(state.tasks)) {
    throw new HarnessError("INVALID_STATE", "a plan must be applied before scheduling");
  }
  const dependencies = dependencyMap(state.graph);
  const tasks = new Map<string, ScheduledTask>();
  for (const [id, value] of Object.entries(state.tasks)) {
    if (taskRecord(value)) tasks.set(id, { ...value, resource_scope: value.resource_scope ?? [] });
  }
  const done = new Set([...tasks].filter(([, task]) => task.status === "done").map(([id]) => id));
  const metrics = schedulingMetrics(dependencies);
  const occupied = [...tasks.values()].filter(occupiesScope);
  const eligible = rankTasks(
    [...tasks]
      .filter(([id, task]) => {
        return (
          dispatchable(task) &&
          taskExecutionState(state, task.requirement_ids) === "executable" &&
          !occupied.some((running) => conflicts(task, running)) &&
          [...(dependencies.get(id) ?? [])].every((dependency) => done.has(dependency))
        );
      })
      .map(([, task]) => task),
    metrics,
  );
  const selected: ScheduledTask[] = [];
  for (const candidate of eligible) {
    if (selected.some((chosen) => conflicts(candidate, chosen))) continue;
    selected.push(candidate);
    if (maxParallel !== null && selected.length >= maxParallel) break;
  }
  return structuredClone(selected);
}
