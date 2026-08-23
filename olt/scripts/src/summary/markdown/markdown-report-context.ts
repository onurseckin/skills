import type { AgentGrantRecord } from "../../contracts/agents.ts";
import type { BranchRecord } from "../../contracts/branch.ts";
import type { Manifest } from "../../contracts/capsule.ts";
import type { CommandRecord } from "../../contracts/commands.ts";
import { isJsonObject } from "../../contracts/json.ts";
import type { TopologyRecord } from "../../contracts/topology.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { readAgentLedgerView } from "../metrics/agent-telemetry.ts";
import type { AsciiWave } from "./markdown-ascii-graph.ts";
import type {
  CommandView,
  CriticReportView,
  DispositionView,
  EnhancedPlanView,
  GateView,
  RequirementView,
  TaskChecklistCoverageView,
} from "./markdown-sources.ts";
import {
  readBranches,
  readCommands,
  readCriticReport,
  readDispositions,
  readEnhancedPlan,
  readGates,
  readGraphRevision,
  readRequirements,
  readTaskChecklistCoverage,
  readTopologyRecord,
} from "./markdown-sources.ts";
import type {
  ActionStepRecord,
  FileRef,
  GraphDataset,
  RollupMetrics,
  TimelineEventRecord,
} from "../types.ts";

export interface ReportContextInput {
  runId: string;
  runRoot: string;
  manifest: Manifest;
  promptText: string;
  state: Readonly<WorkflowState>;
  commands: Record<string, CommandRecord>;
  metrics: RollupMetrics;
  timeline: TimelineEventRecord[];
  graph: GraphDataset;
}

export interface ReportContext {
  runId: string;
  runRoot: string;
  manifest: Manifest;
  promptText: string;
  enhancedPlan: EnhancedPlanView | null;
  criticReport: CriticReportView | null;
  state: Readonly<WorkflowState>;
  tasks: TaskRecord[];
  requirements: RequirementView[];
  dispositions: DispositionView[];
  gates: GateView[];
  branches: BranchRecord[];
  agents: AgentGrantRecord[];
  agentLedgerIssue: string | undefined;
  commands: CommandView[];
  topology: TopologyRecord | null;
  graphRevision: number | null;
  waves: AsciiWave[];
  metrics: RollupMetrics;
  timeline: TimelineEventRecord[];
  checklistCoverage: TaskChecklistCoverageView[];
  steps: readonly ActionStepRecord[];
  taskFiles: ReadonlyMap<string, readonly FileRef[]>;
  branchFiles: ReadonlyMap<string, readonly FileRef[]>;
}

function orderedTasks(state: Readonly<WorkflowState>): TaskRecord[] {
  const tasks = state.tasks ?? {};
  const order = state.task_order;
  const ids = Array.isArray(order)
    ? order.filter((id): id is string => typeof id === "string")
    : [];
  const seen = new Set<string>();
  const ordered: TaskRecord[] = [];
  for (const id of ids) {
    const task = tasks[id];
    if (task !== undefined && !seen.has(id)) {
      seen.add(id);
      ordered.push(task);
    }
  }
  for (const [id, task] of Object.entries(tasks)) {
    if (!seen.has(id) && isJsonObject(task)) ordered.push(task);
  }
  return ordered;
}

function buildWaves(topology: TopologyRecord | null, tasks: readonly TaskRecord[]): AsciiWave[] {
  const placed = new Set<string>();
  const waves: AsciiWave[] = [];
  for (const wave of topology?.waves ?? []) {
    for (const taskId of wave.task_ids) placed.add(taskId);
    waves.push({ wave: wave.wave, taskIds: [...wave.task_ids] });
  }
  const unplaced = tasks.filter((task) => !placed.has(task.id)).map((task) => task.id);
  if (unplaced.length > 0) waves.push({ wave: null, taskIds: unplaced });
  return waves;
}

function fileRefsByTaskId(
  graph: GraphDataset,
  tasks: readonly TaskRecord[],
): ReadonlyMap<string, readonly FileRef[]> {
  const map = new Map<string, readonly FileRef[]>();
  for (const task of tasks) {
    const files = graph.nodes.find((node) => node.id === `node-task-${task.id}`)?.files;
    if (files !== undefined && files.length > 0) map.set(task.id, files);
  }
  return map;
}

function fileRefsByBranchId(
  graph: GraphDataset,
  branches: readonly BranchRecord[],
): ReadonlyMap<string, readonly FileRef[]> {
  const map = new Map<string, readonly FileRef[]>();
  for (const branch of branches) {
    const files = graph.sections?.find(
      (entry) => entry.id === `section-branch-${branch.id}`,
    )?.files;
    if (files !== undefined && files.length > 0) map.set(branch.id, files);
  }
  return map;
}

export function buildReportContext(input: ReportContextInput): ReportContext {
  const ledger = readAgentLedgerView(input.state);
  const tasks = orderedTasks(input.state);
  const topology = readTopologyRecord(input.state);
  const branches = readBranches(input.state);
  return {
    runId: input.runId,
    runRoot: input.runRoot,
    manifest: input.manifest,
    promptText: input.promptText,
    enhancedPlan: readEnhancedPlan(input.runRoot),
    criticReport: readCriticReport(input.runRoot),
    state: input.state,
    tasks,
    requirements: readRequirements(input.state),
    dispositions: readDispositions(input.state),
    gates: readGates(input.state),
    branches,
    agents: [...ledger.grants.values()],
    agentLedgerIssue: ledger.integrityIssue,
    commands: readCommands(input.state, input.commands),
    topology,
    graphRevision: readGraphRevision(input.state),
    waves: buildWaves(topology, tasks),
    metrics: input.metrics,
    timeline: input.timeline,
    checklistCoverage: tasks.flatMap((task) => {
      const coverage = readTaskChecklistCoverage(input.runRoot, task.id);
      return coverage === null ? [] : [coverage];
    }),
    steps: input.graph.run?.steps ?? [],
    taskFiles: fileRefsByTaskId(input.graph, tasks),
    branchFiles: fileRefsByBranchId(input.graph, branches),
  };
}
