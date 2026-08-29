import { normalizeScopePath } from "../scope-analyzer.ts";
import type {
  AllocatedTaskElements,
  ImplementerValidatorConfig,
  SubtaskDecomposition,
  TaskRolePair,
} from "./types.ts";

export function parseGateCommand(gate: string | readonly string[]): string[] {
  if (typeof gate === "string") {
    return gate
      .trim()
      .split(/\s+/u)
      .filter((t) => t.length > 0);
  }
  return gate.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

export function createImplementerValidatorPair(config: ImplementerValidatorConfig): TaskRolePair {
  const taskId = config.taskId;
  const valId = config.validatorId ?? `val-${taskId.replace(/^task-?/, "")}`;
  const artifactId = `artifact-${taskId.replace(/^task-?/, "")}`;
  const valArtifactId = `artifact-${valId.replace(/^task-?/, "")}`;
  const gateId = `gate-${taskId.replace(/^task-?/, "")}`;
  const valGateId = `gate-${valId.replace(/^task-?/, "")}`;
  const normalizedScopes = config.writeScope.map(normalizeScopePath);
  const reqIds =
    config.requirementIds && config.requirementIds.length > 0
      ? [...config.requirementIds]
      : [`req-${taskId.replace(/^task-?/, "")}`];
  const gateCmd = parseGateCommand(config.gate);

  const baseOrder = config.createdOrder ?? 1;

  const implementerTask: Record<string, unknown> = {
    id: taskId,
    type: "task",
    label: config.label,
    role: typeof config.role === "string" ? config.role : "implementer",
    requirement_ids: reqIds,
    write_scope: normalizedScopes,
    resource_scope: [],
    artifact_ids: [artifactId],
    status: config.status ?? (config.deps && config.deps.length > 0 ? "proposed" : "ready"),
    priority: config.priority ?? 50,
    effort: config.effort ?? 3,
    created_order: baseOrder,
    paired_validator_id: valId,
  };

  const validatorScope =
    config.validatorScope && config.validatorScope.length > 0
      ? config.validatorScope.map(normalizeScopePath)
      : normalizedScopes;

  const validatorTask: Record<string, unknown> = {
    id: valId,
    type: "task",
    label: `Validator for ${config.label}`,
    role: "validator",
    requirement_ids: reqIds,
    write_scope: validatorScope,
    resource_scope: [],
    artifact_ids: [valArtifactId],
    status: "proposed",
    priority: (config.priority ?? 50) + 1,
    effort: 1,
    created_order: baseOrder + 1,
    validates_task_id: taskId,
  };

  const artifactNode: Record<string, unknown> = {
    id: artifactId,
    type: "artifact",
    label: `Artifact for ${config.label}`,
  };

  const valArtifactNode: Record<string, unknown> = {
    id: valArtifactId,
    type: "artifact",
    label: `Validation Artifact for ${config.label}`,
  };

  const producesEdge: Record<string, unknown> = {
    source: taskId,
    target: artifactId,
    type: "produces",
  };

  const valProducesEdge: Record<string, unknown> = {
    source: valId,
    target: valArtifactId,
    type: "produces",
  };

  const validationEdge: Record<string, unknown> = {
    source: valId,
    target: taskId,
    type: "depends_on",
    dataflow_justification: `Validator ${valId} validates outputs produced by ${taskId}`,
  };

  const gateNode: Record<string, unknown> = {
    id: gateId,
    command: gateCmd,
    cwd: ".",
    scope: "task",
    requirement_ids: reqIds,
    mandatory: true,
  };

  let validatorGateNode: Record<string, unknown> | undefined = undefined;
  if (config.validatorGate) {
    const valGateCmd = parseGateCommand(config.validatorGate);
    validatorGateNode = {
      id: valGateId,
      command: valGateCmd,
      cwd: ".",
      scope: "task",
      requirement_ids: reqIds,
      mandatory: true,
    };
  }

  return {
    implementerTask,
    validatorTask,
    artifactNode,
    valArtifactNode,
    producesEdge,
    valProducesEdge,
    validationEdge,
    gateNode,
    validatorGateNode,
  };
}

export function allocateTaskElements(
  task: SubtaskDecomposition,
  reqIds: readonly string[],
  fallbackPriority: number,
  fallbackEffort: number,
  defaultRole: string,
  initialStatus: string,
  autoPair: boolean,
  currentOrder: number,
): AllocatedTaskElements {
  if (autoPair) {
    const pair = createImplementerValidatorPair({
      taskId: task.id,
      label: task.label,
      writeScope: task.writeScope,
      gate: task.gate,
      validatorId: task.validatorId,
      validatorGate: task.validatorGate,
      validatorScope: task.validatorScope,
      priority: task.priority ?? fallbackPriority,
      effort: task.effort ?? fallbackEffort,
      requirementIds: reqIds,
      status: initialStatus,
      deps: task.deps,
      role: typeof task.role === "string" ? task.role : defaultRole,
      createdOrder: currentOrder,
    });

    const nodes = [
      pair.implementerTask,
      pair.validatorTask,
      pair.artifactNode,
      pair.valArtifactNode,
    ];
    const edges = [pair.producesEdge, pair.valProducesEdge, pair.validationEdge];
    const gates = pair.validatorGateNode
      ? [pair.gateNode, pair.validatorGateNode]
      : [pair.gateNode];

    return {
      nodes,
      edges,
      gates,
      addedTasks: [pair.implementerTask, pair.validatorTask],
      addedEdges: edges,
      addedGates: gates,
      pairedTask: {
        implementerTaskId: String(pair.implementerTask.id),
        validatorTaskId: String(pair.validatorTask.id),
      },
      nextOrder: currentOrder + 1,
    };
  }

  const artifactId = `artifact-${task.id.replace(/^task-?/, "")}`;
  const gateCmd = parseGateCommand(task.gate);

  const taskNode: Record<string, unknown> = {
    id: task.id,
    type: "task",
    label: task.label,
    role: typeof task.role === "string" ? task.role : defaultRole,
    requirement_ids: [...reqIds],
    write_scope: task.writeScope.map(normalizeScopePath),
    resource_scope: [],
    artifact_ids: [artifactId],
    status: initialStatus,
    priority: task.priority ?? fallbackPriority,
    effort: task.effort ?? fallbackEffort,
    created_order: currentOrder,
  };

  const artifactNode: Record<string, unknown> = {
    id: artifactId,
    type: "artifact",
    label: `Artifact for ${task.label}`,
  };

  const producesEdge: Record<string, unknown> = {
    source: task.id,
    target: artifactId,
    type: "produces",
  };

  const gateNode: Record<string, unknown> = {
    id: `gate-${task.id.replace(/^task-?/, "")}`,
    command: gateCmd,
    cwd: ".",
    scope: "task",
    requirement_ids: [...reqIds],
    mandatory: true,
  };

  return {
    nodes: [taskNode, artifactNode],
    edges: [producesEdge],
    gates: [gateNode],
    addedTasks: [taskNode],
    addedEdges: [producesEdge],
    addedGates: [gateNode],
    pairedTask: undefined,
    nextOrder: currentOrder,
  };
}
