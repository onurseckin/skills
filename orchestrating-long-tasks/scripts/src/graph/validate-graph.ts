import { isIdentifier, isRecord } from "../requirements/predicates.ts";
import { graphParts } from "./parts.ts";
import { dependencyData } from "./topology.ts";
import { validateEdges } from "./validate-edges.ts";
import { validateGates } from "./validate-gates.ts";
import { validateNodes } from "./validate-nodes.ts";
import { validateRoles } from "./validate-roles.ts";
import { validateTasks } from "./validate-tasks.ts";

export interface GraphValidationOptions {
  allowRuntimeStatuses?: boolean;
}

function requirementIds(
  document: unknown,
  issues: string[],
): { all: Set<string>; planned: Set<string> } {
  if (!isRecord(document)) {
    issues.push("requirements document must be an object");
    return { all: new Set(), planned: new Set() };
  }
  if (!Array.isArray(document.requirements)) return { all: new Set(), planned: new Set() };
  const requirements = document.requirements.filter(
    (item): item is Record<string, unknown> => isRecord(item) && isIdentifier(item.id),
  );
  const all = new Set(requirements.map(({ id }) => id as string));
  const planned = new Set(
    requirements
      .filter(({ disposition }) => ["actionable", "needs_authority"].includes(String(disposition)))
      .map(({ id }) => id as string),
  );
  return { all, planned };
}

export function validateGraph(
  document: unknown,
  requirements: unknown,
  options: GraphValidationOptions = {},
): string[] {
  const { issues, nodes, edges, gates } = graphParts(document);
  const { all: knownRequirements, planned } = requirementIds(requirements, issues);
  const nodeResult = validateNodes(nodes, knownRequirements, issues);
  const produced = validateEdges(
    edges,
    nodeResult.nodeIds,
    nodeResult.nodeById,
    nodeResult.artifactIds,
    issues,
  );
  const { dependencies, issues: dependencyIssues } = dependencyData(nodes, edges);
  issues.push(...dependencyIssues);
  const taskResult = validateTasks(
    nodeResult.tasks,
    knownRequirements,
    nodeResult.artifactIds,
    produced,
    issues,
    options.allowRuntimeStatuses ?? false,
  );
  validateRoles(edges, nodeResult.nodeById, issues);
  for (const [id, count] of nodeResult.requirementCounts) {
    if (count !== 1) issues.push(`requirement ${id} must have exactly one graph node`);
  }
  for (const [id, count] of taskResult.coverage) {
    if (!planned.has(id)) continue;
    if (count < 1) issues.push(`requirement ${id} is not covered by a task`);
  }
  for (const artifact of nodeResult.artifactIds) {
    if (!taskResult.ownedArtifacts.has(artifact))
      issues.push(`artifact ${artifact} has no task owner`);
  }
  const gateResult = validateGates(gates, knownRequirements, issues);
  for (const id of planned) {
    if (!gateResult.taskCoverage.has(id))
      issues.push(`requirement ${id} lacks mandatory task gate coverage`);
  }
  if (!gateResult.hasMandatoryRun) issues.push("graph lacks a mandatory run gate");
  for (const [taskId, prerequisites] of dependencies) {
    if (taskResult.taskById.get(taskId)?.status !== "ready") continue;
    const unfinished = [...prerequisites].filter(
      (prerequisite) => taskResult.taskById.get(prerequisite)?.status !== "done",
    );
    if (unfinished.length) issues.push(`ready task ${taskId} has unfinished prerequisites`);
  }
  return issues;
}
