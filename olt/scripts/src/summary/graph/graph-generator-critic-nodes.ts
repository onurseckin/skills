import type { Manifest } from "../../contracts/capsule.ts";
import type { CommandRecord } from "../../contracts/commands.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import {
  buildNodeTelemetry,
  buildNodeTools,
  type AgentLedgerView,
} from "../metrics/agent-telemetry.ts";
import {
  mapFindingDetails,
  mapMediaAssets,
  mapRunScreenshotAssets,
} from "../assets/asset-mapper.ts";
import { createEdge } from "./edge-builder.ts";
import { projectFindingsForNode, type AssetRegistry } from "./graph-asset-ownership.ts";
import { buildNodeBrowserTests } from "../formatters/browser-tests.ts";
import { isCriticCommand, buildNodeScripts } from "../markdown/node-evidence.ts";
import type { StepAssignments } from "../metrics/step-calculator.ts";
import type { GraphEdgeData, GraphNodeData, IoPort, NodeKind } from "../types.ts";

export interface CriticNodeInput {
  runId: string;
  state: Readonly<WorkflowState>;
  steps: StepAssignments;
  tasks: readonly TaskRecord[];
  commands: readonly CommandRecord[];
  ledger: AgentLedgerView;
  registry: AssetRegistry;
  manifest?: Manifest | undefined;
  runRoot?: string | undefined;
}

export interface CriticNodes {
  criticNode: GraphNodeData;
  terminalNode: GraphNodeData;
  edges: GraphEdgeData[];
}

function gatesForCriticFindings(
  review: WorkflowState["completion_review"],
  tasks: readonly TaskRecord[],
): Array<{ taskId: string; findingIds: string[] }> {
  if (!review) return [];
  const byTask = new Map<string, string[]>();
  for (const finding of review.findings ?? []) {
    for (const task of tasks) {
      if (!task.requirement_ids.includes(finding.requirement_id)) continue;
      const list = byTask.get(task.id) ?? [];
      list.push(finding.id);
      byTask.set(task.id, list);
    }
  }
  return [...byTask].map(([taskId, findingIds]) => ({ taskId, findingIds }));
}

function recordedCriticIds(state: Readonly<WorkflowState>): ReadonlySet<string> {
  const ids = new Set<string>();
  if (state.completion_critic) ids.add(state.completion_critic.critic_id);
  for (const authorization of state.completion_critic_history ?? [])
    ids.add(authorization.critic_id);
  if (state.completion_review) ids.add(state.completion_review.critic_id);
  return ids;
}

