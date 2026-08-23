import { isInteger, isRecord, objectList } from "../requirements/predicates.ts";

export interface GraphParts {
  issues: string[];
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  gates: Record<string, unknown>[];
}

export function graphParts(document: unknown): GraphParts {
  const issues: string[] = [];
  if (!isRecord(document))
    return { issues: ["graph document must be an object"], nodes: [], edges: [], gates: [] };
  if (document.schema !== "harness.graph") issues.push("graph schema must be harness.graph");
  if (!isInteger(document.version) || document.version !== 1)
    issues.push("graph version must be integer 1");
  if (!isInteger(document.revision) || document.revision < 1)
    issues.push("graph revision must be a positive integer");
  return {
    issues,
    nodes: objectList(document.nodes, "nodes", issues),
    edges: objectList(document.edges, "edges", issues),
    gates: objectList(document.gates, "gates", issues),
  };
}
