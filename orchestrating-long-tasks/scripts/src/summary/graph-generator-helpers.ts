import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import type {
  CommandExecutionDetail,
  FileRef,
  FindingDetail,
  GraphEdgeData,
  GraphNodeData,
  IoPort,
  ModelTier,
  NodeKind,
  NodeStatus,
} from "./types.ts";

export function mapTaskStatus(status: string): NodeStatus {
  if (status === "done") return "success";
  if (status === "changes_requested") return "warning";
  if (status === "leased" || status === "running" || status === "submitted") return "running";
  if (status === "failed" || status === "cancelled" || status === "escalated") return "error";
  return "pending";
}

export function detectHostModel(agentId?: string): { model: string; tier: ModelTier } {
  const envModel = process.env.MODEL ?? process.env.AI_MODEL ?? process.env.GEMINI_MODEL ?? process.env.ANTIGRAVITY_MODEL;
  if (envModel && envModel.trim().length > 0) {
    const trimmed = envModel.trim();
    const lower = trimmed.toLowerCase();
    const tier: ModelTier = lower.includes("pro") || lower.includes("opus") || lower.includes("large")
      ? "l"
      : lower.includes("flash") || lower.includes("haiku") || lower.includes("small")
      ? "s"
      : "m";
    return { model: trimmed, tier };
  }
  return { model: "Gemini 2.0 Flash", tier: "s" };
}

export function mapCommandDetails(commands: CommandRecord[]): CommandExecutionDetail[] {
  return commands.map((c) => {
    const started = c.started_at ? Date.parse(c.started_at) : 0;
    const finished = c.finished_at ? Date.parse(c.finished_at) : started;
    const stdout = typeof c.stdout === "string" ? c.stdout.slice(-1000) : undefined;
    const stderr = typeof c.stderr === "string" ? c.stderr.slice(-1000) : undefined;
    return {
      id: c.id, argv: c.argv, cwd: c.cwd, exitCode: c.exit_code ?? 0,
      durationMs: finished >= started ? finished - started : 0,
      startedAt: c.started_at, finishedAt: c.finished_at ?? c.started_at, logPath: c.record_path,
      ...(stdout !== undefined ? { stdoutSnippet: stdout } : {}),
      ...(stderr !== undefined ? { stderrSnippet: stderr } : {}),
    };
  });
}

export function mapFindingDetails(task: TaskRecord): FindingDetail[] {
  return (task.findings ?? []).map((f) => ({
    id: f.id, requirementId: f.requirement_id,
    severity: f.severity === "critical" ? "critical" : f.severity === "minor" ? "suggestion" : "important",
    observation: f.observation, remediation: f.remediation,
    status: f.status === "resolved" ? "resolved" : "open",
  }));
}

export interface TaskNodeContext {
  task: TaskRecord;
  taskStep: number;
  taskWave: number;
  taskCmds: CommandRecord[];
}

function createEdge(
  id: string, source: string, target: string, kind: GraphEdgeData["kind"],
  stepNumber: number | string, title: string, detail: string,
  variant: "info" | "warning" | "error" | "success" | "neutral" | "cyan", icon: string,
  isCycle?: boolean, targetTab?: string,
): GraphEdgeData {
  const edge: GraphEdgeData = {
    id, source, target, stepNumber,
    badge: {
      text: title,
      variant: variant === "cyan" ? "info" : variant,
      icon,
      clickable: Boolean(targetTab),
      ...(targetTab ? { targetTab } : {}),
    },
    container: { stepBadge: String(stepNumber), title, detail, variant, icon },
  };
  if (kind !== undefined) edge.kind = kind;
  if (isCycle !== undefined) edge.isCycle = isCycle;
  return edge;
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
  const files: FileRef[] = changed.map((p) => ({ path: p, mode: "write" as const }));
  const findings = mapFindingDetails(task);

  const metadata: Record<string, unknown> = {
    writeScope: task.write_scope,
    repairRounds: task.repair_round ?? 0,
    commands: mapCommandDetails(taskCmds),
    findings,
  };
  const agent = task.lease?.agent_id ?? task.original_implementer;
  if (agent) metadata.leaseAgent = agent;

  const { model, tier } = detectHostModel(agent);

  const taskInputs: IoPort[] = task.dependencies.map((depId) => ({
    node: `node-gate-${depId}`, kind: "artifact", label: `Dependency Output: ${depId}`,
  }));
  const summaryText = typeof task.report?.summary === "string" ? task.report.summary : undefined;
  const taskOutputs: IoPort[] = [
    { kind: "summary", label: summaryText ?? `Task ${task.id} Output`, ...(summaryText ? { preview: summaryText } : {}) },
  ];

  const taskNode: GraphNodeData = {
    id: taskNodeId, name: taskName, kind: "agent" as NodeKind, status: mapTaskStatus(task.status),
    step: taskStep, stepLabel: `Step ${taskStep}: Wave ${taskWave} Tasks`, model, tier,
    badge: { text: agent ? `Worker: ${agent}` : `${model} [${tier.toUpperCase()}]`, variant: "info", icon: "IconRobot" },
    description: summaryText ?? `Goal and execution scope for ${taskName}.`, files,
    io: { inputs: taskInputs, outputs: taskOutputs }, metadata,
  };

  const isGateDone = task.status === "done";
  const gateBadgeText = isGateDone ? "Passed" : (findings.length > 0 ? `Pushback: ${findings.length} Finding${findings.length > 1 ? "s" : ""}` : "Verification Check");
  const gateNode: GraphNodeData = {
    id: gateNodeId, name: `Gate: ${taskName}`, kind: "gate" as NodeKind,
    status: isGateDone ? "success" : task.validation ? "running" : "pending",
    step: gateStep, stepLabel: `Step ${gateStep}: Wave ${taskWave} Validation`,
    badge: { text: gateBadgeText, variant: isGateDone ? "success" : "warning", icon: "IconShieldCheck" },
    description: `Independent verification gate for ${taskName}.`, metadata: { findings },
  };

  const taskEdges: GraphEdgeData[] = [
    createEdge(`edge-plan-${task.id}`, "node-orchestrator-plan", taskNodeId, "spawn", taskStep, "Dispatches Worker", agent ? `Lease: ${agent}` : "Task Assignment", "info", "IconRocket"),
    createEdge(`edge-task-gate-${task.id}`, taskNodeId, gateNodeId, "sequence", `${taskStep} -> ${gateStep}`, "Submits Implementation", files.length > 0 ? `${files.length} Files Modified` : "Diff Submission", "neutral", "IconArrowRight"),
  ];

  if ((task.repair_round ?? 0) > 0) {
    taskEdges.push(createEdge(`edge-repair-${task.id}`, gateNodeId, taskNodeId, "loop", `${gateStep} -> ${taskStep}`, `Validator Pushback (Round ${task.repair_round})`, `${findings.length} Findings`, "warning", "IconAlertCircle", true, "feedback"));
  }

  for (const depId of task.dependencies) {
    taskEdges.push(createEdge(`edge-dep-${depId}-${task.id}`, `node-gate-${depId}`, taskNodeId, "dependency", taskStep, "Dependency Unlocked", `Dep: ${depId}`, "cyan", "IconArrowRight"));
  }

  taskEdges.push(createEdge(`edge-join-${task.id}`, gateNodeId, "node-critic-authority", "join", gateStep + 1, "Evidence Report", "Gate Verified", "success", "IconFileText"));

  return { taskNode, gateNode, taskEdges };
}
