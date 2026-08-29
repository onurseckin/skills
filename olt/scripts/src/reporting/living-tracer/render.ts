/**
 * Living Tracer ASCII DAG Renderer & Report Builder
 */
import { formatTable } from "../../cli/formatters/line-limiter.ts";
import { readCapsuleEvents } from "../event-stream.ts";
import {
  formatCoordinates,
  formatStatusBadge,
  formatSubagentAllocation,
} from "../sugiyama-dag/index.ts";
import { buildDynamicDagState, buildStepTraceEntries } from "./dag-builder.ts";
import { computeStepTracerSummary, renderAsciiTimeline } from "./timeline.ts";
import {
  formatDuration,
  formatSeq,
  type DynamicDagState,
  type DynamicTaskState,
  type LivingTracerOptions,
  type LivingTracerReport,
} from "./types.ts";
import type { HarnessEvent } from "../../core/contracts/index.ts";

/**
 * Renders the living dynamic DAG expansion with round-by-round branches and real-time execution states as connected ASCII.
 */
export function renderDynamicDagAscii(dynamicDag: DynamicDagState): string {
  if (dynamicDag.tasks.size === 0) {
    return "  ┌────────────────────────────────────────────────────────┐\n  │  (No dynamic DAG tasks discovered in telemetry events) │\n  └────────────────────────────────────────────────────────┘";
  }

  const lines: string[] = [];
  const visited = new Set<string>();

  function formatNode(task: DynamicTaskState): string {
    const stepText = task.activeStepIndex
      ? ` (step ${formatSeq(task.activeStepIndex)})`
      : ` (seq ${formatSeq(task.updatedAtSeq)})`;

    let agentText = "";
    if (task.assignedAgent && task.validatorId) {
      const roleUpper = (task.role ?? "implementer").toUpperCase();
      agentText = ` [● ${roleUpper}: ${task.assignedAgent} ──► VALIDATOR: ${task.validatorId}]`;
    } else if (task.assignedAgent) {
      agentText = ` [${task.assignedAgent}]`;
    } else if (task.validatorId) {
      agentText = ` [● VALIDATOR: ${task.validatorId}]`;
    }

    const coordText = task.coordinates ? ` ${formatCoordinates(task.coordinates)}` : "";

    return `[${task.id}] ${task.executionState}${coordText}${agentText}${stepText}`;
  }

  function renderNodeHierarchy(taskId: string, prefix: string, isLast: boolean): void {
    if (visited.has(taskId)) return;
    visited.add(taskId);

    const task = dynamicDag.tasks.get(taskId);
    if (!task) return;

    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    lines.push(`${prefix}${connector}${formatNode(task)}`);

    if (task.coordinates) {
      lines.push(`${childPrefix}↳ Coordinates: ${formatCoordinates(task.coordinates)}`);
    }
    if (task.probeRound !== undefined && task.probeRound > 0) {
      lines.push(`${childPrefix}↳ Probe Round: P${task.probeRound} (🔍 PROBING)`);
    }
    if (task.writeScope.length > 0) {
      lines.push(`${childPrefix}↳ Scope: ${task.writeScope.join(", ")}`);
    }
    if (task.rejectionReason) {
      lines.push(`${childPrefix}↳ Rejection: ${task.rejectionReason}`);
    }
    if (task.activeCommand && !task.executionState.includes(task.activeCommand)) {
      lines.push(`${childPrefix}↳ Active Cmd: ${task.activeCommand}`);
    }

    if (task.expandedSubtasks && task.expandedSubtasks.length > 0) {
      for (let i = 0; i < task.expandedSubtasks.length; i++) {
        const sub = task.expandedSubtasks[i];
        if (!sub) continue;
        const isLastSub = i === task.expandedSubtasks.length - 1;
        const sproutConnector = isLastSub ? "└──► " : "├──► ";
        const subStatus = formatStatusBadge(sub.status ?? "ready");
        const subRole = "role" in sub && typeof sub.role === "string" ? sub.role : undefined;
        const subImpl =
          "assignedAgent" in sub && subRole !== "validator" ? sub.assignedAgent : null;
        const subVal =
          "validatorId" in sub && typeof sub.validatorId === "string"
            ? sub.validatorId
            : "assignedAgent" in sub && subRole === "validator"
              ? sub.assignedAgent
              : null;
        const alloc = formatSubagentAllocation(subImpl, subVal, subRole ?? "IMPLEMENTER");
        const allocText = alloc ? ` ${alloc}` : "";
        lines.push(`${childPrefix}│`);
        lines.push(`${childPrefix}${sproutConnector}[${sub.id}] ${subStatus}${allocText}`);
      }
    }

    const sproutedChildren = (task.sproutedChildren ?? []).filter((id) => dynamicDag.tasks.has(id));
    for (let i = 0; i < sproutedChildren.length; i++) {
      const childId = sproutedChildren[i];
      if (!childId) continue;
      const isLastChild = i === sproutedChildren.length - 1;
      const childTask = dynamicDag.tasks.get(childId);
      if (!childTask) continue;
      visited.add(childId);

      const sproutConnector = isLastChild ? "└──► " : "├──► ";
      const sproutChildPrefix = childPrefix + (isLastChild ? "     " : "│    ");

      lines.push(`${childPrefix}│`);
      lines.push(`${childPrefix}${sproutConnector}${formatNode(childTask)}`);
      if (childTask.rejectionReason) {
        lines.push(`${sproutChildPrefix}↳ Rejection: ${childTask.rejectionReason}`);
      }
      if (childTask.activeCommand && !childTask.executionState.includes(childTask.activeCommand)) {
        lines.push(`${sproutChildPrefix}↳ Active Cmd: ${childTask.activeCommand}`);
      }
    }
  }

  const sproutedIds = new Set<string>();
  for (const t of dynamicDag.tasks.values()) {
    for (const c of t.sproutedChildren ?? []) {
      sproutedIds.add(c);
    }
  }

  const rootTasks = [...dynamicDag.tasks.values()].filter(
    (t) => !sproutedIds.has(t.id) && t.origin !== "repair_branch",
  );

  for (let i = 0; i < rootTasks.length; i++) {
    const root = rootTasks[i];
    if (!root || visited.has(root.id)) continue;
    const isLast = i === rootTasks.length - 1;
    renderNodeHierarchy(root.id, "", isLast);
    if (!isLast) {
      lines.push("");
    }
  }

  for (const t of dynamicDag.tasks.values()) {
    if (!visited.has(t.id)) {
      renderNodeHierarchy(t.id, "", true);
    }
  }

  return lines.join("\n");
}

