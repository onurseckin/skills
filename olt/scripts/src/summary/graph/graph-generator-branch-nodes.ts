import type { BranchRecord, BranchSubTask } from "../../core/contracts/index.ts";
import type { HarnessEvent, Manifest } from "../../core/contracts/index.ts";
import type { CommandRecord } from "../../core/contracts/index.ts";
import type { RepositoryGitCommand } from "../../packets/repository-git-command.ts";
import {
  buildNodeTelemetry,
  buildNodeTools,
  type AgentLedgerView,
} from "../metrics/agent-telemetry.ts";
import { mapMediaAssets } from "../assets/asset-mapper.ts";
import { createEdge } from "./edge-builder.ts";
import type { AssetRegistry } from "./graph-asset-ownership.ts";
import { commandDurationMs, commandLogBytes } from "./graph-edge-exchanges.ts";
import { buildNodeBrowserTests } from "../formatters/browser-tests.ts";
import { enrichFileRefsWithDiffs } from "../formatters/index.ts";
import { buildNodeScripts } from "../markdown/index.ts";
import type {
  FileRef,
  GraphEdgeData,
  GraphNodeData,
  GraphSection,
  NodeKind,
  NodeStatus,
} from "./graph-types.ts";

export interface BranchSubgraphInput {
  branches: readonly BranchRecord[];
  commands: readonly CommandRecord[];
  stepOfTask: (taskId: string) => number | undefined;
  ledger: AgentLedgerView;
  registry: AssetRegistry;
  events?: readonly HarnessEvent[] | undefined;
  manifest?: Manifest | undefined;
  runRoot?: string | undefined;
  gitCommand?: RepositoryGitCommand | undefined;
}

export interface BranchSubgraph {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  sections: GraphSection[];
}

function observedFiles(
  branch: BranchRecord,
  runRoot: string | undefined,
  gitCommand: RepositoryGitCommand | undefined,
): FileRef[] {
  const observation = branch.collected_observation ?? branch.opened_observation;
  if (observation === undefined || !observation.git_available) return [];
  const files = observation.entries.map((entry) => ({
    path: entry.path,
    mode: "write" as const,
    statusCode: entry.status_code,
    sha256: entry.sha256,
    evidence_class: "harness_observed" as const,
  }));
  return enrichFileRefsWithDiffs(files, runRoot, gitCommand);
}

function subTaskStatus(subTask: BranchSubTask): NodeStatus {
  if (subTask.status === "submitted") return "success";
  if (subTask.status === "abandoned") return "error";
  if (subTask.status === "claimed" || subTask.status === "branched") return "running";
  return "pending";
}

function subTaskNodeId(branch: BranchRecord, subTask: BranchSubTask): string {
  return `node-branch-${branch.id}-${subTask.id}`;
}

