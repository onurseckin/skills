import { isIdentifier, isNonblank } from "../requirements/predicates.ts";
import { NODE_TYPES } from "./constants.ts";

export interface NodeValidation {
  nodeIds: Set<string>;
  nodeById: Map<string, Record<string, unknown>>;
  tasks: Record<string, unknown>[];
  artifactIds: Set<string>;
  requirementCounts: Map<string, number>;
}

export function validateNodes(
  nodes: readonly Record<string, unknown>[],
  requirementIds: ReadonlySet<string>,
  issues: string[],
): NodeValidation {
  const nodeIds = new Set<string>();
  const nodeById = new Map<string, Record<string, unknown>>();
  const tasks: Record<string, unknown>[] = [];
  const artifactIds = new Set<string>();
  const requirementCounts = new Map([...requirementIds].map((id) => [id, 0]));
  nodes.forEach((node, index) => {
    const prefix = `nodes[${index}]`;
    const id = node.id;
    if (!isIdentifier(id)) issues.push(`${prefix}.id must be a valid identifier`);
    else if (nodeIds.has(id)) issues.push(`duplicate node id: ${id}`);
    else {
      nodeIds.add(id);
      nodeById.set(id, node);
    }
    const type = node.type;
    if (typeof type !== "string" || !NODE_TYPES.has(type)) issues.push(`${prefix}.type is invalid`);
    if (!isNonblank(node.label)) issues.push(`${prefix}.label must be non-blank text`);
    if (type === "requirement") {
      const requirementId = node.requirement_id;
      if (typeof requirementId !== "string" || !requirementIds.has(requirementId)) {
        issues.push(`${prefix}.requirement_id is unknown`);
      } else requirementCounts.set(requirementId, (requirementCounts.get(requirementId) ?? 0) + 1);
    } else if (type === "artifact" && typeof id === "string") artifactIds.add(id);
    else if (type === "task") tasks.push(node);
  });
  return { nodeIds, nodeById, tasks, artifactIds, requirementCounts };
}
