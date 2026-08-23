import { HarnessError } from "../core/errors/harness-error.ts";
import { graphParts } from "./parts.ts";
import { dependencyData, type DependencyMap } from "./topology.ts";

export function dependencyMap(graph: unknown): DependencyMap {
  const { issues, nodes, edges } = graphParts(graph);
  const nodeIds = new Set(
    nodes.filter(({ id }) => typeof id === "string").map(({ id }) => id as string),
  );
  for (const edge of edges) {
    if (
      typeof edge.source !== "string" ||
      typeof edge.target !== "string" ||
      !nodeIds.has(edge.source) ||
      !nodeIds.has(edge.target)
    ) {
      issues.push("edge references an unknown endpoint");
    }
  }
  const dependencyResult = dependencyData(nodes, edges);
  issues.push(...dependencyResult.issues);
  if (issues.length) throw new HarnessError("INTEGRITY", "graph is not executable", issues);
  return dependencyResult.dependencies;
}
