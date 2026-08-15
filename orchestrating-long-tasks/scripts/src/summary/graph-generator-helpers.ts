import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import {
  mapCommandDetails,
  mapFindingDetails,
  mapMediaAssets,
  detectPlaywrightMetadata,
} from "./asset-mapper.ts";
import { createEdge } from "./edge-builder.ts";
import { detectHostModel, detectHostTelemetry, resolveModelTier } from "./host-telemetry.ts";
import type {
  EdgeTrafficExchange,
  FileRef,
  GraphEdgeData,
  GraphNodeData,
  IoPort,
  NodeKind,
  NodeStatus,
} from "./types.ts";

export {
  createEdge,
  detectHostModel,
  detectHostTelemetry,
  detectPlaywrightMetadata,
  mapCommandDetails,
  mapFindingDetails,
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
}

export function buildTaskAndGateNodes(ctx: TaskNodeContext): {
  taskNode: GraphNodeData;
  gateNode: GraphNodeData;
  taskEdges: GraphEdgeData[];
} {
  const { task, taskStep, taskWave, taskCmds } = ctx;
  const taskNodeId = `node-task-${task.id}`;
  const gateNodeId = `node-gate-${task.id}`;
  const taskName = typeof task.label === "string" ? task.label : task.id;
  const gateStep = taskStep + 1;

  const changedRaw = task.report?.files_changed;
  const changed = Array.isArray(changedRaw)
    ? changedRaw.filter((p): p is string => typeof p === "string")
    : task.write_scope;
  const files: FileRef[] = changed.map((p) => ({
    path: p,
    mode: "write" as const,
  }));
  const findings = mapFindingDetails(task);
  const mediaAssets = mapMediaAssets(task, taskCmds);
  const playwrightMetadata = detectPlaywrightMetadata(task, taskCmds, mediaAssets);

  const metadata: Record<string, unknown> = {
    writeScope: task.write_scope,
    repairRounds: task.repair_round ?? 0,
    commands: mapCommandDetails(taskCmds),
    findings,
    mediaAssets,
    screenshots: mediaAssets.filter((a) => a.type === "image"),
    assets: mediaAssets,
    ...(playwrightMetadata ? { playwrightMetadata } : {}),
  };
  const agent = task.lease?.agent_id ?? task.original_implementer;
  if (agent) metadata.leaseAgent = agent;

  const { model, tier } = detectHostModel(agent);
  const hostTelemetry = detectHostTelemetry(agent);

  const taskInputs: IoPort[] = task.dependencies.map((depId) => ({
    node: `node-gate-${depId}`,
    kind: "artifact",
    label: `Dependency Output: ${depId}`,
  }));
  const summaryText = typeof task.report?.summary === "string" ? task.report.summary : undefined;
  const taskOutputs: IoPort[] = [
    {
      kind: "summary",
      label: summaryText ?? `Task ${task.id} Output`,
      ...(summaryText ? { preview: summaryText } : {}),
    },
  ];

  const badgeText = agent
    ? `Worker: ${agent}`
    : model && tier
      ? `${model} [${tier.toUpperCase()}]`
      : `Task ${task.id}`;

  const taskNode: GraphNodeData = {
    id: taskNodeId,
    name: taskName,
    kind: "agent" as NodeKind,
    status: mapTaskStatus(task.status),
    step: taskStep,
    stepLabel: `Step ${taskStep}: Wave ${taskWave} Tasks`,
    ...(model !== undefined ? { model } : {}),
    ...(tier !== undefined ? { tier } : {}),
    badge: {
      text: badgeText,
      variant: "info",
      icon: "IconRobot",
    },
    description: summaryText ?? `Goal and execution scope for ${taskName}.`,
    files,
    metrics: hostTelemetry.hostAgent?.tokens
      ? {
          tokens: hostTelemetry.hostAgent.tokens,
          hostAgent: hostTelemetry.hostAgent,
        }
      : undefined,
    io: { inputs: taskInputs, outputs: taskOutputs },
    metadata,
    mediaAssets,
    screenshots: mediaAssets.filter((a) => a.type === "image"),
  };

  const isGateDone = task.status === "done";
  const gateBadgeText = isGateDone
    ? "Passed"
    : findings.length > 0
      ? `Pushback: ${findings.length} Finding${findings.length > 1 ? "s" : ""}`
      : "Verification Check";
  const gateNode: GraphNodeData = {
    id: gateNodeId,
    name: `Gate: ${taskName}`,
    kind: "gate" as NodeKind,
    status: isGateDone ? "success" : task.validation ? "running" : "pending",
    step: gateStep,
    stepLabel: `Step ${gateStep}: Wave ${taskWave} Validation`,
    badge: {
      text: gateBadgeText,
      variant: isGateDone ? "success" : "warning",
      icon: "IconShieldCheck",
    },
    description: `Independent verification gate for ${taskName}.`,
    metadata: {
      findings,
      mediaAssets,
      screenshots: mediaAssets.filter((a) => a.type === "image"),
      ...(playwrightMetadata ? { playwrightMetadata } : {}),
    },
    mediaAssets,
    screenshots: mediaAssets.filter((a) => a.type === "image"),
  };

  const spawnExchanges: EdgeTrafficExchange[] = [
    {
      id: `exch-spawn-${task.id}`,
      timestamp: new Date().toISOString(),
      source: "node-orchestrator-plan",
      target: taskNodeId,
      kind: "prompt",
      summary: `Dispatched task ${task.id} to worker ${agent ?? "unassigned"}`,
      tokens: 350,
      bytes: 1400,
      durationMs: 30,
      status: "success",
      payloadSnippet: `Goal: ${taskName}`,
    },
  ];

  const submitExchanges: EdgeTrafficExchange[] = [
    {
      id: `exch-submit-${task.id}`,
      timestamp: new Date().toISOString(),
      source: taskNodeId,
      target: gateNodeId,
      kind: "file",
      summary: `Submitted diffs for ${task.id} (${files.length} files)`,
      tokens: 650,
      bytes: files.length * 1024,
      durationMs: 80,
      status: "success",
      payloadSnippet: files.map((f) => f.path).join(", "),
    },
  ];

  const taskEdges: GraphEdgeData[] = [
    createEdge(
      `edge-plan-${task.id}`,
      "node-orchestrator-plan",
      taskNodeId,
      "spawn",
      taskStep,
      "Dispatches Worker",
      agent ? `Lease: ${agent}` : "Task Assignment",
      "info",
      "IconRocket",
      undefined,
      undefined,
      spawnExchanges,
      false,
    ),
    createEdge(
      `edge-task-gate-${task.id}`,
      taskNodeId,
      gateNodeId,
      "sequence",
      `${taskStep} -> ${gateStep}`,
      "Submits Implementation",
      files.length > 0 ? `${files.length} Files Modified` : "Diff Submission",
      "neutral",
      "IconArrowRight",
      undefined,
      undefined,
      submitExchanges,
      files.length > 1,
    ),
  ];

  if ((task.repair_round ?? 0) > 0) {
    const repairExchanges: EdgeTrafficExchange[] = findings.map((f, idx) => ({
      id: `exch-repair-${task.id}-${idx + 1}`,
      timestamp: new Date().toISOString(),
      source: gateNodeId,
      target: taskNodeId,
      kind: "decision",
      summary: `Pushback Finding: ${f.observation}`,
      tokens: 280,
      bytes: 890,
      durationMs: 60,
      status: "warning",
      payloadSnippet: f.remediation ?? f.observation,
    }));

    taskEdges.push(
      createEdge(
        `edge-repair-${task.id}`,
        gateNodeId,
        taskNodeId,
        "loop",
        `${gateStep} -> ${taskStep}`,
        `Validator Pushback (Round ${task.repair_round})`,
        `${findings.length} Findings`,
        "warning",
        "IconAlertCircle",
        true,
        "feedback",
        repairExchanges,
        true,
        "#f59e0b",
        0.9,
      ),
    );
  }

  for (const depId of task.dependencies) {
    const depExchanges: EdgeTrafficExchange[] = [
      {
        id: `exch-dep-${depId}-${task.id}`,
        timestamp: new Date().toISOString(),
        source: `node-gate-${depId}`,
        target: taskNodeId,
        kind: "artifact",
        summary: `Handoff verified artifact from ${depId} to ${task.id}`,
        tokens: 420,
        bytes: 1200,
        durationMs: 40,
        status: "success",
        payloadSnippet: `Dependency contract ${depId} fulfilled`,
      },
    ];

    taskEdges.push(
      createEdge(
        `edge-dep-${depId}-${task.id}`,
        `node-gate-${depId}`,
        taskNodeId,
        "dependency",
        taskStep,
        "Dependency Unlocked",
        `Dep: ${depId}`,
        "cyan",
        "IconArrowRight",
        undefined,
        undefined,
        depExchanges,
        true,
        "#06b6d4",
        0.8,
      ),
    );
  }

  const joinExchanges: EdgeTrafficExchange[] = [
    {
      id: `exch-join-${task.id}`,
      timestamp: new Date().toISOString(),
      source: gateNodeId,
      target: "node-critic-authority",
      kind: "artifact",
      summary: `Evidence scorecard and verification proof for ${task.id}`,
      tokens: 300,
      bytes: 950,
      durationMs: 35,
      status: "success",
      payloadSnippet: `Gate check passed with status ${isGateDone ? "DONE" : "PENDING"}`,
    },
  ];

  taskEdges.push(
    createEdge(
      `edge-join-${task.id}`,
      gateNodeId,
      "node-critic-authority",
      "join",
      gateStep + 1,
      "Evidence Report",
      "Gate Verified",
      "success",
      "IconFileText",
      undefined,
      undefined,
      joinExchanges,
      false,
    ),
  );

  return { taskNode, gateNode, taskEdges };
}
