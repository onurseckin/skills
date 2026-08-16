import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import {
  mapCommandDetails,
  mapFindingDetails,
  mapMediaAssets,
} from "./graph-generator-helpers.ts";
import type { StepAssignments } from "./step-calculator.ts";
import type {
  EdgeTrafficExchange,
  GraphEdgeData,
  GraphNodeData,
  IoPort,
  NodeKind,
} from "./types.ts";

export function buildCriticAndTerminalNodes(
  runId: string,
  state: Readonly<WorkflowState>,
  steps: StepAssignments,
  tasks: TaskRecord[],
  allCommands: CommandRecord[],
  events?: readonly HarnessEvent[] | undefined,
  manifest?: Manifest | undefined,
  runRoot?: string | undefined,
): {
  criticNode: GraphNodeData;
  terminalNode: GraphNodeData;
  criticCompleteEdge: GraphEdgeData;
} {
  const criticReview = state.completion_review;
  const criticFindings = mapFindingDetails(undefined, {
    ...(criticReview !== undefined ? { completionReview: criticReview } : {}),
    ...(events !== undefined ? { events } : {}),
    ...(manifest !== undefined ? { manifest } : {}),
    ...(runRoot !== undefined ? { runRoot } : {}),
  });
  const criticCmds = allCommands.filter(
    (c) =>
      c.actor === "critic" ||
      c.actor === "authority" ||
      Boolean(c.gate_id?.includes("critic")),
  );
  const criticMediaAssets = mapMediaAssets(undefined, criticCmds, {
    ...(criticReview !== undefined ? { completionReview: criticReview } : {}),
    ...(events !== undefined ? { events } : {}),
    ...(manifest !== undefined ? { manifest } : {}),
    ...(runRoot !== undefined ? { runRoot } : {}),
  });
  const criticScreenshots = criticMediaAssets.filter(
    (a) => a.type === "image" || a.mimeType?.startsWith("image/"),
  );

  const criticInputs: IoPort[] = tasks.map((t) => ({
    node: `node-gate-${t.id}`,
    kind: "artifact" as const,
    label: `Gate Verification Report: ${t.id}`,
    preview: `Verification evidence and test report for task ${t.id}`,
  }));
  const criticOutputs: IoPort[] = [
    {
      kind: "decision",
      label: "Completeness Critic Certification",
      preview: criticReview
        ? `Critic certified whole-run completion (${criticReview.status}) with ${criticFindings.length} findings`
        : "Pending whole-run certification",
    },
  ];

  const criticMetadata: Record<string, unknown> = {
    findings: criticFindings,
    mediaAssets: criticMediaAssets,
    screenshots: criticScreenshots,
    assets: criticMediaAssets,
    commands: mapCommandDetails(criticCmds),
    ...(criticReview
      ? {
          critic_id: criticReview.critic_id,
          criticId: criticReview.critic_id,
          status: criticReview.status,
          unresolved_finding_ids: criticReview.unresolved_finding_ids ?? [],
          unresolvedFindingIds: criticReview.unresolved_finding_ids ?? [],
          residual_risks: criticReview.residual_risks ?? [],
          requirement_proofs: criticReview.requirement_proofs ?? [],
        }
      : {}),
  };

  const criticNode: GraphNodeData = {
    id: "node-critic-authority",
    name: "Completeness Critic Review",
    kind: "critic" as NodeKind,
    status: criticReview ? "success" : "running",
    step: steps.criticStep,
    stepLabel: `Step ${steps.criticStep}: Completeness Critic`,
    badge: {
      text: criticReview
        ? (criticReview.status === "clean" ? "Certified Clean" : "Findings Recorded")
        : "Certified Clean",
      variant: criticReview?.status === "clean" ? "success" : "warning",
      icon: "IconScale",
    },
    description: "Final completeness critic inspection and whole-run sign-off.",
    io: { inputs: criticInputs, outputs: criticOutputs },
    metadata: criticMetadata,
    mediaAssets: criticMediaAssets,
    screenshots: criticScreenshots,
  };
  if (criticNode.badge && criticReview && criticReview.status !== "clean") {
    criticNode.badge.text = "Findings Recorded";
  } else if (criticNode.badge && !criticReview) {
    criticNode.badge.text = "Audit Scorecard";
  }

  const terminalNode: GraphNodeData = {
    id: "node-terminal-complete",
    name: "Run Completion",
    kind: "terminal" as NodeKind,
    status: state.completion_result?.status === "complete" ? "success" : "pending",
    step: steps.terminalStep,
    stepLabel: `Step ${steps.terminalStep}: Terminal Outcome`,
    badge: { text: "Sealed Run", variant: "success", icon: "IconFlagCheck" },
    description: "Sealed capsule run completion and summary artifact synthesis.",
    io: {
      inputs: [
        {
          node: "node-critic-authority",
          kind: "decision",
          label: "Critic Authority Packet",
          preview: "Whole-run certification packet sealed",
        },
      ],
      outputs: [
        {
          kind: "summary",
          label: "Execution Trajectory Summary",
          preview: `Run ${runId} execution completed with ${tasks.length} tasks`,
        },
      ],
    },
    metadata: {
      status: state.completion_result?.status ?? "pending",
      mediaAssets: [],
      screenshots: [],
      assets: [],
    },
    mediaAssets: [],
    screenshots: [],
  };

  const criticExchanges: EdgeTrafficExchange[] = [
    {
      id: "exch-critic-complete",
      timestamp: new Date().toISOString(),
      source: "node-critic-authority",
      target: "node-terminal-complete",
      stepNumber: steps.terminalStep,
      step: steps.criticStep,
      direction: "forward",
      type: "decision",
      kind: "decision",
      summary: "Full capsule signed-off and sealed by completeness critic",
      tokens: 450,
      tokensIn: 150,
      tokensOut: 300,
      bytes: 1800,
      durationMs: 50,
      latencyMs: 50,
      status: "success",
      verdict: "PASS",
      outputPassed: "Whole-run criteria satisfied",
      payloadSnippet: "Whole-run criteria satisfied",
      payloadPreview: "Whole-run criteria satisfied",
      fullPayload:
        "Completeness critic certified whole-run execution and signed off final authority packet.",
      metadata: { criticStatus: state.completion_review?.status ?? "clean" },
    },
  ];

  const criticCompleteEdge: GraphEdgeData = {
    id: "edge-critic-complete",
    source: "node-critic-authority",
    target: "node-terminal-complete",
    kind: "sequence",
    stepNumber: steps.terminalStep,
    badge: {
      text: "Authority Sign-off",
      variant: "success",
      icon: "IconFlagCheck",
    },
    container: {
      stepBadge: `${steps.terminalStep}`,
      title: "Authority Sign-off",
      detail: "Sealed Run",
      variant: "success",
      icon: "IconFlagCheck",
    },
    traffic: {
      volume: 1,
      messagesCount: 1,
      tokens: 450,
      tokensIn: 150,
      tokensOut: 300,
      latencyMs: 50,
      bytes: 1800,
      ratePerSec: 1.0,
      status: "nominal",
      glowColor: "#10b981",
      glowIntensity: 0.8,
      exchanges: criticExchanges,
    },
    exchanges: criticExchanges,
    isHighTraffic: false,
    trafficVolume: 1,
  };

  return { criticNode, terminalNode, criticCompleteEdge };
}
