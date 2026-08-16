import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import {
  detectPlaywrightMetadata,
  mapCommandDetails,
  mapFindingDetails,
  mapMediaAssets,
} from "./asset-mapper.ts";
import { createEdge } from "./edge-builder.ts";
import { buildTaskEdges } from "./graph-edge-factory.ts";
import { buildGateNode, mapGateStatus } from "./graph-generator-gate-helpers.ts";
import { detectHostModel, detectHostTelemetry, resolveModelTier } from "./host-telemetry.ts";
import { computeTaskTiming, computeTaskTokens } from "./metrics-collector.ts";
import type {
  BadgeDetail,
  FileRef,
  GraphEdgeData,
  GraphNodeData,
  IoPort,
  NodeKind,
  NodeMetrics,
  NodeStatus,
} from "./types.ts";

export {
  buildGateNode,
  createEdge,
  detectHostModel,
  detectHostTelemetry,
  detectPlaywrightMetadata,
  mapCommandDetails,
  mapFindingDetails,
  mapGateStatus,
  mapMediaAssets,
  resolveModelTier,
};

export function mapTaskStatus(status: string): NodeStatus {
  if (status === "done") return "success";
  if (status === "changes_requested") return "warning";
  if (status === "leased" || status === "running" || status === "submitted") return "running";
  if (status === "failed" || status === "cancelled" || status === "escalated") return "error";
  return "pending";
}

export interface TaskNodeContext {
  task: TaskRecord;
  taskStep: number;
  taskWave: number;
  taskCmds: CommandRecord[];
  events?: readonly HarnessEvent[] | undefined;
  manifest?: Manifest | undefined;
  runRoot?: string | undefined;
}

