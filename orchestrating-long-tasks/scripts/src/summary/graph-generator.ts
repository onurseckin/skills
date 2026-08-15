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
  const allCommands = Object.values({ ...(state.commands ?? {}), ...(input.commands ?? {}) } as Record<string, CommandRecord>);
  const steps = computeExecutionSteps(tasks);

  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];
  const execNodeIds: string[] = [];
  const valNodeIds: string[] = [];

  nodes.push({
    id: "node-input-prompt",
    name: "User Request Prompt",
    kind: "input" as NodeKind,
    status: "success" as NodeStatus,
    step: 1,
    stepLabel: "Step 1: User Prompt",
    badge: { text: "Stdin (Verified)", variant: "neutral", icon: "IconTerminal2" },
    description: promptText ? promptText.slice(0, 180) : "Original user prompt initiating the run.",
    sectionId: "sec-planning",
    prompt: promptText,
    io: { outputs: [{ kind: "prompt", label: "User Instruction", preview: promptText, tokens: Math.round(promptText.length / 4) }] },
  });

  nodes.push({
    id: "node-orchestrator-plan",
    name: "Execution Plan",
    kind: "orchestrator" as NodeKind,
    status: "success" as NodeStatus,
    step: 1,
    stepLabel: "Step 1: Planning",
    badge: { text: `${tasks.length} Tasks`, variant: "info", icon: "IconHierarchy2" },
    description: `Structured execution plan across ${tasks.length} tasks and ${steps.taskWaves.size || 1} waves.`,
    sectionId: "sec-planning",
    io: {
      inputs: [{ node: "node-input-prompt", kind: "prompt", label: "User Prompt", preview: promptText.slice(0, 100) }],
      outputs: [{ kind: "decision", label: "DAG Work Decomposition", preview: `${tasks.length} discrete work scopes` }],
    },
  });

  edges.push({
    id: "edge-prompt-plan",
    source: "node-input-prompt",
    target: "node-orchestrator-plan",
    kind: "sequence",
    badge: { text: "Plan Initialization", variant: "info", icon: "IconArrowRight" },
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

    execNodeIds.push(taskNode.id);
    valNodeIds.push(gateNode.id);
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
    badge: { text: "Authority Review", variant: "warning", icon: "IconScale" },
    description: "Final completeness critic inspection and whole-run sign-off.",
    sectionId: "sec-review",
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
    sectionId: "sec-review",
  });

  edges.push({ id: "edge-critic-complete", source: "node-critic-authority", target: "node-terminal-complete", kind: "sequence" });

  const sections: GraphSection[] = [
    { id: "sec-planning", title: "Phase 1: Planning & Setup", nodeIds: ["node-input-prompt", "node-orchestrator-plan"] },
    { id: "sec-execution", title: "Phase 2: Task Execution", nodeIds: execNodeIds },
    { id: "sec-validation", title: "Phase 3: Validation Gates", nodeIds: valNodeIds },
    { id: "sec-review", title: "Phase 4: Completeness & Review", nodeIds: ["node-critic-authority", "node-terminal-complete"] },
  ];

  return {
    id: runId,
    title: `Execution Trajectory: ${runId}`,
    description: `Execution graph dataset and trajectory for run ${runId}`,
    directed: true,
    entry: "node-input-prompt",
    exits: ["node-terminal-complete"],
    sections,
    nodes,
    edges,
  };
}