function buildSubTaskNode(
  branch: BranchRecord,
  subTask: BranchSubTask,
  step: number | undefined,
  input: BranchSubgraphInput,
): GraphNodeData {
  const commands = input.commands.filter((command) => command.task_id === subTask.id);
  const assets = input.registry.claim(
    mapMediaAssets(undefined, commands, {
      scope: "implementer",
      ...(input.runRoot !== undefined ? { runRoot: input.runRoot } : {}),
    }),
  );
  const telemetry = buildNodeTelemetry(subTask.agent_id, input.ledger);
  const tools = buildNodeTools(subTask.agent_id, input.ledger);
  const browserTests = buildNodeBrowserTests(commands, input.runRoot);

  return {
    id: subTaskNodeId(branch, subTask),
    name: subTask.label,
    description: `Sub-task of ${branch.parent_task_id}. Branch reason: ${branch.reason}`,
    kind: "agent" as NodeKind,
    status: subTaskStatus(subTask),
    ...(step !== undefined ? { step } : {}),
    stepLabel: `Branch ${branch.id}`,
    sectionId: `section-branch-${branch.id}`,
    badge: {
      text: `Sub-task: ${subTask.status}`,
      variant:
        subTask.status === "submitted"
          ? "success"
          : subTask.status === "abandoned"
            ? "error"
            : "info",
      icon: "IconGitBranch",
    },
    ...(telemetry ? { telemetry } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    scripts: buildNodeScripts(commands, input.runRoot),
    ...(browserTests.length > 0 ? { browserTests } : {}),
    ...(assets.length > 0 ? { assets } : {}),
    metadata: {
      ...(telemetry?.role ? { role: telemetry.role } : {}),
      branchId: branch.id,
      branchReason: branch.reason,
      subTaskId: subTask.id,
      subTaskStatus: subTask.status,
      parentTaskId: branch.parent_task_id,
      writeScope: subTask.write_scope,
      depth: branch.depth,
      ...(subTask.agent_id ? { agentId: subTask.agent_id } : {}),
      ...(subTask.gate ? { gate: subTask.gate } : {}),
      ...(subTask.summary ? { summary: subTask.summary } : {}),
      ...(subTask.recovery ? { recovery: subTask.recovery } : {}),
      ...(subTask.claimed_at ? { claimedAt: subTask.claimed_at } : {}),
      ...(subTask.submitted_at ? { submittedAt: subTask.submitted_at } : {}),
      ...(subTask.abandoned_at ? { abandonedAt: subTask.abandoned_at } : {}),
      ...(subTask.lease ? { lease: subTask.lease } : {}),
      branchStatus: branch.status,
      branchOpenedAt: branch.opened_at,
      ...(branch.collected_at ? { branchCollectedAt: branch.collected_at } : {}),
      ...(branch.abandoned_at ? { branchAbandonedAt: branch.abandoned_at } : {}),
      ...(branch.outcome_summary ? { branchOutcomeSummary: branch.outcome_summary } : {}),
    },
  };
}

function branchEdges(
  branch: BranchRecord,
  subTask: BranchSubTask,
  parentNodeId: string,
  commands: readonly CommandRecord[],
): GraphEdgeData[] {
  const nodeId = subTaskNodeId(branch, subTask);
  const subCommands = commands.filter((command) => command.task_id === subTask.id);
  const edges: GraphEdgeData[] = [
    createEdge({
      id: `edge-branch-${branch.id}-${subTask.id}`,
      source: parentNodeId,
      target: nodeId,
      kind: "branch",
      title: "Branches Sub-agent",
      detail: branch.reason,
      variant: "info",
      icon: "IconGitBranch",
      exchanges: [
        {
          id: `exch-branch-${branch.id}-${subTask.id}`,
          timestamp: branch.opened_at,
          direction: "forward",
          type: "branch",
          kind: "decision",
          summary: `Opened ${subTask.id}: ${subTask.label}`,
          detail: branch.reason,
          evidence_class: "harness_observed",
        },
      ],
    }),
  ];

  if (subTask.status === "submitted" || subTask.status === "abandoned") {
    const abandoned = subTask.status === "abandoned";
    edges.push(
      createEdge({
        id: `edge-collect-${branch.id}-${subTask.id}`,
        source: nodeId,
        target: parentNodeId,
        kind: "collect",
        title: abandoned ? "Sub-agent Abandoned" : "Collects Sub-result",
        ...(subTask.summary !== undefined ? { detail: subTask.summary } : {}),
        variant: abandoned ? "error" : "success",
        icon: "IconArrowBackUp",
        isCycle: true,
        exchanges: [
          {
            id: `exch-collect-${branch.id}-${subTask.id}`,
            ...((subTask.submitted_at ?? subTask.abandoned_at)
              ? { timestamp: subTask.submitted_at ?? subTask.abandoned_at }
              : {}),
            direction: "reverse",
            type: "collect",
            kind: "summary",
            summary: subTask.summary ?? `Sub-task ${subTask.id} ${subTask.status}`,
            verdict: abandoned ? "FAIL" : "PASS",
            evidence_class: "harness_observed",
          },
        ],
        observed: {
          ...(commandLogBytes(subCommands) !== undefined
            ? { bytes: commandLogBytes(subCommands) }
            : {}),
          ...(commandDurationMs(subCommands) !== undefined
            ? { durationMs: commandDurationMs(subCommands) }
            : {}),
        },
      }),
    );
  }
  return edges;
}

export function buildBranchSubgraphs(input: BranchSubgraphInput): BranchSubgraph {
  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];
  const sections: GraphSection[] = [];
  const nodeIdBySubTask = new Map<string, string>();

  for (const branch of input.branches) {
    const parentNodeId =
      nodeIdBySubTask.get(branch.parent_task_id) ?? `node-task-${branch.parent_task_id}`;
    const step = input.stepOfTask(branch.parent_task_id);
    const sectionNodeIds: string[] = [];

    for (const subTask of branch.sub_tasks) {
      const node = buildSubTaskNode(branch, subTask, step, input);
      nodes.push(node);
      nodeIdBySubTask.set(subTask.id, node.id);
      sectionNodeIds.push(node.id);
      edges.push(...branchEdges(branch, subTask, parentNodeId, input.commands));
    }

    const branchFiles = observedFiles(branch, input.runRoot, input.gitCommand);
    sections.push({
      id: `section-branch-${branch.id}`,
      title: `Branch of ${branch.parent_task_id}`,
      description: branch.reason,
      reason: branch.reason,
      parentNodeId,
      status: branch.status,
      depth: branch.depth,
      openedAt: branch.opened_at,
      ...((branch.collected_at ?? branch.abandoned_at)
        ? { closedAt: branch.collected_at ?? branch.abandoned_at }
        : {}),
      ...(branch.outcome_summary !== undefined ? { outcomeSummary: branch.outcome_summary } : {}),
      ...(branch.files_changed !== undefined ? { filesChanged: branch.files_changed } : {}),
      ...(branchFiles.length > 0 ? { files: branchFiles } : {}),
      nodeIds: sectionNodeIds,
    });
  }

  return { nodes, edges, sections };
}
