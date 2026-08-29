import { createImplementerValidatorPair } from "../dynamic-expansion.ts";
import { jsonCopy } from "../plan-contract.ts";
import { normalizeScopePath } from "../scope-analyzer.ts";
import { validateGraph } from "../validate-graph.ts";
import type {
  ReplanFindingInput,
  ReplanFromFindingsInput,
  ReplanFromFindingsResult,
} from "./types.ts";

export function replanFromFindings(input: ReplanFromFindingsInput): ReplanFromFindingsResult {
  const currentGraph = jsonCopy(input.graphDocument);
  const nodes = Array.isArray(currentGraph.nodes)
    ? (currentGraph.nodes as Record<string, unknown>[])
    : [];
  const edges = Array.isArray(currentGraph.edges)
    ? (currentGraph.edges as Record<string, unknown>[])
    : [];
  const gates = Array.isArray(currentGraph.gates)
    ? (currentGraph.gates as Record<string, unknown>[])
    : [];

  const baseRevision = typeof currentGraph.revision === "number" ? currentGraph.revision : 1;
  const newRevision = baseRevision + 1;
  const round = input.round ?? newRevision;

  if (input.findings.length === 0) {
    return {
      success: true,
      graphDocument: currentGraph,
      newRevision: baseRevision,
      addedRepairTasks: [],
      pairedValidators: [],
      partitionedScopes: [],
    };
  }

  const scopeGroups = new Map<
    string,
    { scope: string[]; findings: ReplanFindingInput[]; gate: string }
  >();

  for (let i = 0; i < input.findings.length; i++) {
    const finding = input.findings[i]!;
    const scopes =
      finding.filePaths && finding.filePaths.length > 0
        ? finding.filePaths.map(normalizeScopePath)
        : ["src/repair"];
    const key = [...scopes].sort().join("::");
    const gate =
      finding.revalidationGate ??
      (typeof input.fallbackGate === "string" ? input.fallbackGate : input.fallbackGate.join(" "));

    if (!scopeGroups.has(key)) {
      scopeGroups.set(key, { scope: scopes, findings: [finding], gate });
    } else {
      scopeGroups.get(key)!.findings.push(finding);
    }
  }

  const addedRepairTasks: Record<string, unknown>[] = [];
  const pairedValidators: Record<string, unknown>[] = [];
  const partitionedScopes: string[][] = [];

  let repairIdx = 1;
  for (const group of scopeGroups.values()) {
    const repairTaskId = `task-repair-r${round}-${repairIdx}`;
    const validatorTaskId = `val-repair-r${round}-${repairIdx}`;
    const label = `Repair Round ${round} - ${group.findings.map((f) => f.id).join(", ")}`;

    const pair = createImplementerValidatorPair({
      taskId: repairTaskId,
      label,
      writeScope: group.scope,
      gate: group.gate,
      validatorId: validatorTaskId,
      role: "repairer",
      priority: 90,
      effort: 2,
    });

    nodes.push(pair.implementerTask, pair.validatorTask, pair.artifactNode, pair.valArtifactNode);
    edges.push(pair.producesEdge, pair.valProducesEdge, pair.validationEdge);
    gates.push(pair.gateNode);
    if (pair.validatorGateNode) gates.push(pair.validatorGateNode);

    addedRepairTasks.push(pair.implementerTask);
    pairedValidators.push(pair.validatorTask);
    partitionedScopes.push(group.scope);
    repairIdx++;
  }

  currentGraph.revision = newRevision;
  currentGraph.nodes = nodes;
  currentGraph.edges = edges;
  currentGraph.gates = gates;

  validateGraph(currentGraph, { requirements: [] });

  return {
    success: true,
    graphDocument: currentGraph,
    newRevision,
    addedRepairTasks,
    pairedValidators,
    partitionedScopes,
  };
}