export function buildTaskAndGateNodes(ctx: TaskNodeContext): {
  taskNode: GraphNodeData;
  gateNode: GraphNodeData;
  taskEdges: GraphEdgeData[];
} {
  const { task, taskStep, taskWave, taskCmds, events, manifest, runRoot } = ctx;
  const taskNodeId = `node-task-${task.id}`,
    gateNodeId = `node-gate-${task.id}`;
  const taskName = typeof task.label === "string" ? task.label : task.id;
  const gateStep = taskStep + 1;

  const changedRaw = task.report?.files_changed;
  const changed = Array.isArray(changedRaw)
    ? changedRaw.filter((p): p is string => typeof p === "string")
    : task.write_scope;
  const files: FileRef[] = changed.map((p) => ({ path: p, mode: "write" as const }));
  const findings = mapFindingDetails(task, {
    ...(events !== undefined ? { events } : {}),
    ...(manifest !== undefined ? { manifest } : {}),
    ...(runRoot !== undefined ? { runRoot } : {}),
  });
  const mediaAssets = mapMediaAssets(task, taskCmds, {
    ...(events !== undefined ? { events } : {}),
    ...(manifest !== undefined ? { manifest } : {}),
    ...(runRoot !== undefined ? { runRoot } : {}),
  });
  const screenshots = mediaAssets.filter(
    (a) => a.type === "image" || a.mimeType?.startsWith("image/"),
  );
  const playwrightMetadata = detectPlaywrightMetadata(task, taskCmds, mediaAssets);

  const agent = task.lease?.agent_id ?? task.original_implementer;
  const metadata: Record<string, unknown> = {
    writeScope: task.write_scope,
    repairRounds: task.repair_round ?? 0,
    commands: mapCommandDetails(taskCmds),
    findings,
    mediaAssets,
    screenshots,
    assets: mediaAssets,
    ...(agent ? { leaseAgent: agent } : {}),
    ...(playwrightMetadata ? { playwrightMetadata } : {}),
  };

  const { model, tier } = detectHostModel(agent);
  const hostTelemetry = detectHostTelemetry(agent);
  const timingBreakdown = computeTaskTiming(task, events, taskCmds);
  const taskTokens = computeTaskTokens(task, manifest, taskCmds, hostTelemetry.hostAgent?.tokens);

  const taskInputs: IoPort[] = task.dependencies.map((depId) => ({
    node: `node-gate-${depId}`,
    kind: "artifact",
    label: `Dependency Output: ${depId}`,
    preview: `Verified dependency contract from task ${depId}`,
  }));
  taskInputs.push({
    node: "node-orchestrator-plan",
    kind: "prompt",
    label: "Task Goal",
    preview: taskName,
  });
  if ((task.repair_round ?? 0) > 0) {
    taskInputs.push({
      node: gateNodeId,
      kind: "decision",
      label: `Pushback Decision (Round ${task.repair_round})`,
      preview: String(findings[0]?.pushbackReason ?? findings[0]?.observation ?? "Changes requested"),
    });
  }

  const summaryPreview =
    typeof task.report?.summary === "string"
      ? task.report.summary
      : `${taskName} execution complete`;

  const taskOutputs: IoPort[] = [
    {
      kind: "summary",
      label: "Task Summary",
      preview: summaryPreview,
    },
    {
      kind: "file",
      label: "Modified Files",
      preview: `${files.length} files changed`,
    },
    {
      kind: "artifact",
      label: "Task Evidence",
      preview: `${taskCmds.length} commands recorded, ${mediaAssets.length} assets`,
    },
  ];

  let taskBadge: BadgeDetail | undefined = undefined;
  if (task.status === "changes_requested") {
    taskBadge = {
      text: `Repairing (Round ${task.repair_round ?? 1})`,
      variant: "warning",
      icon: "IconAlertTriangle",
      targetTab: "feedback",
    };
  } else if (task.status === "done") {
    taskBadge = {
      text: "Task Satisfied",
      variant: "success",
      icon: "IconRobot",
    };
  } else if (task.status === "running" || task.status === "leased") {
    taskBadge = {
      text: "Implementing",
      variant: "info",
      icon: "IconProgress",
    };
  }

  const taskCostUsd =
    taskTokens.costUsd ??
    (hostTelemetry.hostAgent?.tokens?.costUsd !== undefined
      ? hostTelemetry.hostAgent.tokens.costUsd
      : undefined);

  const taskMetrics: NodeMetrics = {
    tokensIn: taskTokens.inputTokens,
    tokensOut: taskTokens.outputTokens,
    ...(taskCostUsd !== undefined ? { costUsd: taskCostUsd } : {}),
    durationMs: timingBreakdown.wallDurationMs,
    commandCount: taskCmds.length,
    retries: task.repair_round ?? 0,
    tokens: taskTokens,
    hostAgent: hostTelemetry.hostAgent,
    timingBreakdown,
  };

  const taskDescription =
    typeof task.report?.summary === "string" && task.report.summary.trim().length > 0
      ? task.report.summary
      : typeof task.instructions === "string" && task.instructions.trim().length > 0
        ? task.instructions
        : `${taskName} implementation and scope execution.`;

  const taskNode: GraphNodeData = {
    id: taskNodeId,
    name: taskName,
    description: taskDescription,
    kind: "agent" as NodeKind,
    status: mapTaskStatus(task.status),
    step: taskStep,
    stepLabel: `Wave ${taskWave}`,
    ...(model ? { model } : {}),
    ...(tier ? { tier } : {}),
    ...(taskBadge ? { badge: taskBadge } : {}),
    files,
    metrics: taskMetrics,
    io: {
      inputs: taskInputs,
      outputs: taskOutputs,
    },
    metadata,
    mediaAssets,
    screenshots,
  };

  const validatorId =
    task.validation?.validator_id ??
    (Array.isArray(task.validation_history) && task.validation_history.length > 0
      ? task.validation_history[task.validation_history.length - 1]?.validator_id
      : undefined);

  const gateNode = buildGateNode({
    task,
    taskNodeId,
    gateNodeId,
    taskName,
    gateStep,
    taskWave,
    files,
    findings,
    mediaAssets,
    screenshots,
    playwrightMetadata,
    validatorId,
    taskCmds,
    events,
    runRoot,
  });

  const now = new Date().toISOString();
  const isGateDone = task.status === "done" || task.status === "validated";
  const taskEdges = buildTaskEdges({
    task,
    taskNodeId,
    gateNodeId,
    taskName,
    taskStep,
    gateStep,
    agent,
    validatorId,
    files,
    findings,
    now,
    isGateDone,
  });

  return { taskNode, gateNode, taskEdges };
}
