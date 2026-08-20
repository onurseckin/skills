import { buildNodeTelemetry, buildNodeTools, type AgentLedgerView } from "./agent-telemetry.ts";
import { buildNodeScripts } from "./node-evidence.ts";
import type { ArchivedRoundContext } from "./graph-round-context.ts";
import type { TaskRecord } from "../workflow/types.ts";
import type { GraphNodeData, NodeKind } from "./types.ts";

export interface ArchivedRoundNodesInput {
  task: TaskRecord;
  round: ArchivedRoundContext;
  taskName: string;
  taskStep: number;
  totalRounds: number;
  ledger: AgentLedgerView;
  runRoot?: string | undefined;
}

/**
 * Round 1's implementer is the one prior identity the state machine keeps a direct field for
 * (`original_implementer`). A later superseded round had its own repairer too, but the run only
 * retains the most recent `repair_assignee`, so an earlier round's identity is absent rather than
 * borrowed from a round it was not.
 */
function archivedImplementerAgentId(task: TaskRecord, round: number): string | undefined {
  return round === 1 ? task.original_implementer : undefined;
}

function archivedImplementerNode(input: ArchivedRoundNodesInput): GraphNodeData {
  const { task, round, taskName, taskStep, totalRounds, ledger } = input;
  const agentId = archivedImplementerAgentId(task, round.round);
  const telemetry = buildNodeTelemetry(agentId, ledger);

  return {
    id: round.taskNodeId,
    name: taskName,
    description: `${taskName}, round ${round.round} of ${totalRounds}: superseded after the validator rejected it.`,
    kind: "agent" as NodeKind,
    status: "warning",
    step: taskStep,
    stepLabel: `Round ${round.round}`,
    badge: { text: `Superseded (Round ${round.round})`, variant: "warning", icon: "IconAlertTriangle" },
    ...(telemetry ? { telemetry } : {}),
    scripts: [],
    files: [],
    metadata: {
      role: "implementer",
      round: round.round,
      totalRounds,
      supersededByRound: round.round + 1,
      ...(agentId ? { agentId } : {}),
    },
  };
}

function archivedValidatorNode(input: ArchivedRoundNodesInput): GraphNodeData {
  const { round, taskStep, totalRounds, ledger, runRoot } = input;
  const telemetry = buildNodeTelemetry(round.validatorId, ledger);
  const tools = buildNodeTools(round.validatorId, ledger);

  return {
    id: round.validatorNodeId,
    name: `Validator: ${round.validatorId}`,
    description: `Independent verification, round ${round.round} of ${totalRounds}. Rejected.`,
    kind: "agent" as NodeKind,
    status: "warning",
    step: taskStep,
    stepLabel: `Verification (Round ${round.round})`,
    badge: { text: `Rejected (Round ${round.round})`, variant: "warning", icon: "IconAlertTriangle" },
    ...(telemetry ? { telemetry } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    scripts: buildNodeScripts(round.commands, runRoot),
    metadata: {
      role: "validator",
      round: round.round,
      totalRounds,
      verdict: "reject",
      agentId: round.validatorId,
      validatorId: round.validatorId,
      ...(round.attempt !== undefined ? { attempt: round.attempt } : {}),
      ...(round.startedAt !== undefined ? { startedAt: round.startedAt } : {}),
      ...(round.deadlineAt !== undefined ? { deadlineAt: round.deadlineAt } : {}),
    },
  };
}

/**
 * Every superseded round gets its own implementer/validator pair, distinct from the live task's
 * ids. Their evidence is deliberately thin — no commands beyond what that round's validator cited,
 * no identity beyond what the state machine still records — because a fuller node here would mean
 * inventing evidence the run never kept once the round was superseded.
 */
export function buildArchivedRoundNodes(input: ArchivedRoundNodesInput): GraphNodeData[] {
  return [archivedImplementerNode(input), archivedValidatorNode(input)];
}
