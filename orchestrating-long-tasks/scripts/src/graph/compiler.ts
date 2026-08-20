import { HarnessError } from "../errors/harness-error.ts";
import type { TaskDeclaration } from "../requirements/compiler.ts";
import { normalizeScopePath } from "./scope-analyzer.ts";
import { validateGraph } from "./validate-graph.ts";

export interface CompiledGraphResult {
  graphDocument: Record<string, unknown>;
}

export function compileGraphDocument(
  tasks: readonly TaskDeclaration[],
  requirementsDocument: Record<string, unknown>,
  requirementIdsByTask: ReadonlyMap<string, readonly string[]>,
  revision = 1,
  // The run-completion gate is mandatory for the whole run, so its command has to be the one the
  // caller chose. Nothing here knows what proves this repository, and a guessed command would be
  // written into state.gates as if someone had decided it.
  completionGate: readonly string[] = [],
): CompiledGraphResult {
  if (completionGate.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "the mandatory run-completion gate needs a declared command; nothing can stand in for it",
    );
  }
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  const gates: Record<string, unknown>[] = [];

  const rawReqs = Array.isArray(requirementsDocument.requirements)
    ? (requirementsDocument.requirements as Record<string, unknown>[])
    : [];

  rawReqs.forEach((req) => {
    const reqId = String(req.id);
    nodes.push({
      id: `node-${reqId}`,
      type: "requirement",
      label: reqId,
      requirement_id: reqId,
    });
  });

  const allTaskIds = new Set(tasks.map((t) => t.id));

  tasks.forEach((task, idx) => {
    const taskId = task.id;
    const artifactId = `artifact-${taskId.replace(/^task-?/, "")}`;
    const taskReqIds = [...(requirementIdsByTask.get(taskId) ?? [])];
    const normalizedScopes = task.writeScope.map(normalizeScopePath);
    const validDeps = (task.deps ?? []).filter((d) => allTaskIds.has(d));

    nodes.push({
      id: artifactId,
      type: "artifact",
      label: `Artifact for ${task.label}`,
    });

    nodes.push({
      id: taskId,
      type: "task",
      label: task.label,
      requirement_ids: taskReqIds,
      write_scope: normalizedScopes,
      resource_scope: [],
      artifact_ids: [artifactId],
      status: validDeps.length === 0 ? "ready" : "proposed",
      priority: task.priority ?? 50,
      effort: task.effort ?? 3,
      created_order: idx + 1,
    });

    edges.push({
      source: taskId,
      target: artifactId,
      type: "produces",
    });

    for (const dep of validDeps) {
      edges.push({
        source: taskId,
        target: dep,
        type: "depends_on",
      });
    }

    const gateCmd = typeof task.gate === "string" ? task.gate.trim().split(/\s+/) : [...task.gate];
    gates.push({
      id: `gate-${taskId.replace(/^task-?/, "")}`,
      command: gateCmd,
      cwd: ".",
      scope: "task",
      requirement_ids: taskReqIds,
      mandatory: true,
    });
  });

  gates.push({
    id: "gate-run-completion",
    command: [...completionGate],
    cwd: ".",
    scope: "run",
    requirement_ids: [],
    mandatory: true,
  });

  const graphDocument: Record<string, unknown> = {
    schema: "harness.graph",
    version: 1,
    revision,
    nodes,
    edges,
    gates,
  };

  const issues = validateGraph(graphDocument, requirementsDocument);
  if (issues.length > 0) {
    throw new HarnessError("INTEGRITY", `compiled graph failed validation: ${issues.join("; ")}`);
  }

  return { graphDocument };
}
