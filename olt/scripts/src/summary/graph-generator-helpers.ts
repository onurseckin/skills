import { buildNodeTelemetry, buildNodeTools, reportedTokenUsage } from "./agent-telemetry.ts";
import { mapTaskStatus, type TaskNodeContext } from "./graph-node-context.ts";
import { buildNodeBrowserTests } from "./browser-tests.ts";
import { buildNodeScripts, buildStateTransitions } from "./node-evidence.ts";
import { computeTaskTiming, computeTaskTokens } from "./metrics-collector.ts";
import type { BadgeDetail, GraphNodeData, IoPort, NodeKind, NodeMetrics } from "./types.ts";

export { mapGateStatus, mapTaskStatus } from "./graph-node-context.ts";

function implementerBadge(ctx: TaskNodeContext): BadgeDetail | undefined {
  const { task } = ctx;
  if (task.status === "changes_requested") {
    return {
      text: `Repairing (Round ${task.repair_round ?? 1})`,
      variant: "warning",
      icon: "IconAlertTriangle",
      targetTab: "feedback",
    };
  }
  if (task.status === "branched") {
    return { text: "Branched", variant: "info", icon: "IconGitBranch" };
  }
  if (task.status === "done" || task.status === "validated") {
    return { text: "Task Satisfied", variant: "success", icon: "IconRobot" };
  }
  if (task.status === "running" || task.status === "leased") {
    return { text: "Implementing", variant: "info", icon: "IconProgress" };
  }
  return undefined;
}

function historyBadges(ctx: TaskNodeContext): GraphNodeData["badges"] {
  const badges: NonNullable<GraphNodeData["badges"]> = [];
  const repairs = ctx.task.repair_round ?? 0;
  const probes = ctx.task.probe_round ?? 0;
  if (repairs > 0) badges.push({ label: `${repairs} repair rounds`, variant: "amber" });
  if (probes > 0) badges.push({ label: `${probes} adversarial probes`, variant: "info" });
  return badges.length > 0 ? badges : undefined;
}

function implementerIo(ctx: TaskNodeContext): { inputs: IoPort[]; outputs: IoPort[] } {
  const { task, taskName, files, implementerCommands } = ctx;
  const inputs: IoPort[] = task.dependencies.map((depId) => ({
    node: `node-gate-${depId}`,
    kind: "artifact",
    label: `Dependency Output: ${depId}`,
    preview: `Verified dependency contract from task ${depId}`,
  }));
  inputs.push({
    node: "node-orchestrator-plan",
    kind: "prompt",
    label: "Task Goal",
    preview: taskName,
  });
  if ((task.repair_round ?? 0) > 0) {
    inputs.push({
      node: ctx.gateNodeId,
      kind: "decision",
      label: `Pushback Decision (Round ${task.repair_round})`,
      preview: `${ctx.findings.length} findings returned for repair`,
    });
  }
  if ((task.probe_round ?? 0) > 0 && ctx.validatorNodeId) {
    inputs.push({
      node: ctx.validatorNodeId,
      kind: "decision",
      label: `Adversarial Probe (Round ${task.probe_round})`,
      preview: "Proof demanded; no defect asserted",
    });
  }

  const summary = typeof task.report?.summary === "string" ? task.report.summary : undefined;
  const outputs: IoPort[] = [
    {
      kind: "summary",
      label: "Task Summary",
      ...(summary !== undefined ? { preview: summary } : {}),
    },
    { kind: "file", label: "Modified Files", preview: `${files.length} files changed` },
    {
      kind: "artifact",
      label: "Task Evidence",
      preview: `${implementerCommands.length} commands recorded`,
    },
  ];
  return { inputs, outputs };
}

export function buildImplementerNode(ctx: TaskNodeContext): GraphNodeData {
  const { task, taskName, files, implementerCommands, agentId, ledger } = ctx;
  const assets = ctx.implementerAssets;

  const telemetry = buildNodeTelemetry(agentId, ledger);
  const tools = buildNodeTools(agentId, ledger);
  const timingBreakdown = computeTaskTiming(task, ctx.events, implementerCommands);
  const tokens = computeTaskTokens(
    task,
    ctx.manifest,
    implementerCommands,
    reportedTokenUsage(agentId, ledger),
  );

  const metrics: NodeMetrics = {
    ...(tokens.inputTokens !== undefined ? { tokensIn: tokens.inputTokens } : {}),
    ...(tokens.outputTokens !== undefined ? { tokensOut: tokens.outputTokens } : {}),
    ...(tokens.costUsd !== undefined ? { costUsd: tokens.costUsd } : {}),
    durationMs: timingBreakdown.wallDurationMs,
    commandCount: implementerCommands.length,
    retries: task.repair_round ?? 0,
    tokens,
    timingBreakdown,
  };

  const description =
    typeof task.report?.summary === "string" && task.report.summary.trim().length > 0
      ? task.report.summary
      : typeof task.instructions === "string" && task.instructions.trim().length > 0
        ? task.instructions
        : `${taskName} implementation and scope execution.`;

  const browserTests = buildNodeBrowserTests(implementerCommands, ctx.runRoot);
  const badge = implementerBadge(ctx);
  const badges = historyBadges(ctx);
  const io = implementerIo(ctx);

  return {
    id: ctx.taskNodeId,
    name: taskName,
    description,
    kind: "agent" as NodeKind,
    status: mapTaskStatus(task.status),
    step: ctx.taskStep,
    stepLabel: `Wave ${ctx.taskWave}`,
    ...(badge ? { badge } : {}),
    ...(badges ? { badges } : {}),
    ...(telemetry ? { telemetry } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    scripts: buildNodeScripts(implementerCommands, ctx.runRoot),
    ...(browserTests.length > 0 ? { browserTests } : {}),
    stateTransitions: buildStateTransitions(task, ctx.events),
    ...(assets.length > 0 ? { assets } : {}),
    files,
    metrics,
    io: { inputs: io.inputs, outputs: io.outputs },
    metadata: {
      ...(telemetry?.role ? { role: telemetry.role } : {}),
      ...(agentId ? { agentId } : {}),
      writeScope: task.write_scope,
      repairRounds: task.repair_round ?? 0,
      probeRounds: task.probe_round ?? 0,
      taskStatus: task.status,
      pushbackFindingIds: ctx.findings.map((finding) => finding.id),
      ...(task.worktree_commit
        ? {
            worktreeCommit: {
              sha: task.worktree_commit.sha,
              subject: task.worktree_commit.subject,
              changedLines: task.worktree_commit.changed_lines,
              overLimit: task.worktree_commit.over_limit,
            },
          }
        : {}),
    },
  };
}
