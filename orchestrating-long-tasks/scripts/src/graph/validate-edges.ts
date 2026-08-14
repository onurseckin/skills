import { EDGE_TYPES } from "./constants.ts";

export function validateEdges(
  edges: readonly Record<string, unknown>[],
  nodeIds: ReadonlySet<string>,
  nodeById: ReadonlyMap<string, Record<string, unknown>>,
  artifactIds: ReadonlySet<string>,
  issues: string[],
): Map<string, Set<string>> {
  const keys = new Set<string>();
  const produced = new Map<string, Set<string>>();
  edges.forEach((edge, index) => {
    const prefix = `edges[${index}]`;
    const { source, target, type } = edge;
    if (typeof source === "string" && typeof target === "string" && typeof type === "string") {
      const key = JSON.stringify([source, target, type]);
      if (keys.has(key)) issues.push(`duplicate edge: ${source} ${type} ${target}`);
      keys.add(key);
    } else issues.push(`${prefix} source, target, and type must be strings`);
    if (
      typeof source !== "string" ||
      typeof target !== "string" ||
      !nodeIds.has(source) ||
      !nodeIds.has(target)
    ) {
      issues.push(`${prefix} references an unknown endpoint`);
      return;
    }
    if (typeof type !== "string" || !EDGE_TYPES.has(type)) {
      issues.push(`${prefix}.type is invalid`);
      return;
    }
    if (type === "produces") {
      if (nodeById.get(source)?.type !== "task" || !artifactIds.has(target)) {
        issues.push("produces edges must connect a task to an artifact");
      } else {
        const artifacts = produced.get(source) ?? new Set<string>();
        artifacts.add(target);
        produced.set(source, artifacts);
      }
    }
  });
  return produced;
}
