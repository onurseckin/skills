import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import { buildTaskAndGateNodes } from "./graph-generator-helpers.ts";
import { computeExecutionSteps } from "./step-calculator.ts";
import type {
  GraphDataset,
  GraphEdgeData,
  GraphNodeData,
  GraphSection,
  NodeKind,
  NodeStatus,
} from "./types.ts";

export interface GraphGeneratorInput {
  runId: string;
  state: Readonly<WorkflowState>;
  promptText?: string;
  commands?: Record<string, CommandRecord>;
}

export function generateGraphDataset(input: GraphGeneratorInput): GraphDataset {
  const { runId, state, promptText = "" } = input;
  const tasks = Object.values(state.tasks ?? {}) as TaskRecord[];
  const allCommands = Object.values({
    ...(state.commands ?? {}),
    ...(input.commands ?? {}),
  } as Record<string, CommandRecord>);
  const steps = computeExecutionSteps(tasks);

  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];

  const promptSizeKb = (promptText.length / 1024).toFixed(1);
  nodes.push({
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
      outputs: [
        {
          kind: "prompt",
          label: "User Instruction",
          preview: promptText,
          tokens: Math.round(promptText.length / 4),
        },
      ],
    },
  });

  nodes.push({
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
    description: `Structured execution plan across ${tasks.length} tasks and ${steps.taskWaves.size || 1} waves.`,
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
          preview: `${tasks.length} discrete work scopes`,
        },
      ],
    },
  });

  const promptExchanges = [
    {
      id: "exch-prompt-plan",
      timestamp: new Date().toISOString(),
      source: "node-input-prompt",
      target: "node-orchestrator-plan",
      kind: "prompt",
      summary: "Ingested user prompt instructions and context",
      tokens: Math.round(promptText.length / 4) || 200,
      bytes: promptText.length || 800,
      durationMs: 20,
      status: "success",
      payloadSnippet: promptText.slice(0, 150),
    },
  ];

  edges.push({
    id: "edge-prompt-plan",
    source: "node-input-prompt",
    target: "node-orchestrator-plan",
    kind: "sequence",
    stepNumber: 1,
    badge: {
      text: "Plan Initialization",
      variant: "info",
      icon: "IconArrowRight",
    },
    container: {
      stepBadge: "1",
      title: "Plan Initialization",
      detail: `${promptSizeKb} KB Prompt`,
      variant: "info",
      icon: "IconArrowRight",
    },
    traffic: {
      volume: 1,
      messagesCount: 1,
      tokens: Math.round(promptText.length / 4) || 200,
      bytes: promptText.length || 800,
      ratePerSec: 1.0,
      status: "active",
      glowColor: "#06b6d4",
      glowIntensity: 0.6,
      exchanges: promptExchanges,
    },
    exchanges: promptExchanges,
    isHighTraffic: false,
    trafficVolume: 1,
  });

  for (const task of tasks) {
    const taskStep = steps.taskSteps.get(task.id) ?? 2;
    const taskWave = steps.taskWaves.get(task.id) ?? 1;
    const taskCmds = allCommands.filter((c) => c.task_id === task.id);

    const { taskNode, gateNode, taskEdges } = buildTaskAndGateNodes({
      task,
      taskStep,
      taskWave,
      taskCmds,
    });

    nodes.push(taskNode, gateNode);
    edges.push(...taskEdges);
  }

  nodes.push({
    id: "node-critic-authority",
    name: "Completeness Critic Review",
    kind: "critic" as NodeKind,
    status: state.completion_review ? "success" : "running",
    step: steps.criticStep,
    stepLabel: `Step ${steps.criticStep}: Completeness Critic`,
    badge: { text: "Audit Scorecard", variant: "warning", icon: "IconScale" },
    description: "Final completeness critic inspection and whole-run sign-off.",
  });

  nodes.push({
    id: "node-terminal-complete",
    name: "Run Completion",
    kind: "terminal" as NodeKind,
    status: state.completion_result?.status === "complete" ? "success" : "pending",
    step: steps.terminalStep,
    stepLabel: `Step ${steps.terminalStep}: Terminal Outcome`,
    badge: { text: "Sealed Run", variant: "success", icon: "IconFlagCheck" },
    description: "Sealed capsule run completion and summary artifact synthesis.",
  });

  const criticExchanges = [
    {
      id: "exch-critic-complete",
      timestamp: new Date().toISOString(),
      source: "node-critic-authority",
      target: "node-terminal-complete",
      kind: "decision",
      summary: "Full capsule signed-off and sealed by completeness critic",
      tokens: 450,
      bytes: 1800,
      durationMs: 50,
      status: "success",
      payloadSnippet: "Whole-run criteria satisfied",
    },
  ];

  edges.push({
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
      bytes: 1800,
      ratePerSec: 1.0,
      status: "active",
      glowColor: "#10b981",
      glowIntensity: 0.8,
      exchanges: criticExchanges,
    },
    exchanges: criticExchanges,
    isHighTraffic: false,
    trafficVolume: 1,
  });

  return {
    id: runId,
    title: `Execution Trajectory: ${runId}`,
    description: `Execution graph dataset and trajectory for run ${runId}`,
    directed: true,
    entry: "node-input-prompt",
    exits: ["node-terminal-complete"],
    sections: [],
    nodes,
    edges,
  };
}
