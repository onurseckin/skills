import { isIdentifier, isInteger, isRepoRelativePath } from "../requirements/predicates.ts";
import { MAX_EFFORT, PLANNABLE_TASK_STATUSES, TASK_STATUSES } from "./constants.ts";

function references(
  raw: unknown,
  task: string,
  kind: string,
  known: ReadonlySet<string>,
  issues: string[],
): Set<string> {
  const valid = new Set<string>();
  if (!Array.isArray(raw)) {
    issues.push(`${task}.${kind}_ids must be a list`);
    return valid;
  }
  for (const id of raw) {
    if (typeof id !== "string") issues.push(`${task} has a non-string ${kind} reference`);
    else if (!known.has(id)) issues.push(`${task} references unknown ${kind} ${id}`);
    else if (valid.has(id)) issues.push(`${task} repeats ${kind} ${id}`);
    else valid.add(id);
  }
  return valid;
}

export function validateTasks(
  tasks: readonly Record<string, unknown>[],
  requirementIds: ReadonlySet<string>,
  artifactIds: ReadonlySet<string>,
  produced: ReadonlyMap<string, ReadonlySet<string>>,
  issues: string[],
  allowRuntimeStatuses = false,
): {
  coverage: Map<string, number>;
  taskById: Map<string, Record<string, unknown>>;
  ownedArtifacts: Set<string>;
} {
  const coverage = new Map([...requirementIds].map((id) => [id, 0]));
  const taskById = new Map<string, Record<string, unknown>>();
  const ownedArtifacts = new Set<string>();
  tasks.forEach((task, index) => {
    const id = typeof task.id === "string" ? task.id : String(index);
    const prefix = `task ${id}`;
    if (typeof task.id === "string") taskById.set(task.id, task);
    const requirementReferences = references(
      task.requirement_ids,
      prefix,
      "requirement",
      requirementIds,
      issues,
    );
    if (!Array.isArray(task.requirement_ids) || task.requirement_ids.length === 0) {
      issues.push(`${prefix} must reference at least one requirement`);
    }
    for (const requirementId of requirementReferences) {
      coverage.set(requirementId, (coverage.get(requirementId) ?? 0) + 1);
    }
    if (!Array.isArray(task.write_scope) || task.write_scope.length === 0) {
      issues.push(`${prefix} must declare a non-empty write_scope`);
    } else {
      const scopes = new Set<string>();
      for (const scope of task.write_scope) {
        if (!isRepoRelativePath(scope)) issues.push(`${prefix} has a non-normalized write scope`);
        else if (scopes.has(scope)) issues.push(`${prefix} repeats write scope ${scope}`);
        else scopes.add(scope);
      }
    }
    if (!Array.isArray(task.resource_scope)) {
      issues.push(`${prefix}.resource_scope must be a list`);
    } else {
      const resources = new Set<string>();
      for (const resource of task.resource_scope) {
        if (!isIdentifier(resource)) issues.push(`${prefix} has an invalid resource scope`);
        else if (resources.has(resource)) issues.push(`${prefix} repeats resource ${resource}`);
        else resources.add(resource);
      }
    }
    const explicit =
      task.artifact_ids === undefined
        ? new Set<string>()
        : references(task.artifact_ids, prefix, "artifact", artifactIds, issues);
    if (explicit.size === 0 && (produced.get(id)?.size ?? 0) === 0) {
      issues.push(`${prefix} must produce at least one artifact`);
    }
    for (const artifact of explicit) ownedArtifacts.add(artifact);
    for (const artifact of produced.get(id) ?? []) ownedArtifacts.add(artifact);
    if (
      typeof task.status !== "string" ||
      !(allowRuntimeStatuses ? TASK_STATUSES : PLANNABLE_TASK_STATUSES).has(task.status)
    )
      issues.push(`${prefix}.status is invalid`);
    if (!isInteger(task.priority)) issues.push(`${prefix}.priority must be an integer`);
    if (!isInteger(task.created_order) || task.created_order < 0)
      issues.push(`${prefix}.created_order must be a non-negative integer`);
    if (!isInteger(task.effort) || task.effort < 1 || task.effort > MAX_EFFORT) {
      issues.push(`${prefix}.effort must be between 1 and ${MAX_EFFORT}`);
    }
  });
  return { coverage, taskById, ownedArtifacts };
}