export function buildCriticAndTerminalNodes(input: CriticNodeInput): CriticNodes {
  const { runId, state, steps, tasks, registry, ledger } = input;
  const review = state.completion_review;
  const criticIds = recordedCriticIds(state);
  const criticCommands = input.commands.filter((command) => isCriticCommand(command, criticIds));
  const options = {
    ...(review !== undefined ? { completionReview: review } : {}),
    ...(input.manifest !== undefined ? { manifest: input.manifest } : {}),
    ...(input.runRoot !== undefined ? { runRoot: input.runRoot } : {}),
  };

  const assets = registry.claim(
    mapMediaAssets(undefined, criticCommands, { ...options, scope: "critic" }),
  );
  const findings = projectFindingsForNode(mapFindingDetails(undefined, options), registry);
  const telemetry = buildNodeTelemetry(review?.critic_id, ledger);
  const tools = buildNodeTools(review?.critic_id, ledger);

  const criticInputs: IoPort[] = tasks.map((task) => ({
    node: `node-gate-${task.id}`,
    kind: "artifact" as const,
    label: `Gate Verification Report: ${task.id}`,
    preview: `Verification evidence recorded for task ${task.id}`,
  }));
  const criticOutputs: IoPort[] = [
    {
      kind: "decision",
      label: "Completeness Critic Certification",
      preview: review
        ? `Critic recorded ${review.status} with ${findings.length} findings`
        : "No whole-run certification recorded",
    },
  ];

  const criticBrowserTests = buildNodeBrowserTests(criticCommands, input.runRoot);

  const criticNode: GraphNodeData = {
    id: "node-critic-authority",
    name: "Completeness Critic Review",
    description: "Whole-run completeness inspection and sign-off.",
    kind: "critic" as NodeKind,
    status: review ? (review.status === "clean" ? "success" : "warning") : "pending",
    step: steps.criticStep,
    stepLabel: `Step ${steps.criticStep}: Completeness Critic`,
    badge: review
      ? review.status === "clean"
        ? { text: "Certified Clean", variant: "success", icon: "IconScale" }
        : { text: `${findings.length} Findings Recorded`, variant: "warning", icon: "IconScale" }
      : { text: "No Review Recorded", variant: "neutral", icon: "IconScale" },
    ...(telemetry ? { telemetry } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    scripts: buildNodeScripts(criticCommands, input.runRoot),
    ...(criticBrowserTests.length > 0 ? { browserTests: criticBrowserTests } : {}),
    ...(assets.length > 0 ? { assets } : {}),
    io: { inputs: criticInputs, outputs: criticOutputs },
    metadata: {
      role: "completeness-critic",
      findings,
      ...(review
        ? {
            criticId: review.critic_id,
            agentId: review.critic_id,
            status: review.status,
            unresolvedFindingIds: review.unresolved_finding_ids ?? [],
            residualRisks: review.residual_risks ?? [],
            requirementProofs: review.requirement_proofs ?? [],
            reviewedAt: review.reviewed_at,
          }
        : {}),
    },
  };

  const completion = state.completion_result;
  const unattributed = input.runRoot ? registry.claim(mapRunScreenshotAssets(input.runRoot)) : [];
  const terminalNode: GraphNodeData = {
    id: "node-terminal-complete",
    name: "Run Completion",
    description: "Sealed capsule run completion.",
    kind: "terminal" as NodeKind,
    status: completion?.status === "complete" ? "success" : "pending",
    step: steps.terminalStep,
    stepLabel: `Step ${steps.terminalStep}: Terminal Outcome`,
    badge: completion
      ? { text: "Sealed Run", variant: "success", icon: "IconFlagCheck" }
      : { text: "Not Sealed", variant: "neutral", icon: "IconFlagCheck" },
    io: {
      inputs: [
        {
          node: "node-critic-authority",
          kind: "decision",
          label: "Critic Authority Packet",
          preview: review ? "Whole-run certification recorded" : "No certification recorded",
        },
      ],
      outputs: [
        {
          kind: "summary",
          label: "Execution Trajectory Summary",
          preview: `Run ${runId} recorded ${tasks.length} tasks`,
        },
      ],
    },
    ...(unattributed.length > 0 ? { assets: unattributed } : {}),
    metadata: {
      status: completion?.status ?? "pending",
      ...(completion?.completed_at ? { completedAt: completion.completed_at } : {}),
      ...(unattributed.length > 0 ? { unattributedAssetCount: unattributed.length } : {}),
    },
  };

  const edges: GraphEdgeData[] = [
    createEdge({
      id: "edge-critic-complete",
      source: "node-critic-authority",
      target: "node-terminal-complete",
      kind: "signoff",
      stepNumber: steps.terminalStep,
      title: "Authority Sign-off",
      detail: completion ? "Sealed run" : "Awaiting seal",
      variant: completion ? "success" : "neutral",
      icon: "IconFlagCheck",
      exchanges: [
        {
          id: "exch-critic-complete",
          ...(review?.reviewed_at ? { timestamp: review.reviewed_at } : {}),
          direction: "forward",
          type: "signoff",
          kind: "decision",
          summary: review
            ? `Critic ${review.critic_id} recorded ${review.status}`
            : "No completion review recorded",
          ...(review ? { verdict: review.status === "clean" ? "PASS" : "FAIL" } : {}),
          evidence_class: review ? "harness_observed" : "derived",
        },
      ],
    }),
  ];

  for (const { taskId, findingIds } of gatesForCriticFindings(review, tasks)) {
    edges.push(
      createEdge({
        id: `edge-critic-${taskId}`,
        source: "node-critic-authority",
        target: `node-gate-${taskId}`,
        kind: "critic",
        stepNumber: steps.criticStep,
        title: `Critic Finding (${findingIds.length})`,
        detail: findingIds.join(", "),
        variant: "error",
        icon: "IconScale",
        isCycle: true,
        targetTab: "feedback",
      }),
    );
  }

  return { criticNode, terminalNode, edges };
}
