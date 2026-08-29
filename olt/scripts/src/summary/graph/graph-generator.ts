import type { BranchRecord } from "../../core/contracts/index.ts";
import type { HarnessEvent, Manifest } from "../../core/contracts/index.ts";
import type { CommandRecord } from "../../core/contracts/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import type { RepositoryGitCommand } from "../../packets/repository-git-command.ts";
import { readBranchLedger } from "../../workflow/branch/ledger.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { readAgentLedgerView } from "../metrics/agent-telemetry.ts";
import { AssetRegistry } from "./graph-asset-ownership.ts";
import { buildBranchSubgraphs } from "./graph-generator-branch-nodes.ts";
import { buildRunFacts } from "./graph-run-facts.ts";
import { buildNodeScripts } from "../markdown/node-evidence.ts";
import { buildPromptAndPlanNodes } from "./graph-generator-core-nodes.ts";
import { buildCriticAndTerminalNodes } from "./graph-generator-critic-nodes.ts";
import { buildPlanValidatorNodes } from "./graph-generator-plan-validator-nodes.ts";
import { buildGateNode } from "./graph-generator-gate-helpers.ts";
import { buildImplementerNode } from "./graph-generator-helpers.ts";
import { buildValidatorNode } from "./graph-generator-validator-nodes.ts";
import { buildTaskEdges } from "./graph-edge-factory.ts";
import { buildArchivedRoundNodes } from "./graph-round-nodes.ts";
import { prepareTaskContext } from "./graph-task-preparation.ts";
import { computeExecutionSteps } from "../metrics/step-calculator.ts";
import type { GraphDataset, GraphEdgeData, GraphNodeData, GraphSection } from "../types.ts";

export interface GraphGeneratorInput {
  runId: string;
  state: Readonly<WorkflowState>;
  promptText?: string;
  commands?: Record<string, CommandRecord>;
  events?: readonly HarnessEvent[];
  manifest?: Manifest;
  runRoot?: string;
  gitCommand?: RepositoryGitCommand;
}

function readBranches(state: Readonly<WorkflowState>): BranchRecord[] {
  if (!isJsonObject(state)) return [];
  try {
    return readBranchLedger(state);
  } catch {
    return [];
  }
}

export function generateGraphDataset(input: GraphGeneratorInput): GraphDataset {
  const { runId, state, promptText = "", events, manifest, runRoot, gitCommand } = input;
  const tasks = Object.values(state.tasks ?? {}) as TaskRecord[];
  const commands = Object.values({
    ...(state.commands ?? {}),
    ...(input.commands ?? {}),
  } as Record<string, CommandRecord>);

  const steps = computeExecutionSteps(tasks, state);
  const ledger = readAgentLedgerView(state);
  const registry = new AssetRegistry();
  const branches = readBranches(state);

  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];

  const core = buildPromptAndPlanNodes({
    promptText,
    tasks,
    steps,
    branchCount: branches.length,
    ...(ledger.integrityIssue !== undefined ? { ledgerIntegrityIssue: ledger.integrityIssue } : {}),
  });
  nodes.push(core.promptNode, core.planNode);
  edges.push(core.promptPlanEdge);

  const planValidation = buildPlanValidatorNodes({ state });
  nodes.push(...planValidation.nodes);
  edges.push(...planValidation.edges);

  for (const task of tasks) {
    const ctx = prepareTaskContext({
      task,
      taskStep: steps.taskSteps.get(task.id) ?? 2,
      taskWave: steps.taskWaves.get(task.id) ?? 1,
      commands,
      ledger,
      registry,
      ...(events !== undefined ? { events } : {}),
      ...(manifest !== undefined ? { manifest } : {}),
      ...(runRoot !== undefined ? { runRoot } : {}),
      ...(gitCommand !== undefined ? { gitCommand } : {}),
    });

    for (const round of ctx.archivedRounds) {
      nodes.push(
        ...buildArchivedRoundNodes({
          task,
          round,
          taskName: ctx.taskName,
          taskStep: ctx.taskStep,
          totalRounds: ctx.totalRounds,
          ledger,
          ...(runRoot !== undefined ? { runRoot } : {}),
        }),
      );
    }

    nodes.push(buildImplementerNode(ctx));
    if (ctx.validatorNodeId !== undefined) nodes.push(buildValidatorNode(ctx));
    nodes.push(buildGateNode(ctx));

    edges.push(
      ...buildTaskEdges({
        task,
        taskNodeId: ctx.taskNodeId,
        gateNodeId: ctx.gateNodeId,
        ...(ctx.validatorNodeId !== undefined ? { validatorNodeId: ctx.validatorNodeId } : {}),
        taskName: ctx.taskName,
        taskStep: ctx.taskStep,
        gateStep: ctx.gateStep,
        ...(ctx.agentId !== undefined ? { agent: ctx.agentId } : {}),
        ...(ctx.validatorId !== undefined ? { validatorId: ctx.validatorId } : {}),
        files: ctx.files,
        findings: ctx.findings,
        validatorCommands: ctx.validatorCommands,
        archivedRounds: ctx.archivedRounds,
        isGateDone: task.status === "done" || task.status === "validated",
      }),
    );
  }

  const subgraphs = buildBranchSubgraphs({
    branches,
    commands,
    stepOfTask: (taskId) => steps.taskSteps.get(taskId),
    ledger,
    registry,
    ...(events !== undefined ? { events } : {}),
    ...(manifest !== undefined ? { manifest } : {}),
    ...(runRoot !== undefined ? { runRoot } : {}),
    ...(gitCommand !== undefined ? { gitCommand } : {}),
  });
  nodes.push(...subgraphs.nodes);
  edges.push(...subgraphs.edges);
  const sections: GraphSection[] = subgraphs.sections;

  const critic = buildCriticAndTerminalNodes({
    runId,
    state,
    steps,
    tasks,
    commands,
    ledger,
    registry,
    ...(manifest !== undefined ? { manifest } : {}),
    ...(runRoot !== undefined ? { runRoot } : {}),
  });
  nodes.push(critic.criticNode, critic.terminalNode);
  edges.push(...critic.edges);

  const claimed = new Set<string>();
  for (const node of nodes) for (const script of node.scripts ?? []) claimed.add(script.commandId);
  const unclaimed = commands.filter((command) => !claimed.has(command.id));
  if (unclaimed.length > 0) {
    critic.terminalNode.scripts = [
      ...(critic.terminalNode.scripts ?? []),
      ...buildNodeScripts(unclaimed, runRoot),
    ];
    critic.terminalNode.metadata = {
      ...critic.terminalNode.metadata,
      unattributedCommandCount: unclaimed.length,
    };
  }

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
    run: buildRunFacts({
      runId,
      state,
      promptText,
      branches,
      agents: [...ledger.grants.values()],
      ...(events !== undefined ? { events } : {}),
      ...(ledger.integrityIssue !== undefined ? { agentLedgerIssue: ledger.integrityIssue } : {}),
      ...(manifest !== undefined ? { manifest } : {}),
      ...(runRoot !== undefined ? { runRoot } : {}),
    }),
  };
}
