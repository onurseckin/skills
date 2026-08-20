import type { BranchRecord, BranchSubTask } from "../contracts/branch.ts";
import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import { buildNodeTelemetry, buildNodeTools, type AgentLedgerView } from "./agent-telemetry.ts";
import { mapMediaAssets } from "./asset-mapper.ts";
import { createEdge } from "./edge-builder.ts";
import type { AssetRegistry } from "./graph-asset-ownership.ts";
import { commandDurationMs, commandLogBytes } from "./graph-edge-exchanges.ts";
import { buildNodeBrowserTests } from "./browser-tests.ts";
import { buildNodeScripts } from "./node-evidence.ts";
import type {
  FileRef,
  GraphEdgeData,
  GraphNodeData,
  GraphSection,
  NodeKind,
  NodeStatus,
} from "./types.ts";

export interface BranchSubgraphInput {
  branches: readonly BranchRecord[];
  commands: readonly CommandRecord[];
  stepOfTask: (taskId: string) => number | undefined;
  ledger: AgentLedgerView;
  registry: AssetRegistry;
  events?: readonly HarnessEvent[] | undefined;
  manifest?: Manifest | undefined;
  runRoot?: string | undefined;
}

export interface BranchSubgraph {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  sections: GraphSection[];
}

/**
 * What the closing Git reading saw in the worktree. The entries are the harness's own measurement,
 * so they keep their status code and digest; a branch that closed without an observation
 * contributes nothing rather than an empty change set.
 */
function observedFiles(branch: BranchRecord): FileRef[] {
  const observation = branch.collected_observation ?? branch.opened_observation;
  if (observation === undefined || !observation.git_available) return [];
  return observation.entries.map((entry) => ({
    path: entry.path,
    mode: "write" as const,
    statusCode: entry.status_code,
    sha256: entry.sha256,
    evidence_class: "harness_observed" as const,
  }));
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
    // The reason travels with the node so the graph answers "why is this here?" on its own.
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
    // B25.4: an explicit, justified residual cycle, not the pushback loop B25.2 retired. A branch
    // is a call, not a round — the sub-agent runs once and reports back to the exact parent node
    // that opened it, so there is no sequence of distinct rounds here to give their own nodes to.
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

/**
 * The asymmetry the plan cannot express: a branch is discovered while a task runs, so it becomes a
 * region of its own with one node per sub-agent, grouped by a section that carries the reason.
 */
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
      ...(observedFiles(branch).length > 0 ? { files: observedFiles(branch) } : {}),
      nodeIds: sectionNodeIds,
    });
  }

  return { nodes, edges, sections };
}
