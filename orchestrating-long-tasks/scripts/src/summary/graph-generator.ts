import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import { buildPromptAndPlanNodes } from "./graph-generator-core-nodes.ts";
import { buildCriticAndTerminalNodes } from "./graph-generator-critic-nodes.ts";
import { buildTaskAndGateNodes } from "./graph-generator-helpers.ts";
import { computeExecutionSteps } from "./step-calculator.ts";
import type { GraphDataset, GraphEdgeData, GraphNodeData } from "./types.ts";

export interface GraphGeneratorInput {
  runId: string;
  state: Readonly<WorkflowState>;
  promptText?: string;
  commands?: Record<string, CommandRecord>;
  events?: readonly HarnessEvent[];
  manifest?: Manifest;
  runRoot?: string;
}

export function generateGraphDataset(input: GraphGeneratorInput): GraphDataset {
  const { runId, state, promptText = "", events, manifest, runRoot } = input;
  const tasks = Object.values(state.tasks ?? {}) as TaskRecord[];
  const allCommands = Object.values({
    ...(state.commands ?? {}),
    ...(input.commands ?? {}),
  } as Record<string, CommandRecord>);
  const steps = computeExecutionSteps(tasks);

  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];

  const { promptNode, planNode, promptPlanEdge } = buildPromptAndPlanNodes(
    promptText,
    tasks,
    steps.taskWaves.size || 1,
  );
  nodes.push(promptNode, planNode);
  edges.push(promptPlanEdge);

  for (const task of tasks) {
    const taskStep = steps.taskSteps.get(task.id) ?? 2;
    const taskWave = steps.taskWaves.get(task.id) ?? 1;
    const taskCmds = allCommands.filter((c) => c.task_id === task.id);

    const { taskNode, gateNode, taskEdges } = buildTaskAndGateNodes({
      task,
      taskStep,
      taskWave,
      taskCmds,
      events,
      manifest,
      runRoot,
    });

    nodes.push(taskNode, gateNode);
    edges.push(...taskEdges);
  }

  const { criticNode, terminalNode, criticCompleteEdge } = buildCriticAndTerminalNodes(
    runId,
    state,
    steps,
    tasks,
    allCommands,
    events,
    manifest,
    runRoot,
  );
  nodes.push(criticNode, terminalNode);
  edges.push(criticCompleteEdge);

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
