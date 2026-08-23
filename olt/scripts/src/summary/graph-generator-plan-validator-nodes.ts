import type { WorkflowState } from "../workflow/types.ts";
import { createEdge } from "./edge-builder.ts";
import type { GraphEdgeData, GraphNodeData, NodeKind, NodeStatus } from "./types.ts";

export interface PlanValidatorNodesInput {
  state: Readonly<WorkflowState>;
}

export interface PlanValidatorNodes {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

export function buildPlanValidatorNodes(input: PlanValidatorNodesInput): PlanValidatorNodes {
  const history = input.state.plan_validation_history ?? [];
  const reviews = input.state.plan_reviews ?? [];
  if (history.length === 0) return { nodes: [], edges: [] };

  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];

  for (const [index, round] of history.entries()) {
    const ordinal = index + 1;
    const nodeId = `node-plan-validator-r${ordinal}`;
    const review = reviews.find((entry) => entry.graph_revision === round.graph_revision);
    const isApproved = review?.status === "approved";
    const isRejected = review?.status === "changes_requested";
    const status: NodeStatus = isApproved
      ? "success"
      : isRejected
        ? "warning"
        : round.status === "expired"
          ? "skipped"
          : "running";

    nodes.push({
      id: nodeId,
      name: `Plan Validator: ${round.validator_id}`,
      description: `Reviews the compiled plan at graph revision ${round.graph_revision}.`,
      kind: "agent" as NodeKind,
      status,
      step: 1,
      stepLabel: `Plan Validation (Revision ${round.graph_revision})`,
      badge: isApproved
        ? { text: "Approved", variant: "success", icon: "IconShieldCheck" }
        : isRejected
          ? {
              text: `Pushback: ${review.findings.length} Finding${review.findings.length === 1 ? "" : "s"}`,
              variant: "warning",
              icon: "IconAlertTriangle",
              targetTab: "feedback",
            }
          : { text: round.status, variant: "neutral", icon: "IconShield" },
      io: {
        inputs: [
          {
            node: "node-orchestrator-plan",
            kind: "artifact",
            label: "Compiled Plan",
            preview: `Graph revision ${round.graph_revision}`,
          },
        ],
        outputs: [
          {
            kind: "decision",
            label: "Plan Verdict",
            preview: review ? `${review.status}: ${review.summary}` : `Assignment ${round.status}`,
          },
        ],
      },
      metadata: {
        role: "plan-validator",
        agentId: round.validator_id,
        validatorId: round.validator_id,
        graphRevision: round.graph_revision,
        ...(review === undefined
          ? {}
          : {
              verdict: review.status,
              decompositionAnswer: review.decomposition_answer,
              dependencyAnswer: review.dependency_answer,
              gateAnswer: review.gate_answer,
              stragglerAnswer: review.straggler_answer,
              planFindings: review.findings,
            }),
      },
    });

    edges.push(
      createEdge({
        id: `edge-spawn-plan-validator-r${ordinal}`,
        source: "node-orchestrator-plan",
        target: nodeId,
        kind: "spawn",
        stepNumber: 1,
        title: "Spawns Plan Validator",
        detail: `Validator: ${round.validator_id} (revision ${round.graph_revision})`,
        variant: "info",
        icon: "IconShield",
        exchanges: [
          {
            id: `exch-spawn-plan-validator-r${ordinal}`,
            timestamp: round.started_at,
            direction: "forward",
            type: "dispatch",
            kind: "prompt",
            summary: `Plan validation of revision ${round.graph_revision} assigned`,
            evidence_class: "harness_observed",
          },
        ],
      }),
    );

    if (review === undefined) continue;
    const next = history[index + 1];
    const targetId =
      isRejected && next !== undefined
        ? `node-plan-validator-r${ordinal + 1}`
        : "node-orchestrator-plan";
    const firstFinding = review.findings[0];
    edges.push(
      createEdge({
        id: `edge-${isApproved ? "signoff" : "pushback"}-plan-validator-r${ordinal}`,
        source: nodeId,
        target: targetId,
        kind: isApproved ? "signoff" : "pushback",
        stepNumber: 1,
        title: isApproved
          ? "Plan Validation Approved"
          : `Plan Validation Pushback (Revision ${round.graph_revision})`,
        detail: isApproved
          ? "Cleared for implementer dispatch"
          : `${review.findings.length} finding${review.findings.length === 1 ? "" : "s"}`,
        variant: isApproved ? "success" : "warning",
        icon: isApproved ? "IconShieldCheck" : "IconAlertCircle",
        ...(isApproved ? {} : { targetTab: "feedback" }),
        exchanges: [
          {
            id: `exch-plan-review-r${ordinal}`,
            timestamp: review.reviewed_at,
            direction: "forward",
            type: isApproved ? "signoff" : "pushback",
            kind: "decision",
            summary: review.summary,
            verdict: isApproved ? "PASS" : "FAIL",
            evidence_class: "harness_observed",
            ...(firstFinding === undefined
              ? {}
              : {
                  finding: {
                    id: firstFinding.id,
                    severity: firstFinding.severity,
                    observation: firstFinding.observation,
                    remediation: firstFinding.remediation,
                  },
                }),
          },
        ],
      }),
    );
  }

  return { nodes, edges };
}
