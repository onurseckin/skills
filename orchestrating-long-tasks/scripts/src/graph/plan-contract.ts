import { jsonCopy, sameJson } from "../core/json.ts";
import { PLANNABLE_TASK_STATUSES, RUNTIME_TASK_FIELDS } from "./constants.ts";

export { jsonCopy, sameJson };

export function requirementContract(document: Record<string, unknown>): Record<string, unknown> {
  const contract = jsonCopy(document);
  if (Array.isArray(contract.requirements))
    for (const requirement of contract.requirements) {
      if (typeof requirement === "object" && requirement !== null && !Array.isArray(requirement)) {
        delete (requirement as Record<string, unknown>).status;
        delete (requirement as Record<string, unknown>).evidence;
        delete (requirement as Record<string, unknown>).authority_status;
        delete (requirement as Record<string, unknown>).authority_history;
      }
    }
  return contract;
}

export function producedArtifacts(graph: Record<string, unknown>): Map<string, Set<string>> {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const taskIds = new Set(
    nodes
      .filter(
        (node): node is Record<string, unknown> =>
          typeof node === "object" &&
          node !== null &&
          !Array.isArray(node) &&
          node.type === "task" &&
          typeof node.id === "string",
      )
      .map(({ id }) => id as string),
  );
  const produced = new Map([...taskIds].map((id) => [id, new Set<string>()]));
  if (Array.isArray(graph.edges))
    for (const edge of graph.edges) {
      if (typeof edge === "object" && edge !== null && !Array.isArray(edge)) {
        const item = edge as Record<string, unknown>;
        if (
          item.type === "produces" &&
          typeof item.source === "string" &&
          taskIds.has(item.source) &&
          typeof item.target === "string"
        ) {
          produced.get(item.source)!.add(item.target);
        }
      }
    }
  return produced;
}

export function taskGates(
  graph: Record<string, unknown>,
  task: Record<string, unknown>,
): Record<string, unknown>[] {
  const requirements = new Set(
    Array.isArray(task.requirement_ids)
      ? task.requirement_ids.filter((id): id is string => typeof id === "string")
      : [],
  );
  if (!Array.isArray(graph.gates)) return [];
  return graph.gates
    .filter(
      (gate): gate is Record<string, unknown> =>
        typeof gate === "object" &&
        gate !== null &&
        !Array.isArray(gate) &&
        gate.scope === "task" &&
        Array.isArray(gate.requirement_ids) &&
        gate.requirement_ids.some((id: unknown) => typeof id === "string" && requirements.has(id)),
    )
    .map(jsonCopy)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export function taskContract(
  task: Record<string, unknown>,
  dependencies: ReadonlySet<string>,
  produced: ReadonlySet<string>,
): Record<string, unknown> {
  const contract = Object.fromEntries(
    Object.entries(task)
      .filter(([key]) => !RUNTIME_TASK_FIELDS.has(key))
      .map(([key, value]) => [key, jsonCopy(value)]),
  );
  contract.dependencies = [...dependencies].sort();
  contract.produces = [...produced].sort();
  return contract;
}

export function executionActive(status: unknown): boolean {
  if (typeof status !== "string" || !status.trim()) {
    throw new Error("persisted task status must be non-blank text");
  }
  return !PLANNABLE_TASK_STATUSES.has(status);
}
