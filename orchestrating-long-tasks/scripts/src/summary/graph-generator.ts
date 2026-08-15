import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import type {
  CommandExecutionDetail,
  FindingDetail,
  GraphDataset,
  GraphEdgeData,
  GraphNodeData,
  GraphSection,
  NodeKind,
  NodeStatus,
} from "./types.ts";

export interface GraphGeneratorInput {
  runId: string;
  state: Readonly<WorkflowState>;
  promptText?: string;
  commands?: Record<string, CommandRecord>;
}

function mapTaskStatus(status: string): NodeStatus {
  switch (status) {
    case "done": return "success";
    case "changes_requested": return "warning";
    case "leased": case "running": case "submitted": return "running";
    case "failed": case "cancelled": case "escalated": return "error";
    default: return "pending";
  }
}

function mapCommandDetails(commands: CommandRecord[]): CommandExecutionDetail[] {
  return commands.map((c) => {
    const started = c.started_at ? Date.parse(c.started_at) : 0;
    const finished = c.finished_at ? Date.parse(c.finished_at) : started;
    return {
      id: c.id,
      argv: c.argv,
      cwd: c.cwd,
      exitCode: c.exit_code ?? 0,
      durationMs: finished >= started ? finished - started : 0,
      startedAt: c.started_at,
      finishedAt: c.finished_at ?? c.started_at,
      logPath: c.record_path,
    };
  });
}

function mapFindingDetails(task: TaskRecord): FindingDetail[] {
  return (task.findings ?? []).map((f) => {
    const severity: "critical" | "important" | "suggestion" =
      f.severity === "critical" ? "critical" : f.severity === "minor" ? "suggestion" : "important";
    return {
      id: f.id,
      requirementId: f.requirement_id,
      severity,
      observation: f.observation,
      remediation: f.remediation,
      status: f.status === "resolved" ? "resolved" : "open",
    };
  });
}

export function generateGraphDataset(input: GraphGeneratorInput): GraphDataset {
  const { runId, state, promptText = "" } = input;
  const tasks = Object.values(state.tasks ?? {}) as TaskRecord[];
  const allCommands = Object.values({ ...(state.commands ?? {}), ...(input.commands ?? {}) } as Record<string, CommandRecord>);

  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];
  const execNodeIds: string[] = [];
  const valNodeIds: string[] = [];

  nodes.push({
    id: "node-input-prompt",
    name: "User Request Prompt",
    kind: "input" as NodeKind,
    status: "success" as NodeStatus,
    description: "Original user prompt request initiating the run.",
    sectionId: "sec-planning",
    prompt: promptText,
  });

  nodes.push({
    id: "node-orchestrator-plan",
    name: "Execution Plan",
    kind: "orchestrator" as NodeKind,
    status: "success" as NodeStatus,
    description: "Structured execution graph and work decomposition plan.",
    sectionId: "sec-planning",
  });

  edges.push({ id: "edge-prompt-plan", source: "node-input-prompt", target: "node-orchestrator-plan", kind: "sequence" });

  for (const task of tasks) {
    const taskNodeId = `node-task-${task.id}`;
    const gateNodeId = `node-gate-${task.id}`;
    const taskName = typeof task.label === "string" ? task.label : task.id;
    execNodeIds.push(taskNodeId);
    valNodeIds.push(gateNodeId);

    const taskCmds = allCommands.filter((c) => c.task_id === task.id);
    const changedRaw = task.report?.files_changed;
    const changed = Array.isArray(changedRaw)
      ? changedRaw.filter((p): p is string => typeof p === "string")
      : task.write_scope;
    const files = changed.map((p) => ({ path: p, mode: "write" as const }));

    const metadata: Record<string, unknown> = {
      writeScope: task.write_scope,
      repairRounds: task.repair_round ?? 0,
      commands: mapCommandDetails(taskCmds),
      findings: mapFindingDetails(task),
    };
    const agent = task.lease?.agent_id ?? task.original_implementer;
    if (agent) metadata.leaseAgent = agent;

    nodes.push({
      id: taskNodeId,
      name: taskName,
      kind: "agent" as NodeKind,
      status: mapTaskStatus(task.status),
      description: typeof task.report?.summary === "string" ? task.report.summary : (typeof task.label === "string" ? task.label : `Execution task ${task.id}`),
      sectionId: "sec-execution",
      files,
      metadata,
    });

    nodes.push({
      id: gateNodeId,
      name: `Gate: ${taskName}`,
      kind: "gate" as NodeKind,
      status: task.status === "done" ? "success" : task.validation ? "running" : "pending",
      description: `Independent validation gate and evidence verification for ${taskName}.`,
      sectionId: "sec-validation",
    });

    edges.push({ id: `edge-plan-${task.id}`, source: "node-orchestrator-plan", target: taskNodeId, kind: "spawn" });
    edges.push({ id: `edge-task-gate-${task.id}`, source: taskNodeId, target: gateNodeId, kind: "sequence" });

    if ((task.repair_round ?? 0) > 0) {
      edges.push({ id: `edge-repair-${task.id}`, source: gateNodeId, target: taskNodeId, kind: "loop", isCycle: true });
    }

    for (const depId of task.dependencies) {
      edges.push({ id: `edge-dep-${depId}-${task.id}`, source: `node-gate-${depId}`, target: taskNodeId, kind: "sequence" });
    }

    edges.push({ id: `edge-join-${task.id}`, source: gateNodeId, target: "node-critic-authority", kind: "join" });
  }

  nodes.push({
    id: "node-critic-authority",
    name: "Completeness Critic Review",
    kind: "critic" as NodeKind,
    status: state.completion_review ? "success" : "running",
    description: "Final completeness critic inspection and whole-run sign-off.",
    sectionId: "sec-review",
  });

  nodes.push({
    id: "node-terminal-complete",
    name: "Run Completion",
    kind: "terminal" as NodeKind,
    status: state.completion_result?.status === "complete" ? "success" : "pending",
    description: "Sealed capsule run completion and summary artifact synthesis.",
    sectionId: "sec-review",
  });

  edges.push({ id: "edge-critic-complete", source: "node-critic-authority", target: "node-terminal-complete", kind: "sequence" });

  const sections: GraphSection[] = [
    { id: "sec-planning", title: "Phase 1: Planning & Setup", nodeIds: ["node-input-prompt", "node-orchestrator-plan"] },
    { id: "sec-execution", title: "Phase 2: Task Execution", nodeIds: execNodeIds },
    { id: "sec-validation", title: "Phase 3: Validation Gates", nodeIds: valNodeIds },
    { id: "sec-review", title: "Phase 4: Completeness & Review", nodeIds: ["node-critic-authority", "node-terminal-complete"] },
  ];

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
  };
}
