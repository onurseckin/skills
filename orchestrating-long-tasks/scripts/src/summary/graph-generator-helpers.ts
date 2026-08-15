import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
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
import {
  computeGateTiming,
  computeGateTokens,
  computeTaskTiming,
  computeTaskTokens,
} from "./metrics-collector.ts";
import type {
  EdgeTrafficExchange,
  FileRef,
  GraphEdgeData,
  GraphNodeData,
  IoPort,
  NodeKind,
  NodeMetrics,
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

export function mapGateStatus(task: TaskRecord): NodeStatus {
  if (task.status === "done" || task.status === "validated") return "success";
  if (task.status === "changes_requested") return "warning";
  if (task.status === "failed" || task.status === "cancelled" || task.status === "escalated") return "error";
  if (task.status === "validating" || task.status === "gating" || Boolean(task.validation)) return "running";
  return "pending";
}

export interface TaskNodeContext {
  task: TaskRecord;
  taskStep: number;
  taskWave: number;
  taskCmds: CommandRecord[];
  events?: readonly HarnessEvent[];
  manifest?: Manifest;
}

export function buildTaskAndGateNodes(ctx: TaskNodeContext): {
  taskNode: GraphNodeData;
  gateNode: GraphNodeData;
  taskEdges: GraphEdgeData[];
} {
  const { task, taskStep, taskWave, taskCmds, events, manifest } = ctx;
  const taskNodeId = `node-task-${task.id}`, gateNodeId = `node-gate-${task.id}`;
  const taskName = typeof task.label === "string" ? task.label : task.id;
  const gateStep = taskStep + 1;

  const changedRaw = task.report?.files_changed;
  const changed = Array.isArray(changedRaw)
    ? changedRaw.filter((p): p is string => typeof p === "string")
    : task.write_scope;
  const files: FileRef[] = changed.map((p) => ({ path: p, mode: "write" as const }));
  const findings = mapFindingDetails(task);
  const mediaAssets = mapMediaAssets(task, taskCmds);
  const playwrightMetadata = detectPlaywrightMetadata(task, taskCmds, mediaAssets);

  const agent = task.lease?.agent_id ?? task.original_implementer;
  const metadata: Record<string, unknown> = {
    writeScope: task.write_scope,
    repairRounds: task.repair_round ?? 0,
    commands: mapCommandDetails(taskCmds),
    findings,
    mediaAssets,
    screenshots: mediaAssets.filter((a) => a.type === "image"),
    assets: mediaAssets,
    ...(agent ? { leaseAgent: agent } : {}),
    ...(playwrightMetadata ? { playwrightMetadata } : {}),
  };

  const { model, tier } = detectHostModel(agent);
  const hostTelemetry = detectHostTelemetry(agent);
  const timingBreakdown = computeTaskTiming(task, events, taskCmds);
  const taskTokens = computeTaskTokens(task, manifest, taskCmds, hostTelemetry.hostAgent?.tokens);

  const taskInputs: IoPort[] = task.dependencies.map((depId) => ({
    node: `node-gate-${depId}`, kind: "artifact", label: `Dependency Output: ${depId}`,
  }));
  const summaryText = typeof task.report?.summary === "string" ? task.report.summary : undefined;
  const taskOutputs: IoPort[] = [{
    kind: "summary", label: summaryText ?? `Task ${task.id} Output`, ...(summaryText ? { preview: summaryText } : {}),
  }];

  const badgeText = agent ? `Worker: ${agent}` : model && tier ? `${model} [${tier.toUpperCase()}]` : `Task ${task.id}`;
  const taskNodeMetrics: NodeMetrics = {
    tokensIn: taskTokens.inputTokens,
    tokensOut: taskTokens.outputTokens,
    ...(taskTokens.costUsd !== undefined ? { costUsd: taskTokens.costUsd } : {}),
    durationMs: timingBreakdown.wallDurationMs,
    commandCount: taskCmds.length,
    retries: task.repair_round ?? 0,
    tokens: taskTokens,
    ...(hostTelemetry.hostAgent ? { hostAgent: hostTelemetry.hostAgent } : {}),
    timingBreakdown,
  };

  const taskNode: GraphNodeData = {
    id: taskNodeId, name: taskName, kind: "agent" as NodeKind, status: mapTaskStatus(task.status),
    step: taskStep, stepLabel: `Step ${taskStep}: Wave ${taskWave} Tasks`,
    ...(model !== undefined ? { model } : {}), ...(tier !== undefined ? { tier } : {}),
    badge: { text: badgeText, variant: "info", icon: "IconRobot" },
    description: summaryText ?? `Goal and execution scope for ${taskName}.`,
    files, metrics: taskNodeMetrics, io: { inputs: taskInputs, outputs: taskOutputs },
    metadata, mediaAssets, screenshots: mediaAssets.filter((a) => a.type === "image"),
  };

  const latestValHistory = Array.isArray(task.validation_history) && task.validation_history.length > 0
    ? task.validation_history[task.validation_history.length - 1]
    : undefined;
  const validatorId = task.validation?.validator_id ?? latestValHistory?.validator_id;
  const valTelemetry = detectHostTelemetry(validatorId);
  const { model: valModel, tier: valTier } = detectHostModel(validatorId);

  const isGateDone = task.status === "done" || task.status === "validated";
  const isGateWarning = task.status === "changes_requested";
  const isGateError = task.status === "failed" || task.status === "cancelled" || task.status === "escalated";
  const gateStatus = mapGateStatus(task);
  const gateBadgeVariant = gateStatus === "success" ? "success" : gateStatus === "warning" ? "warning" : gateStatus === "error" ? "error" : "info";
  const gateBadgeText = isGateDone
    ? "Passed"
    : findings.length > 0
      ? `Pushback: ${findings.length} Finding${findings.length > 1 ? "s" : ""}`
      : isGateError
        ? "Failed"
        : isGateWarning
          ? "Changes Requested"
          : "Verification Check";
  const gateTiming = computeGateTiming(task, events, taskCmds);
  const gateTokens = computeGateTokens(task, taskCmds, valTelemetry.hostAgent?.tokens);
  const gateValCmds = taskCmds.filter((c) => Boolean(c.gate_id) || c.actor === "val");

  const gateNode: GraphNodeData = {
    id: gateNodeId, name: `Gate: ${taskName}`, kind: "gate" as NodeKind,
    status: gateStatus,
    step: gateStep, stepLabel: `Step ${gateStep}: Wave ${taskWave} Validation`,
    badge: { text: gateBadgeText, variant: gateBadgeVariant, icon: isGateDone ? "IconShieldCheck" : isGateWarning ? "IconAlertTriangle" : isGateError ? "IconX" : "IconShieldCheck" },
    description: `Independent verification gate for ${taskName}.`,
    ...(valModel !== undefined ? { model: valModel } : {}),
    ...(valTier !== undefined ? { tier: valTier } : {}),
    metrics: {
      tokensIn: gateTokens.inputTokens,
      tokensOut: gateTokens.outputTokens,
      ...(gateTokens.costUsd !== undefined ? { costUsd: gateTokens.costUsd } : {}),
      durationMs: gateTiming?.wallDurationMs ?? 0,
      commandCount: gateValCmds.length,
      tokens: gateTokens,
      ...(valTelemetry.hostAgent ? { hostAgent: valTelemetry.hostAgent } : {}),
      ...(gateTiming ? { timingBreakdown: gateTiming } : {}),
    },
    metadata: {
      findings, mediaAssets, screenshots: mediaAssets.filter((a) => a.type === "image"),
      assets: mediaAssets, commands: mapCommandDetails(gateValCmds),
      writeScope: task.write_scope,
      repairRounds: task.repair_round ?? 0,
      validationHistory: task.validation_history ?? [],
      ...(validatorId ? { validator_id: validatorId, leaseAgent: validatorId } : {}),
      ...(playwrightMetadata ? { playwrightMetadata } : {}),
    },
    mediaAssets, screenshots: mediaAssets.filter((a) => a.type === "image"),
  };

  const now = new Date().toISOString();
  const spawnExchanges: EdgeTrafficExchange[] = [{
    id: `exch-spawn-${task.id}`, timestamp: now, source: "node-orchestrator-plan", target: taskNodeId,
    kind: "prompt", summary: `Dispatched task ${task.id} to worker ${agent ?? "unassigned"}`,
    tokens: 350, tokensIn: 100, tokensOut: 250, bytes: 1400, durationMs: 30, status: "success",
    payloadSnippet: `Goal: ${taskName}`,
  }];

  const submitExchanges: EdgeTrafficExchange[] = [{
    id: `exch-submit-${task.id}`, timestamp: now, source: taskNodeId, target: gateNodeId,
    kind: "file", summary: `Submitted diffs for ${task.id} (${files.length} files)`,
    tokens: 650, tokensIn: 150, tokensOut: 500, bytes: files.length * 1024, durationMs: 80, status: "success",
    payloadSnippet: files.map((f) => f.path).join(", "),
  }];

  const taskEdges: GraphEdgeData[] = [
    createEdge(
      `edge-plan-${task.id}`, "node-orchestrator-plan", taskNodeId, "spawn", taskStep,
      "Dispatches Worker", agent ? `Lease: ${agent}` : "Task Assignment", "info", "IconRocket",
      undefined, undefined, spawnExchanges, false, "#3b82f6", 0.75,
      { tokensIn: 100, tokensOut: 250, latencyMs: 30, status: "nominal" },
    ),
    createEdge(
      `edge-task-gate-${task.id}`, taskNodeId, gateNodeId, "sequence", `${taskStep} -> ${gateStep}`,
      "Submits Implementation", files.length > 0 ? `${files.length} Files Modified` : "Diff Submission",
      "neutral", "IconArrowRight", undefined, undefined, submitExchanges, files.length > 1, "#8b5cf6", 0.8,
      { tokensIn: 150, tokensOut: 500, latencyMs: 80, status: files.length > 2 ? "high" : "nominal" },
    ),
  ];

  if ((task.repair_round ?? 0) > 0) {
    const rawFindings = findings.length > 0 ? findings : [{ id: `finding-${task.id}-0`, observation: "Pushback requested changes", severity: "important" as const, status: "open" as const }];
    const repairExchanges: EdgeTrafficExchange[] = rawFindings.map((f, idx) => ({
      id: `exch-repair-${task.id}-${idx + 1}`, timestamp: now, source: gateNodeId, target: taskNodeId,
      kind: "decision", summary: `Pushback Finding: ${f.observation}`, tokens: 280, tokensIn: 180, tokensOut: 100,
      bytes: 890, durationMs: 60, status: "warning", payloadSnippet: f.remediation ?? f.observation,
    }));
    taskEdges.push(createEdge(
      `edge-repair-${task.id}`, gateNodeId, taskNodeId, "loop", `${gateStep} -> ${taskStep}`,
      `Validator Pushback (Round ${task.repair_round})`, `${findings.length} Findings`, "warning", "IconAlertCircle",
      true, "feedback", repairExchanges, true, "#f43f5e", 0.9,
      { tokensIn: rawFindings.length * 180, tokensOut: rawFindings.length * 100, latencyMs: 60, status: "congested" },
    ));
  }

  for (const depId of task.dependencies) {
    const depExchanges: EdgeTrafficExchange[] = [{
      id: `exch-dep-${depId}-${task.id}`, timestamp: now, source: `node-gate-${depId}`, target: taskNodeId,
      kind: "artifact", summary: `Handoff verified artifact from ${depId} to ${task.id}`, tokens: 420, tokensIn: 120, tokensOut: 300,
      bytes: 1200, durationMs: 40, status: "success", payloadSnippet: `Dependency contract ${depId} fulfilled`,
    }];
    taskEdges.push(createEdge(
      `edge-dep-${depId}-${task.id}`, `node-gate-${depId}`, taskNodeId, "dependency", taskStep,
      "Dependency Unlocked", `Dep: ${depId}`, "cyan", "IconArrowRight", undefined, undefined,
      depExchanges, true, "#06b6d4", 0.85, { tokensIn: 120, tokensOut: 300, latencyMs: 40, status: "nominal" },
    ));
  }

  const joinExchanges: EdgeTrafficExchange[] = [{
    id: `exch-join-${task.id}`, timestamp: now, source: gateNodeId, target: "node-critic-authority",
    kind: "artifact", summary: `Evidence scorecard and verification proof for ${task.id}`,
    tokens: 300, tokensIn: 100, tokensOut: 200, bytes: 950, durationMs: 35, status: "success",
    payloadSnippet: `Gate check passed with status ${isGateDone ? "DONE" : "PENDING"}`,
  }];
  taskEdges.push(createEdge(
    `edge-join-${task.id}`, gateNodeId, "node-critic-authority", "join", gateStep + 1,
    "Evidence Report", "Gate Verified", "success", "IconFileText", undefined, undefined,
    joinExchanges, false, "#10b981", 0.7, { tokensIn: 100, tokensOut: 200, latencyMs: 35, status: "nominal" },
  ));

  return { taskNode, gateNode, taskEdges };
}
