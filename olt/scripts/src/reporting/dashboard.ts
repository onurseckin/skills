import {
  layoutSugiyamaDag,
  type SugiyamaDagReport,
  type SugiyamaEdge,
  type SugiyamaRankedNode,
} from "../graph/sugiyama.ts";

export interface DashboardTaskState {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly effort: number;
  readonly criticalDepth?: number | undefined;
  readonly writeScope: readonly string[];
  readonly dependencies: readonly string[];
  readonly implementerId?: string | undefined;
  readonly validatorId?: string | undefined;
  readonly pushes?: number | undefined;
  readonly maxPushes?: number | undefined;
  readonly probes?: number | undefined;
  readonly repairRound?: number | undefined;
}

export interface DashboardAgentState {
  readonly id: string;
  readonly role: "implementer" | "validator" | "coordinator" | "observer" | "mind";
  readonly tier: number;
  readonly status: "active" | "idle" | "stopped";
  readonly assignedTask?: string | undefined;
}

export interface DashboardOptions {
  readonly detailed?: boolean | undefined;
  readonly terminalWidth?: number | undefined;
  readonly maxLaneWidth?: number | undefined;
}

export interface DashboardMetrics {
  readonly totalTasks: number;
  readonly satisfiedTasks: number;
  readonly activeTasks: number;
  readonly standbyTasks: number;
  readonly totalWork: number;
  readonly criticalPathSpan: number;
  readonly totalLayers: number;
  readonly totalCrossings: number;
  readonly activeAgents: number;
  readonly totalPushes: number;
  readonly totalProbes: number;
  readonly quotaDeficitTasks: number;
}

export interface DashboardReport {
  readonly runId: string;
  readonly phase: string;
  readonly metrics: DashboardMetrics;
  readonly asciiDashboard: string;
  readonly dagReport: SugiyamaDagReport;
  readonly taskList: readonly DashboardTaskState[];
  readonly agentList: readonly DashboardAgentState[];
}

export function calculateDashboardMetrics(
  tasks: readonly DashboardTaskState[],
  agents: readonly DashboardAgentState[],
  dagReport: SugiyamaDagReport,
): DashboardMetrics {
  let satisfied = 0;
  let active = 0;
  let standby = 0;
  let totalWork = 0;
  let totalPushes = 0;
  let totalProbes = 0;
  let quotaDeficitTasks = 0;

  for (const t of tasks) {
    const s = t.status.toLowerCase();
    const isSatisfied = s === "done" || s === "completed" || s === "satisfied";
    if (isSatisfied) satisfied++;
    else if (s === "running" || s === "validating" || s === "leased") active++;
    else standby++;
    totalWork += t.effort;
    totalPushes += t.pushes ?? 0;
    totalProbes += t.probes ?? 0;
    if (isSatisfied && ((t.pushes ?? 0) < 5 || (t.probes ?? 0) < 5)) {
      quotaDeficitTasks++;
    }
  }

  const activeAgents = agents.filter((a) => a.status === "active").length;

  return {
    totalTasks: tasks.length,
    satisfiedTasks: satisfied,
    activeTasks: active,
    standbyTasks: standby,
    totalWork,
    criticalPathSpan: dagReport.criticalPathSpan,
    totalLayers: dagReport.totalLayers,
    totalCrossings: dagReport.totalCrossings,
    activeAgents,
    totalPushes,
    totalProbes,
    quotaDeficitTasks,
  };
}

export function renderMicroCycleTelemetry(tasks: readonly DashboardTaskState[]): string[] {
  const lines: string[] = [
    "┌─ MICRO-CYCLE TELEMETRY & ADVERSARIAL FEEDBACK ────────────────────────────────┐",
  ];
  const activePairs = tasks.filter((t) => t.implementerId || t.validatorId || (t.pushes ?? 0) > 0);
  if (activePairs.length === 0) {
    lines.push("│ (No active micro-cycles or pushback events recorded)                          │");
  } else {
    for (const t of activePairs) {
      const impl = t.implementerId ?? "unassigned";
      const val = t.validatorId ?? "unassigned";
      const pushes = t.pushes ?? 0;
      const maxPushes = t.maxPushes ?? 5;
      const probes = t.probes ?? 0;
      const repairInfo = `Repair: R${t.repairRound ?? 0}`;
      const s = t.status.toLowerCase();
      const isSatisfied = s === "done" || s === "completed" || s === "satisfied";
      const isDeficit = isSatisfied && (pushes < 5 || probes < 5);
      const deficitTag = isDeficit
        ? ` | ⚠️ [DEFICIT: Pushes: ${pushes}/5, Probes: ${probes}/5]`
        : "";
      const pushInfo = `Pushes: ${pushes}/${maxPushes}`;
      const probeInfo = `Probes: ${probes}`;
      const row = `│ ${t.id.padEnd(10)} [I: ${impl.slice(0, 10)}] ──► [V: ${val.slice(0, 10)}] | ${pushInfo} | ${probeInfo} | ${repairInfo}${deficitTag}`;
      lines.push(row.padEnd(79) + "│");
    }
  }
  lines.push("└───────────────────────────────────────────────────────────────────────────────┘");
  return lines;
}

