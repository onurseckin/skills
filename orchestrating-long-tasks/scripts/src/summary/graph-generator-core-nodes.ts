import type { TaskRecord } from "../workflow/types.ts";
import type {
  EdgeTrafficExchange,
  GraphEdgeData,
  GraphNodeData,
  NodeKind,
  NodeStatus,
} from "./types.ts";

export function buildPromptAndPlanNodes(
  promptText: string,
  tasks: TaskRecord[],
  waveCount: number,
): {
  promptNode: GraphNodeData;
  planNode: GraphNodeData;
  promptPlanEdge: GraphEdgeData;
} {
  const promptSizeKb = (promptText.length / 1024).toFixed(1);
  const promptTokens = Math.round(promptText.length / 4) || 200;

  const promptNode: GraphNodeData = {
    id: "node-input-prompt",
    name: "User Request Prompt",
    kind: "input" as NodeKind,
    status: "success" as NodeStatus,
    step: 1,
    stepLabel: "Step 1: User Prompt",
    badge: {
      text: `${promptSizeKb} KB`,
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
      outputs: [
        {
          kind: "prompt",
          label: "User Instruction",
          preview: promptText,
          tokens: promptTokens,
        },
      ],
    },
    metadata: {
      mediaAssets: [],
      screenshots: [],
      assets: [],
    },
    mediaAssets: [],
    screenshots: [],
  };

  const planNode: GraphNodeData = {
    id: "node-orchestrator-plan",
    name: "Execution Plan",
    kind: "orchestrator" as NodeKind,
    status: "success" as NodeStatus,
    step: 1,
    stepLabel: "Step 1: Planning",
    badge: {
      text: `${tasks.length} Tasks`,
      variant: "info",
      icon: "IconHierarchy2",
    },
    description: `Structured execution plan across ${tasks.length} tasks and ${waveCount} waves.`,
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
          preview: `${tasks.length} discrete work scopes (${tasks.map((t) => t.id).join(", ")})`,
        },
      ],
    },
    metadata: {
      taskCount: tasks.length,
      waveCount,
      mediaAssets: [],
      screenshots: [],
      assets: [],
    },
    mediaAssets: [],
    screenshots: [],
  };

  const promptExchanges: EdgeTrafficExchange[] = [
    {
      id: "exch-prompt-plan",
      timestamp: new Date().toISOString(),
      source: "node-input-prompt",
      target: "node-orchestrator-plan",
      stepNumber: 1,
      step: 1,
      direction: "forward",
      type: "prompt",
      kind: "prompt",
      summary: "Ingested user prompt instructions and context",
      tokens: promptTokens,
      tokensIn: 0,
      tokensOut: promptTokens,
      bytes: promptText.length || 800,
      durationMs: 20,
      latencyMs: 20,
      status: "success",
      inputGoal: promptText,
      payloadSnippet: promptText.slice(0, 150),
      payloadPreview: promptText.slice(0, 150),
      fullPayload: promptText,
      metadata: { promptSizeKb },
    },
  ];

  const promptPlanEdge: GraphEdgeData = {
    id: "edge-prompt-plan",
    source: "node-input-prompt",
    target: "node-orchestrator-plan",
    kind: "sequence",
    stepNumber: 1,
    badge: { text: "Prompt Input", variant: "info", icon: "IconTerminal2" },
    container: {
      stepBadge: "1",
      title: "User Prompt Ingested",
      detail: `${promptSizeKb} KB`,
      variant: "info",
      icon: "IconTerminal2",
    },
    traffic: {
      volume: 1,
      messagesCount: 1,
      tokens: promptTokens,
      tokensIn: 0,
      tokensOut: promptTokens,
      latencyMs: 20,
      bytes: promptText.length || 800,
      ratePerSec: 1.0,
      status: "nominal",
      glowColor: "#3b82f6",
      glowIntensity: 0.7,
      exchanges: promptExchanges,
    },
    exchanges: promptExchanges,
    isHighTraffic: false,
    trafficVolume: 1,
  };

  return { promptNode, planNode, promptPlanEdge };
}
