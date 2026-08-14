import { requirementsDocument } from "../requirements/fixtures.ts";

export function graphDocument(
  requirements: Record<string, unknown>,
  revision = 1,
): Record<string, unknown> {
  const requirementIds = (requirements.requirements as Record<string, unknown>[]).map(
    ({ id }) => id as string,
  );
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  requirementIds.forEach((requirementId, offset) => {
    const index = offset + 1;
    const taskId = `task-${index}`;
    const artifactId = `artifact-${index}`;
    nodes.push(
      {
        id: `requirement-${index}`,
        type: "requirement",
        label: requirementId,
        requirement_id: requirementId,
      },
      { id: artifactId, type: "artifact", label: `Artifact ${index}` },
      {
        id: taskId,
        type: "task",
        label: `Task ${index}`,
        requirement_ids: [requirementId],
        write_scope: [`src/area-${index}`],
        resource_scope: [],
        status: index === 1 ? "ready" : "proposed",
        priority: 10 - index,
        effort: index,
        created_order: index,
      },
    );
    edges.push({ source: taskId, target: artifactId, type: "produces" });
  });
  if (requirementIds.length > 1)
    edges.push({ source: "task-2", target: "task-1", type: "depends_on" });
  return {
    schema: "harness.graph",
    version: 1,
    revision,
    nodes,
    edges,
    gates: [
      {
        id: "gate-required",
        command: ["bun", "test", "tests/planning"],
        cwd: ".",
        scope: "task",
        requirement_ids: requirementIds,
        mandatory: true,
      },
      {
        id: "gate-final",
        command: ["bun", "test", "tests"],
        cwd: ".",
        scope: "run",
        requirement_ids: [],
        mandatory: true,
      },
    ],
  };
}

export function validPlanningDocuments(prompt = "First\n\nThird"): {
  prompt: string;
  requirements: Record<string, unknown>;
  graph: Record<string, unknown>;
} {
  const requirements = requirementsDocument(prompt);
  return { prompt, requirements, graph: graphDocument(requirements) };
}

export function taskById(graph: Record<string, unknown>, id: string): Record<string, unknown> {
  const task = (graph.nodes as Record<string, unknown>[]).find((node) => node.id === id);
  if (!task) throw new Error(`Missing fixture task ${id}`);
  return task;
}