export function renderTaskSummaryTable(tasks: readonly DashboardTaskState[], width = 80): string[] {
  const lines: string[] = [
    "┌─ TASK TOPOLOGY ──────────────────────────────────────────────────────────────┐",
    "│ ID         STATUS      EFFORT  SCOPE                     DEPS                │",
    "├───────────────────────────────────────────────────────────────────────────────┤",
  ];
  if (tasks.length === 0) {
    lines.push("│ (No tasks in topology)                                                       │");
  } else {
    for (const t of tasks) {
      const id = t.id.padEnd(10).slice(0, 10);
      const st = t.status.toUpperCase().padEnd(11).slice(0, 11);
      const eff = `${t.effort}m`.padEnd(7).slice(0, 7);
      const sc = (t.writeScope[0] ?? "-").padEnd(25).slice(0, 25);
      const deps = (t.dependencies.join(",") || "none").padEnd(18).slice(0, 18);
      lines.push(`│ ${id} ${st} ${eff} ${sc} ${deps} │`);
    }
  }
  lines.push("└───────────────────────────────────────────────────────────────────────────────┘");
  return lines;
}

export function renderAgentMatrixSection(
  agents: readonly DashboardAgentState[],
  width = 80,
): string[] {
  const lines: string[] = [
    "┌─ AGENT MATRIX ───────────────────────────────────────────────────────────────┐",
    "│ AGENT ID             ROLE           TIER   STATUS    ASSIGNED TASK            │",
    "├───────────────────────────────────────────────────────────────────────────────┤",
  ];
  if (agents.length === 0) {
    lines.push("│ (No agents registered in cluster)                                             │");
  } else {
    for (const a of agents) {
      const id = a.id.padEnd(20).slice(0, 20);
      const role = a.role.toUpperCase().padEnd(14).slice(0, 14);
      const tier = `T${a.tier}`.padEnd(6).slice(0, 6);
      const st = a.status.toUpperCase().padEnd(9).slice(0, 9);
      const task = (a.assignedTask ?? "-").padEnd(24).slice(0, 24);
      lines.push(`│ ${id} ${role} ${tier} ${st} ${task} │`);
    }
  }
  lines.push("└───────────────────────────────────────────────────────────────────────────────┘");
  return lines;
}

export function renderDashboardHeader(
  runId: string,
  phase: string,
  metrics: DashboardMetrics,
  width = 80,
): string[] {
  return [
    "╔═══════════════════════════════════════════════════════════════════════════════╗",
    `║ UNIFIED MASTER REPORTING DASHBOARD: ${runId.padEnd(41).slice(0, 41)} ║`,
    `║ Phase: ${phase.padEnd(20).slice(0, 20)} | Active Agents: ${String(metrics.activeAgents).padEnd(5)} | Total Work: ${String(metrics.totalWork).padEnd(4)}m ║`,
    `║ Tasks: ${metrics.totalTasks} Total (${metrics.satisfiedTasks} Done, ${metrics.activeTasks} Active, ${metrics.standbyTasks} Standby) | Crossings: ${metrics.totalCrossings} ║`,
    "╚═══════════════════════════════════════════════════════════════════════════════╝",
  ];
}

export function generateDashboardReport(
  runId: string,
  phase: string,
  tasks: readonly DashboardTaskState[],
  agents: readonly DashboardAgentState[],
  options: DashboardOptions = {},
): DashboardReport {
  const rankedNodes: SugiyamaRankedNode[] = tasks.map((t, idx) => ({
    id: t.id,
    label: t.label,
    rank: 0,
    order: idx,
    isDummy: false,
    dependencies: t.dependencies,
    badges: {
      role: t.validatorId && !t.implementerId ? "validator" : "implementer",
      effortMinutes: t.effort,
      spanMinutes: t.effort,
      status: t.status.toUpperCase() as
        | "PENDING"
        | "READY"
        | "LEASED"
        | "RUNNING"
        | "VALIDATING"
        | "COMPLETED"
        | "FAILED",
      implementerId: t.implementerId,
      validatorId: t.validatorId,
      repairRound: t.repairRound,
    },
  }));

  const edges: SugiyamaEdge[] = [];
  for (const t of tasks) {
    for (const dep of t.dependencies) {
      edges.push({ from: dep, to: t.id });
    }
  }

  const dagReport = layoutSugiyamaDag(rankedNodes, edges, {
    maxLaneWidth: options.maxLaneWidth ?? 4,
  });

  const metrics = calculateDashboardMetrics(tasks, agents, dagReport);
  const headerLines = renderDashboardHeader(runId, phase, metrics, options.terminalWidth);
  const taskLines = renderTaskSummaryTable(tasks, options.terminalWidth);
  const telemetryLines = renderMicroCycleTelemetry(tasks);
  const agentLines = renderAgentMatrixSection(agents, options.terminalWidth);

  const fullAscii = [
    ...headerLines,
    "",
    "┌─ SUGIYAMA VISUAL DEPENDENCY GRAPH ───────────────────────────────────────────┐",
    dagReport.asciiDiagram,
    "└───────────────────────────────────────────────────────────────────────────────┘",
    "",
    ...taskLines,
    "",
    ...telemetryLines,
    "",
    ...agentLines,
  ].join("\n");

  return {
    runId,
    phase,
    metrics,
    asciiDashboard: fullAscii,
    dagReport,
    taskList: tasks,
    agentList: agents,
  };
}

export function renderDashboardAscii(report: DashboardReport): string {
  return report.asciiDashboard;
}
