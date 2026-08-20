import type { TaskRecord } from "../workflow/types.ts";
import { createEdge } from "./edge-builder.ts";
import { detectHostIdentity } from "./host-telemetry.ts";
import type { StepAssignments } from "./step-calculator.ts";
import type { GraphEdgeData, GraphNodeData, NodeKind, NodeStatus } from "./types.ts";

export interface CoreNodeInput {
  promptText: string;
  tasks: readonly TaskRecord[];
  steps: StepAssignments;
  branchCount: number;
  ledgerIntegrityIssue?: string | undefined;
}

export interface CoreNodes {
  promptNode: GraphNodeData;
  planNode: GraphNodeData;
  promptPlanEdge: GraphEdgeData;
}

export function buildPromptAndPlanNodes(input: CoreNodeInput): CoreNodes {
  const { promptText, tasks, steps } = input;
  const promptBytes = Buffer.byteLength(promptText, "utf-8");
  const waveCount = steps.taskWaves.size > 0 ? Math.max(...steps.taskWaves.values()) : 0;
  const hostIdentity = detectHostIdentity();

  const promptNode: GraphNodeData = {
    id: "node-input-prompt",
    name: "User Request Prompt",
    kind: "input" as NodeKind,
    status: "success" as NodeStatus,
    step: 1,
    stepLabel: "Step 1: User Prompt",
    badge: {
      text: `${(promptBytes / 1024).toFixed(1)} KB`,
      variant: "neutral",
      icon: "IconTerminal2",
    },
    description: promptText
      ? promptText.length > 200
        ? `${promptText.slice(0, 197)}...`
        : promptText
      : "Original user prompt initiating the run.",
    prompt: promptText,
    io: {
      inputs: [],
      outputs: [{ kind: "prompt", label: "User Instruction", preview: promptText }],
    },
    metadata: { promptBytes },
  };

  const planNode: GraphNodeData = {
    id: "node-orchestrator-plan",
    name: "Execution Plan",
    kind: "orchestrator" as NodeKind,
    status: "success" as NodeStatus,
    step: 1,
    stepLabel: "Step 1: Planning",
    badge: { text: `${tasks.length} Tasks`, variant: "info", icon: "IconHierarchy2" },
    badges: [
      {
        // The label says where the waves came from, so a derived partition never reads as recorded.
        label:
          steps.waveSource.value === "recorded"
            ? `${waveCount} recorded waves`
            : `${waveCount} derived waves`,
        variant: steps.waveSource.value === "recorded" ? "info" : "gray",
      },
      ...(input.branchCount > 0
        ? [{ label: `${input.branchCount} branches`, variant: "amber" as const }]
        : []),
    ],
    description: `Execution plan across ${tasks.length} tasks and ${waveCount} waves.`,
    io: {
      inputs: [
        {
          node: "node-input-prompt",
          kind: "prompt",
          label: "User Prompt",
          preview: promptText.slice(0, 100),
        },
      ],
      outputs: [
        {
          kind: "decision",
          label: "DAG Work Decomposition",
          preview: `${tasks.length} discrete work scopes (${tasks.map((task) => task.id).join(", ")})`,
        },
      ],
    },
    metadata: {
      taskCount: tasks.length,
      waveCount,
      branchCount: input.branchCount,
      waveSource: steps.waveSource,
      topologyRevision: steps.topologyRevision,
      ...(hostIdentity ? { hostIdentity } : {}),
      ...(input.ledgerIntegrityIssue !== undefined
        ? { agentLedgerIssue: input.ledgerIntegrityIssue }
        : {}),
    },
  };

  const promptPlanEdge = createEdge({
    id: "edge-prompt-plan",
    source: "node-input-prompt",
    target: "node-orchestrator-plan",
    kind: "sequence",
    stepNumber: 1,
    title: "User Prompt Ingested",
    detail: `${(promptBytes / 1024).toFixed(1)} KB`,
    variant: "info",
    icon: "IconTerminal2",
    exchanges: [
      {
        id: "exch-prompt-plan",
        direction: "forward",
        type: "prompt",
        kind: "prompt",
        summary: "Ingested user prompt",
        detail: promptText.slice(0, 150),
        bytes: promptBytes,
        evidence_class: "harness_observed",
      },
    ],
  });

  return { promptNode, planNode, promptPlanEdge };
}
