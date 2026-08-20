import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import { createEdge } from "./edge-builder.ts";
import {
  commandDurationMs,
  commandLogBytes,
  dispatchExchange,
  evidenceExchange,
  findingExchanges,
  reportBytes,
  submissionExchange,
  verdictExchange,
} from "./graph-edge-exchanges.ts";
import type { FileRef, GraphEdgeData, NodeFinding } from "./types.ts";

export interface TaskEdgeFactoryParams {
  task: TaskRecord;
  taskNodeId: string;
  gateNodeId: string;
  validatorNodeId?: string | undefined;
  taskName: string;
  taskStep: number;
  gateStep: number;
  agent?: string | undefined;
  validatorId?: string | undefined;
  files: FileRef[];
  findings: NodeFinding[];
  validatorCommands: readonly CommandRecord[];
  isGateDone: boolean;
}

function isProbeDemand(finding: NodeFinding): boolean {
  return finding.class === "probe_demand";
}

function dispatchEdge(params: TaskEdgeFactoryParams): GraphEdgeData {
  const { task, taskNodeId, taskName, taskStep, agent } = params;
  return createEdge({
    id: `edge-dispatch-${task.id}`,
    source: "node-orchestrator-plan",
    target: taskNodeId,
    kind: "dispatch",
    stepNumber: taskStep,
    title: "Dispatches Implementer",
    detail: agent ? `Lease: ${agent}` : "Task assignment",
    variant: "info",
    icon: "IconRocket",
    exchanges: [dispatchExchange(task, taskName, agent)],
  });
}

/** The validator is dispatched by the coordinator, not by the implementer it audits. */
function validatorSpawnEdge(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  const { task, validatorNodeId, validatorId, gateStep } = params;
  if (validatorNodeId === undefined) return [];
  return [
    createEdge({
      id: `edge-spawn-validator-${task.id}`,
      source: "node-orchestrator-plan",
      target: validatorNodeId,
      kind: "spawn",
      stepNumber: gateStep,
      title: "Spawns Validator",
      detail: validatorId ? `Validator: ${validatorId}` : `Validation of ${task.id}`,
      variant: "info",
      icon: "IconShield",
      exchanges: [
        {
          id: `exch-spawn-validator-${task.id}`,
          ...(task.validation?.started_at ? { timestamp: task.validation.started_at } : {}),
          direction: "forward",
          type: "dispatch",
          kind: "prompt",
          summary: `Validation of ${task.id} assigned`,
          evidence_class: task.validation ? "harness_observed" : "derived",
        },
      ],
    }),
  ];
}

/** With a validator the work is handed to it; without one the submission reaches the gate directly. */
function submissionEdges(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  const { task, taskNodeId, gateNodeId, validatorNodeId, taskStep, gateStep, files } = params;
  const detail = files.length > 0 ? `${files.length} files changed` : "Diff submission";
  const observed = { ...(reportBytes(task) !== undefined ? { bytes: reportBytes(task) } : {}) };

  if (validatorNodeId === undefined) {
    return [
      createEdge({
        id: `edge-gate-${task.id}`,
        source: taskNodeId,
        target: gateNodeId,
        kind: "gate",
        stepNumber: `${taskStep} -> ${gateStep}`,
        title: "Submits to Gate",
        detail,
        variant: "neutral",
        icon: "IconArrowRight",
        exchanges: [submissionExchange(task, files, "gate")],
        observed,
      }),
    ];
  }

  return [
    createEdge({
      id: `edge-handoff-${task.id}`,
      source: taskNodeId,
      target: validatorNodeId,
      kind: "handoff",
      stepNumber: `${taskStep} -> ${gateStep}`,
      title: "Hands Off Implementation",
      detail,
      variant: "neutral",
      icon: "IconArrowRight",
      exchanges: [submissionExchange(task, files, "validator")],
      observed,
    }),
    createEdge({
      id: `edge-validation-${task.id}`,
      source: validatorNodeId,
      target: gateNodeId,
      kind: "validation",
      stepNumber: gateStep,
      title: "Records Verdict",
      detail: params.validatorId ? `Validator: ${params.validatorId}` : "Verification verdict",
      variant: "info",
      icon: "IconShield",
      exchanges: [verdictExchange(task, params.validatorCommands)],
      observed: {
        ...(commandLogBytes(params.validatorCommands) !== undefined
          ? { bytes: commandLogBytes(params.validatorCommands) }
          : {}),
        ...(commandDurationMs(params.validatorCommands) !== undefined
          ? { durationMs: commandDurationMs(params.validatorCommands) }
          : {}),
      },
    }),
  ];
}

