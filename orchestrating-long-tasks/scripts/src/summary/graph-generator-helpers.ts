import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import type {
  CommandExecutionDetail,
  FindingDetail,
  GraphEdgeData,
  GraphNodeData,
  IoPort,
  NodeKind,
  NodeStatus,
} from "./types.ts";

export function mapTaskStatus(status: string): NodeStatus {
  switch (status) {
    case "done": return "success";
    case "changes_requested": return "warning";
    case "leased": case "running": case "submitted": return "running";
    case "failed": case "cancelled": case "escalated": return "error";
    default: return "pending";
  }
}

export function mapCommandDetails(commands: CommandRecord[]): CommandExecutionDetail[] {
  return commands.map((c) => {
    const started = c.started_at ? Date.parse(c.started_at) : 0;
    const finished = c.finished_at ? Date.parse(c.finished_at) : started;
    const stdout = typeof c.stdout === "string" ? c.stdout.slice(-1000) : undefined;
    const stderr = typeof c.stderr === "string" ? c.stderr.slice(-1000) : undefined;
    return {
      id: c.id,
      argv: c.argv,
      cwd: c.cwd,
      exitCode: c.exit_code ?? 0,
      durationMs: finished >= started ? finished - started : 0,
      startedAt: c.started_at,
      finishedAt: c.finished_at ?? c.started_at,
      logPath: c.record_path,
      ...(stdout !== undefined ? { stdoutSnippet: stdout } : {}),
      ...(stderr !== undefined ? { stderrSnippet: stderr } : {}),
    };
  });
}

export function mapFindingDetails(task: TaskRecord): FindingDetail[] {
  return (task.findings ?? []).map((f) => ({
    id: f.id,
    requirementId: f.requirement_id,
    severity: f.severity === "critical" ? "critical" : f.severity === "minor" ? "suggestion" : "important",
    observation: f.observation,
    remediation: f.remediation,
    status: f.status === "resolved" ? "resolved" : "open",
  }));
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
  const files = changed.map((p) => ({ path: p, mode: "write" as const }));
  const findings = mapFindingDetails(task);

  const metadata: Record<string, unknown> = {
    writeScope: task.write_scope,
    repairRounds: task.repair_round ?? 0,
    commands: mapCommandDetails(taskCmds),
    findings,
  };
  const agent = task.lease?.agent_id ?? task.original_implementer;
  if (agent) metadata.leaseAgent = agent;

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
      ...(summaryText !== undefined ? { preview: summaryText } : {}),
    },
  ];

  const taskNode: GraphNodeData = {
    id: taskNodeId,
    name: taskName,
    kind: "agent" as NodeKind,
    status: mapTaskStatus(task.status),
    step: taskStep,
    stepLabel: `Step ${taskStep}: Wave ${taskWave} Tasks`,
    badge: { text: agent ? `Worker: ${agent}` : "Sonnet 4.5 [M]", variant: "info", icon: "IconRobot" },
    description: summaryText ?? `Goal and execution scope for ${taskName}.`,
    sectionId: "sec-execution",
    files,
    io: { inputs: taskInputs, outputs: taskOutputs },
    metadata,
  };

  const isGateDone = task.status === "done";
  const gateNode: GraphNodeData = {
    id: gateNodeId,
    name: `Gate: ${taskName}`,
    kind: "gate" as NodeKind,
    status: isGateDone ? "success" : task.validation ? "running" : "pending",
    step: gateStep,
    stepLabel: `Step ${gateStep}: Wave ${taskWave} Validation`,
    badge: { text: isGateDone ? "Passed" : "Verification Check", variant: isGateDone ? "success" : "warning", icon: "IconShieldCheck" },
    description: `Independent verification gate for ${taskName}.`,
    sectionId: "sec-validation",
    metadata: { findings },
  };

  const taskEdges: GraphEdgeData[] = [
    {
      id: `edge-plan-${task.id}`,
      source: "node-orchestrator-plan",
      target: taskNodeId,
      kind: "spawn",
      badge: { text: "Dispatches Worker", variant: "info", icon: "IconRocket" },
    },
    {
      id: `edge-task-gate-${task.id}`,
      source: taskNodeId,
      target: gateNodeId,
      kind: "sequence",
      badge: { text: "Submit for Review", variant: "neutral", icon: "IconArrowRight" },
    },
  ];

  if ((task.repair_round ?? 0) > 0) {
    taskEdges.push({
      id: `edge-repair-${task.id}`,
      source: gateNodeId,
      target: taskNodeId,
      kind: "loop",
      isCycle: true,
      badge: {
        text: `Pushback: Round ${task.repair_round} (${findings.length} Findings)`,
        variant: "warning",
        icon: "IconAlertCircle",
        clickable: true,
        targetTab: "feedback",
      },
    });
  }

  for (const depId of task.dependencies) {
    taskEdges.push({ id: `edge-dep-${depId}-${task.id}`, source: `node-gate-${depId}`, target: taskNodeId, kind: "sequence" });
  }

  taskEdges.push({
    id: `edge-join-${task.id}`,
    source: gateNodeId,
    target: "node-critic-authority",
    kind: "join",
    badge: { text: "Evidence Report", variant: "success", icon: "IconFileText" },
  });

  return { taskNode, gateNode, taskEdges };
}
