import type { CommandRecord } from "../../core/contracts/commands.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { earliestOpenValidation } from "../../workflow/review/validation-state.ts";
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
import type { ArchivedRoundContext } from "./graph-round-context.ts";
import type { FileRef, GraphEdgeData, NodeFinding } from "../types.ts";

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
  archivedRounds: readonly ArchivedRoundContext[];
  isGateDone: boolean;
}

function isProbeDemand(finding: NodeFinding): boolean {
  return finding.class === "probe_demand";
}

function round1TaskNodeId(params: TaskEdgeFactoryParams): string {
  return params.archivedRounds[0]?.taskNodeId ?? params.taskNodeId;
}

function dispatchEdge(params: TaskEdgeFactoryParams): GraphEdgeData {
  const { task, taskName, taskStep, agent } = params;
  return createEdge({
    id: `edge-dispatch-${task.id}`,
    source: "node-orchestrator-plan",
    target: round1TaskNodeId(params),
    kind: "dispatch",
    stepNumber: taskStep,
    title: "Dispatches Implementer",
    detail: agent ? `Lease: ${agent}` : "Task assignment",
    variant: "info",
    icon: "IconRocket",
    exchanges: [dispatchExchange(task, taskName, agent)],
  });
}

function validatorSpawnEdges(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  const { task, validatorNodeId, validatorId, gateStep, archivedRounds } = params;
  const edges: GraphEdgeData[] = archivedRounds.map((round) =>
    createEdge({
      id: `edge-spawn-validator-${task.id}-r${round.round}`,
      source: "node-orchestrator-plan",
      target: round.validatorNodeId,
      kind: "spawn",
      stepNumber: params.taskStep,
      title: "Spawns Validator",
      detail: `Validator: ${round.validatorId} (Round ${round.round})`,
      variant: "info",
      icon: "IconShield",
      exchanges: [
        {
          id: `exch-spawn-validator-${task.id}-r${round.round}`,
          ...(round.startedAt ? { timestamp: round.startedAt } : {}),
          direction: "forward",
          type: "dispatch",
          kind: "prompt",
          summary: `Validation of ${task.id} assigned (round ${round.round})`,
          evidence_class: "harness_observed",
        },
      ],
    }),
  );
  if (validatorNodeId !== undefined) {
    const validation = earliestOpenValidation(task);
    edges.push(
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
            ...(validation?.started_at ? { timestamp: validation.started_at } : {}),
            direction: "forward",
            type: "dispatch",
            kind: "prompt",
            summary: `Validation of ${task.id} assigned`,
            evidence_class: validation ? "harness_observed" : "derived",
          },
        ],
      }),
    );
  }
  return edges;
}

function archivedHandoffEdges(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  return params.archivedRounds.map((round) =>
    createEdge({
      id: `edge-handoff-${params.task.id}-r${round.round}`,
      source: round.taskNodeId,
      target: round.validatorNodeId,
      kind: "handoff",
      stepNumber: params.taskStep,
      title: "Hands Off Implementation",
      detail: `Round ${round.round} submission`,
      variant: "neutral",
      icon: "IconArrowRight",
    }),
  );
}

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

function archivedRoundTransitionEdges(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  const { task, taskNodeId, archivedRounds, findings, taskStep, gateStep } = params;
  const edges: GraphEdgeData[] = [];

  for (let index = 0; index < archivedRounds.length; index++) {
    const current = archivedRounds[index]!;
    const next = archivedRounds[index + 1];
    const isLastTransition = next === undefined;
    const targetId = next ? next.taskNodeId : taskNodeId;
    const defects = isLastTransition ? findings.filter((finding) => !isProbeDemand(finding)) : [];

    edges.push(
      createEdge({
        id: `edge-pushback-${task.id}-r${current.round}`,
        source: current.validatorNodeId,
        target: targetId,
        kind: "pushback",
        stepNumber: `${taskStep} -> ${gateStep}`,
        title: `Validator Pushback (Round ${current.round})`,
        detail: isLastTransition
          ? `${defects.length} finding${defects.length === 1 ? "" : "s"}`
          : "Round rejected; superseded",
        variant: "warning",
        icon: "IconAlertCircle",
        ...(isLastTransition ? { targetTab: "feedback" } : {}),
        exchanges: findingExchanges(defects, task.id, "pushback"),
      }),
    );

    if (isLastTransition && task.replacement_reason !== undefined) {
      edges.push(
        createEdge({
          id: `edge-backtrack-${task.id}`,
          source: current.validatorNodeId,
          target: targetId,
          kind: "backtrack",
          stepNumber: `${taskStep} -> ${gateStep}`,
          title: `Reassigned (${task.replacement_reason})`,
          detail: task.repair_assignee
            ? `Repairer: ${task.repair_assignee}`
            : "Implementer replaced",
          variant: "error",
          icon: "IconRotate",
        }),
      );
    }
  }

  return edges;
}

function liveRoundFeedbackEdges(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  const { task, gateNodeId, validatorNodeId, taskStep, gateStep, findings, archivedRounds } =
    params;
  const edges: GraphEdgeData[] = [];
  const source = validatorNodeId ?? gateNodeId;

  if (archivedRounds.length === 0) {
    const repairRound = task.repair_round ?? 0;
    if (repairRound > 0) {
      const defects = findings.filter((finding) => !isProbeDemand(finding));
      edges.push(
        createEdge({
          id: `edge-pushback-${task.id}`,
          source,
          target: gateNodeId,
          kind: "pushback",
          stepNumber: `${taskStep} -> ${gateStep}`,
          title: `Validator Pushback (Round ${repairRound})`,
          detail: `${defects.length} finding${defects.length === 1 ? "" : "s"}`,
          variant: "warning",
          icon: "IconAlertCircle",
          targetTab: "feedback",
          exchanges: findingExchanges(defects, task.id, "pushback"),
        }),
      );
    }
    if (task.replacement_reason !== undefined) {
      edges.push(
        createEdge({
          id: `edge-backtrack-${task.id}`,
          source,
          target: gateNodeId,
          kind: "backtrack",
          stepNumber: `${taskStep} -> ${gateStep}`,
          title: `Reassigned (${task.replacement_reason})`,
          detail: task.repair_assignee
            ? `Repairer: ${task.repair_assignee}`
            : "Implementer replaced",
          variant: "error",
          icon: "IconRotate",
        }),
      );
    }
  }

  const probeRound = task.probe_round ?? 0;
  if (probeRound > 0) {
    const demands = findings.filter(isProbeDemand);
    edges.push(
      createEdge({
        id: `edge-probe-${task.id}`,
        source,
        target: gateNodeId,
        kind: "probe",
        stepNumber: `${gateStep} -> ${taskStep}`,
        title: `Adversarial Probe (Round ${probeRound})`,
        detail:
          demands.length > 0
            ? `${demands.length} proof demand${demands.length === 1 ? "" : "s"}`
            : "Proof demanded",
        variant: "cyan",
        icon: "IconSearch",
        targetTab: "feedback",
        exchanges: findingExchanges(demands, task.id, "probe"),
      }),
    );
  }

  return edges;
}

function dependencyEdges(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  const { task, taskStep } = params;
  const target = round1TaskNodeId(params);
  return task.dependencies.map((depId) =>
    createEdge({
      id: `edge-dep-${depId}-${task.id}`,
      source: `node-gate-${depId}`,
      target,
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
    ...validatorSpawnEdges(params),
    ...archivedHandoffEdges(params),
    ...submissionEdges(params),
    ...archivedRoundTransitionEdges(params),
    ...liveRoundFeedbackEdges(params),
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