/**
 * Builds the complete Living Tracer report.
 */
export function buildLivingTracerReport(
  events: readonly HarnessEvent[],
  options: LivingTracerOptions & { runId?: string | undefined; runRoot?: string | undefined } = {},
): LivingTracerReport {
  const runId = options.runId ?? "capsule-run";
  const dynamicDag = buildDynamicDagState(events, runId);
  const steps = buildStepTraceEntries(events, options);
  const summary = computeStepTracerSummary(steps, dynamicDag);
  const asciiTimeline = renderAsciiTimeline(steps, options.maxSteps);
  const asciiDag = renderDynamicDagAscii(dynamicDag);

  const mdSections: string[] = [
    `### Living Dynamic DAG Expansion & Real-Time Telemetry: ${runId}`,
    `- **Total Steps Trace**: ${summary.totalSteps} events across ${summary.uniqueActors.length} active agent(s)`,
    `- **Dynamic Graph Scope**: ${summary.taskCount} total tasks (${summary.dynamicExpansionCount} dynamic/repair expansions across ${summary.maxRoundReached} round(s))`,
    `- **Execution Duration**: ${formatDuration(summary.totalDurationMs)} | **Gates Passed/Failed**: ${summary.gatePassesCount}/${summary.gateFailsCount}`,
    "",
    "#### Living Dynamic Round-by-Round DAG & Node States",
    "```text",
    asciiDag,
    "```",
  ];

  if (dynamicDag.sproutedRepairPairs.length > 0) {
    mdSections.push("");
    mdSections.push("#### Dynamically Sprouted Repair & Validator Branches (Rejections)");
    const sproutHeaders = [
      "Rejected Task",
      "Round",
      "Sprouted Repair Task",
      "Sprouted Validator",
      "Rejection Reason",
    ];
    const sproutRows = dynamicDag.sproutedRepairPairs.map((p) => [
      `\`${p.rejectedTaskId}\``,
      `R${p.round}`,
      `\`${p.repairTaskId}\``,
      `\`${p.validatorTaskId}\``,
      p.reason ? `\`${p.reason}\`` : "—",
    ]);
    mdSections.push(...formatTable(sproutHeaders, sproutRows));
  }

  if (dynamicDag.activeAgents.size > 0) {
    mdSections.push("");
    mdSections.push("#### Active Agent Live Tool & Lease Registry");
    const agentHeaders = ["Agent", "Role", "Assigned Task", "Active Step", "Active Tool / Command"];
    const agentRows = [...dynamicDag.activeAgents.entries()].map(([agentId, state]) => [
      `\`${agentId}\``,
      `\`${state.role}\``,
      state.taskId ? `\`${state.taskId}\`` : "—",
      formatSeq(state.activeStepIndex),
      state.currentCommand
        ? `\`[🟢 RUNNING: ${state.currentCommand}]\``
        : state.currentTool
          ? `\`[🟢 TOOL: ${state.currentTool}]\``
          : "—",
    ]);
    mdSections.push(...formatTable(agentHeaders, agentRows));
  }

  mdSections.push("");
  mdSections.push("#### Chronological Step Execution Timeline");
  mdSections.push("```text");
  mdSections.push(asciiTimeline);
  mdSections.push("```");

  return {
    markdown: mdSections.join("\n"),
    asciiTimeline,
    asciiDag,
    dynamicDag,
    steps,
    summary,
  };
}

/**
 * Reads events directly from run capsule path and builds the living tracer report.
 */
export function traceCapsuleRun(
  runPath: string,
  options: LivingTracerOptions = {},
): LivingTracerReport {
  const eventsResult = readCapsuleEvents(runPath, { all: true });
  return buildLivingTracerReport(eventsResult.matchingEvents, {
    ...options,
    runId: eventsResult.runId,
    runRoot: eventsResult.runRoot,
  });
}