/**
 * A probe is a demand for proof and never punishes the implementer, so it leaves the validator
 * (not the gate) and carries its own kind. A pushback asserts a defect and comes back from the gate.
 */
function feedbackEdges(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  const { task, taskNodeId, gateNodeId, validatorNodeId, taskStep, gateStep, findings } = params;
  const edges: GraphEdgeData[] = [];
  const probeRound = task.probe_round ?? 0;
  const repairRound = task.repair_round ?? 0;

  if (probeRound > 0) {
    const demands = findings.filter(isProbeDemand);
    edges.push(
      createEdge({
        id: `edge-probe-${task.id}`,
        source: validatorNodeId ?? gateNodeId,
        target: taskNodeId,
        kind: "probe",
        stepNumber: `${gateStep} -> ${taskStep}`,
        title: `Adversarial Probe (Round ${probeRound})`,
        detail:
          demands.length > 0
            ? `${demands.length} proof demand${demands.length === 1 ? "" : "s"}`
            : "Proof demanded",
        variant: "cyan",
        icon: "IconSearch",
        isCycle: true,
        targetTab: "feedback",
        exchanges: findingExchanges(demands, task.id, "probe"),
      }),
    );
  }

  if (repairRound > 0) {
    const defects = findings.filter((finding) => !isProbeDemand(finding));
    edges.push(
      createEdge({
        id: `edge-pushback-${task.id}`,
        source: gateNodeId,
        target: taskNodeId,
        kind: "pushback",
        stepNumber: `${gateStep} -> ${taskStep}`,
        title: `Validator Pushback (Round ${repairRound})`,
        detail: `${defects.length} finding${defects.length === 1 ? "" : "s"}`,
        variant: "warning",
        icon: "IconAlertCircle",
        isCycle: true,
        targetTab: "feedback",
        exchanges: findingExchanges(defects, task.id, "pushback"),
      }),
    );
  }

  if (task.replacement_reason !== undefined) {
    edges.push(
      createEdge({
        id: `edge-backtrack-${task.id}`,
        source: gateNodeId,
        target: taskNodeId,
        kind: "backtrack",
        stepNumber: `${gateStep} -> ${taskStep}`,
        title: `Reassigned (${task.replacement_reason})`,
        detail: task.repair_assignee ? `Repairer: ${task.repair_assignee}` : "Implementer replaced",
        variant: "error",
        icon: "IconRotate",
        isCycle: true,
      }),
    );
  }

  return edges;
}

function dependencyEdges(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  const { task, taskNodeId, taskStep } = params;
  return task.dependencies.map((depId) =>
    createEdge({
      id: `edge-dep-${depId}-${task.id}`,
      source: `node-gate-${depId}`,
      target: taskNodeId,
      kind: "dependency",
      stepNumber: taskStep,
      title: "Dependency Unlocked",
      detail: `Dep: ${depId}`,
      variant: "cyan",
      icon: "IconArrowRight",
    }),
  );
}

export function buildTaskEdges(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  const { task, gateNodeId, gateStep, isGateDone } = params;
  return [
    dispatchEdge(params),
    ...validatorSpawnEdge(params),
    ...submissionEdges(params),
    ...feedbackEdges(params),
    ...dependencyEdges(params),
    createEdge({
      id: `edge-join-${task.id}`,
      source: gateNodeId,
      target: "node-critic-authority",
      kind: "join",
      stepNumber: gateStep + 1,
      title: "Evidence Report",
      detail: isGateDone ? "Gate verified" : "Gate pending",
      variant: isGateDone ? "success" : "neutral",
      icon: "IconFileText",
      exchanges: [evidenceExchange(task)],
    }),
  ];
}
