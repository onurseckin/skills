/**
 * Living Dynamic DAG Expansion Engine & Real-Time Step Tracer Subsystem
 * Replays live telemetry to reconstruct dynamic subgraphs and renders chronological execution timelines.
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { HarnessEvent } from "../contracts/capsule.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { readCapsuleEvents, type CapsuleEventsResult } from "./event-stream.ts";
import { formatTable } from "../cli/formatters/line-limiter.ts";

export interface DynamicTaskState {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly role?: string | undefined;
  readonly dependencies: readonly string[];
  readonly writeScope: readonly string[];
  readonly assignedAgent?: string | null | undefined;
  readonly origin: "static" | "dynamic_expansion" | "branch" | "replan";
  readonly createdAtSeq: number;
  readonly updatedAtSeq: number;
  readonly branchId?: string | undefined;
}

export interface DynamicDagState {
  readonly runId: string;
  readonly revision: number;
  readonly totalTasks: number;
  readonly staticTasksCount: number;
  readonly dynamicTasksCount: number;
  readonly tasks: ReadonlyMap<string, DynamicTaskState>;
  readonly activeAgents: ReadonlyMap<string, { role: string; taskId: string | null; lastActiveSeq: number }>;
  readonly activeBranches: readonly string[];
}

export interface StepTraceEntry {
  readonly sequence: number;
  readonly timestamp: string;
  readonly elapsedMs: number;
  readonly actor: string;
  readonly kind: string;
  readonly taskId: string | null;
  readonly role: string | null;
  readonly tool: string | null;
  readonly glyph: string;
  readonly title: string;
  readonly details: readonly string[];
  readonly isError: boolean;
  readonly isGate: boolean;
}

export interface StepTracerSummary {
  readonly totalSteps: number;
  readonly totalDurationMs: number;
  readonly uniqueActors: readonly string[];
  readonly taskCount: number;
  readonly dynamicExpansionCount: number;
  readonly gateRunsCount: number;
  readonly gatePassesCount: number;
  readonly gateFailsCount: number;
  readonly errorCount: number;
}

export interface LivingTracerOptions {
  readonly fromSeq?: number | undefined;
  readonly toSeq?: number | undefined;
  readonly maxSteps?: number | undefined;
  readonly filterTask?: string | undefined;
  readonly filterActor?: string | undefined;
  readonly filterKind?: string | undefined;
  readonly detailed?: boolean | undefined;
  readonly all?: boolean | undefined;
}

export interface LivingTracerReport {
  readonly markdown: string;
  readonly asciiTimeline: string;
  readonly dynamicDag: DynamicDagState;
  readonly steps: readonly StepTraceEntry[];
  readonly summary: StepTracerSummary;
}

function parsePayloadString(payload: Record<string, unknown> | undefined, keys: readonly string[]): string | null {
  if (!payload || typeof payload !== "object") return null;
  for (const k of keys) {
    if (typeof payload[k] === "string" && (payload[k] as string).trim().length > 0) {
      return (payload[k] as string).trim();
    }
  }
  return null;
}

function parsePayloadStringArray(payload: Record<string, unknown> | undefined, key: string): readonly string[] {
  if (!payload || typeof payload !== "object") return [];
  const val = payload[key];
  if (Array.isArray(val) && val.every((item) => typeof item === "string")) {
    return val as readonly string[];
  }
  return [];
}

/**
 * Builds dynamic DAG expansion state by replaying capsule events.
 */
export function buildDynamicDagState(events: readonly HarnessEvent[], runId = "capsule-run"): DynamicDagState {
  const taskMap = new Map<string, DynamicTaskState>();
  const agentMap = new Map<string, { role: string; taskId: string | null; lastActiveSeq: number }>();
  const branches = new Set<string>();
  let revision = 1;

  for (const ev of events) {
    const payload = typeof ev.payload === "object" && ev.payload !== null ? (ev.payload as Record<string, unknown>) : {};
    const actor = ev.actor;
    const kind = ev.kind.toLowerCase();
    const seq = ev.sequence;

    if (typeof ev.revision === "number" && ev.revision > revision) {
      revision = ev.revision;
    }

    const taskId = parsePayloadString(payload, ["task_id", "taskId", "task"]);
    const role = parsePayloadString(payload, ["role", "assigned_role", "assignedRole"]);

    if (actor && actor !== "system" && actor !== "operator") {
      const existingAgent = agentMap.get(actor);
      agentMap.set(actor, {
        role: role ?? existingAgent?.role ?? "worker",
        taskId: taskId ?? existingAgent?.taskId ?? null,
        lastActiveSeq: seq,
      });
    }

    if (kind === "branch-opened" || kind === "branch:open") {
      const bId = parsePayloadString(payload, ["branch_id", "branchId", "branch"]);
      if (bId) branches.add(bId);
    } else if (kind === "branch-collected" || kind === "branch:collect" || kind === "branch-abandoned") {
      const bId = parsePayloadString(payload, ["branch_id", "branchId", "branch"]);
      if (bId) branches.delete(bId);
    }

    // Dynamic task creations or additions
    if (kind === "task-created" || kind === "task:add" || kind === "task-added" || kind === "smart-task:plan") {
      const id = taskId ?? parsePayloadString(payload, ["id"]);
      if (id) {
        const label = parsePayloadString(payload, ["label", "title"]) ?? id;
        const deps = parsePayloadStringArray(payload, "dependencies").concat(parsePayloadStringArray(payload, "deps"));
        const writeScope = parsePayloadStringArray(payload, "write_scope").concat(parsePayloadStringArray(payload, "writeScope"));
        const branchId = parsePayloadString(payload, ["branch_id", "branchId"]);

        taskMap.set(id, {
          id,
          label,
          status: "ready",
          role: role ?? undefined,
          dependencies: [...new Set(deps)],
          writeScope: [...new Set(writeScope)],
          assignedAgent: null,
          origin: branchId ? "branch" : "dynamic_expansion",
          createdAtSeq: seq,
          updatedAtSeq: seq,
          branchId: branchId ?? undefined,
        });
      }
    }

    if (taskId && taskMap.has(taskId)) {
      const existing = taskMap.get(taskId)!;
      let nextStatus = existing.status;
      let nextAgent = existing.assignedAgent;

      if (kind === "task-claimed" || kind === "task:claim") {
        nextStatus = "leased";
        nextAgent = actor;
      } else if (kind === "task-submitted" || kind === "task:submit") {
        nextStatus = "validating";
      } else if (kind === "task-reviewed" || kind === "task:review" || kind === "verdict-passed") {
        nextStatus = "satisfied";
      } else if (kind === "task-rejected" || kind === "task:reject") {
        nextStatus = "changes_requested";
      } else if (kind === "task-released" || kind === "task:release") {
        nextStatus = "ready";
        nextAgent = null;
      }

      taskMap.set(taskId, {
        ...existing,
        status: nextStatus,
        assignedAgent: nextAgent,
        updatedAtSeq: seq,
      });
    } else if (taskId && !taskMap.has(taskId)) {
      // Inferred static/base task encountered in event stream
      const label = parsePayloadString(payload, ["label", "title"]) ?? taskId;
      taskMap.set(taskId, {
        id: taskId,
        label,
        status: kind === "task-claimed" ? "leased" : "ready",
        role: role ?? undefined,
        dependencies: [],
        writeScope: [],
        assignedAgent: kind === "task-claimed" ? actor : null,
        origin: "static",
        createdAtSeq: seq,
        updatedAtSeq: seq,
      });
    }
  }

  let staticCount = 0;
  let dynamicCount = 0;
  for (const t of taskMap.values()) {
    if (t.origin === "static") staticCount += 1;
    else dynamicCount += 1;
  }

  return {
    runId,
    revision,
    totalTasks: taskMap.size,
    staticTasksCount: staticCount,
    dynamicTasksCount: dynamicCount,
    tasks: taskMap,
    activeAgents: agentMap,
    activeBranches: [...branches],
  };
}

/**
 * Parses events into structured chronological step traces.
 */
export function buildStepTraceEntries(
  events: readonly HarnessEvent[],
  options: LivingTracerOptions = {},
): StepTraceEntry[] {
  if (events.length === 0) return [];

  const startIso = events[0]?.timestamp;
  const startTime = startIso ? new Date(startIso).getTime() : 0;

  const entries: StepTraceEntry[] = [];

  for (const ev of events) {
    const seq = ev.sequence;
    if (options.fromSeq !== undefined && seq < options.fromSeq) continue;
    if (options.toSeq !== undefined && seq > options.toSeq) continue;

    const payload = typeof ev.payload === "object" && ev.payload !== null ? (ev.payload as Record<string, unknown>) : {};
    const actor = ev.actor;
    const kind = ev.kind;

    const taskId = parsePayloadString(payload, ["task_id", "taskId", "task"]);
    const role = parsePayloadString(payload, ["role", "assigned_role", "assignedRole"]);
    const tool = parsePayloadString(payload, ["tool", "current_tool", "tool_name", "toolName"]);
    const cmd = parsePayloadString(payload, ["command", "cmd", "command_line"]);
    const exitCode = typeof payload.exit_code === "number" ? payload.exit_code : typeof payload.code === "number" ? payload.code : null;
    const errorMsg = parsePayloadString(payload, ["error", "message", "reason", "stderr"]);

    if (options.filterTask && taskId !== options.filterTask) continue;
    if (options.filterActor && actor.toLowerCase() !== options.filterActor.toLowerCase()) continue;
    if (options.filterKind && kind.toLowerCase() !== options.filterKind.toLowerCase()) continue;

    const currentIso = ev.timestamp;
    const currentMs = currentIso ? new Date(currentIso).getTime() : startTime;
    const elapsedMs = Math.max(0, currentMs - startTime);

    let glyph = "●";
    let isError = false;
    let isGate = false;
    const details: string[] = [];

    const lowerKind = kind.toLowerCase();

    if (lowerKind.includes("claim")) {
      glyph = "🟢";
      if (role) details.push(`Role: ${role}`);
      if (typeof payload.lease_seconds === "number") details.push(`Lease: ${payload.lease_seconds}s`);
    } else if (lowerKind.includes("submit")) {
      glyph = "📦";
      if (typeof payload.summary === "string") details.push(`Summary: ${payload.summary}`);
    } else if (lowerKind.includes("gate") || lowerKind.includes("prove")) {
      isGate = true;
      if (exitCode === 0) {
        glyph = "🛡️✓";
      } else {
        glyph = "🛡️❌";
        isError = true;
      }
      if (cmd) details.push(`Gate Cmd: ${cmd}`);
      if (exitCode !== null) details.push(`Exit Code: ${exitCode}`);
    } else if (lowerKind.includes("review") || lowerKind.includes("verdict") || lowerKind.includes("pass")) {
      glyph = "✓";
      if (typeof payload.verdict === "string") details.push(`Verdict: ${payload.verdict}`);
    } else if (lowerKind.includes("reject") || lowerKind.includes("fail") || lowerKind.includes("error")) {
      glyph = "❌";
      isError = true;
      if (errorMsg) details.push(`Reason: ${errorMsg}`);
    } else if (lowerKind.includes("branch")) {
      glyph = "🌿";
      const bId = parsePayloadString(payload, ["branch_id", "branchId"]);
      if (bId) details.push(`Branch: ${bId}`);
    } else if (lowerKind.includes("exec") || lowerKind.includes("tool") || cmd) {
      glyph = "⚙️";
      if (tool) details.push(`Tool: ${tool}`);
      if (cmd) details.push(`Cmd: ${cmd}`);
      if (exitCode !== null) details.push(`Exit: ${exitCode}`);
    } else {
      glyph = "●";
    }

    if (errorMsg && !details.some((d) => d.includes(errorMsg))) {
      details.push(`Message: ${errorMsg}`);
    }

    const taskSuffix = taskId ? ` (${taskId})` : "";
    const title = `${kind.toUpperCase()}${taskSuffix}`;

    entries.push({
      sequence: seq,
      timestamp: currentIso,
      elapsedMs,
      actor,
      kind,
      taskId,
      role,
      tool,
      glyph,
      title,
      details,
      isError,
      isGate,
    });
  }

  return entries;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const milli = Math.floor((ms % 1000) / 10);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(min)}:${pad(sec)}.${pad(milli)}`;
}

/**
 * Renders the chronological step trace as a connected ASCII/Unicode vertical timeline.
 */
export function renderAsciiTimeline(entries: readonly StepTraceEntry[], maxEntries?: number): string {
  if (entries.length === 0) {
    return "  ┌────────────────────────────────────────────────────────┐\n  │  (No telemetry events recorded for active step trace)  │\n  └────────────────────────────────────────────────────────┘";
  }

  const lines: string[] = [];
  const displayEntries = maxEntries !== undefined && maxEntries > 0 ? entries.slice(0, maxEntries) : entries;

  for (let i = 0; i < displayEntries.length; i++) {
    const entry = displayEntries[i]!;
    const isLast = i === displayEntries.length - 1;
    const timeStr = formatDuration(entry.elapsedMs);
    const seqStr = `#${entry.sequence.toString().padStart(3, "0")}`;

    const connector = i === 0 ? "●" : isLast ? "└─●" : "├─●";
    const pipe = isLast ? "  " : "│ ";

    lines.push(`${connector} [${seqStr} +${timeStr}] [${entry.actor}] ${entry.glyph} ${entry.title}`);

    for (const d of entry.details) {
      lines.push(`${pipe} ↳ ${d}`);
    }

    if (!isLast) {
      lines.push("│");
    }
  }

  if (displayEntries.length < entries.length) {
    lines.push(`... [${entries.length - displayEntries.length} more events truncated]`);
  }

  return lines.join("\n");
}

/**
 * Computes summary statistics across step trace entries.
 */
export function computeStepTracerSummary(
  entries: readonly StepTraceEntry[],
  dynamicDag: DynamicDagState,
): StepTracerSummary {
  const uniqueActors = [...new Set(entries.map((e) => e.actor))];
  const gateRuns = entries.filter((e) => e.isGate);
  const gateFails = gateRuns.filter((e) => e.isError);
  const gatePasses = gateRuns.filter((e) => !e.isError);
  const errors = entries.filter((e) => e.isError);
  const totalDurationMs = entries.length > 0 ? (entries[entries.length - 1]?.elapsedMs ?? 0) : 0;

  return {
    totalSteps: entries.length,
    totalDurationMs,
    uniqueActors,
    taskCount: dynamicDag.totalTasks,
    dynamicExpansionCount: dynamicDag.dynamicTasksCount,
    gateRunsCount: gateRuns.length,
    gatePassesCount: gatePasses.length,
    gateFailsCount: gateFails.length,
    errorCount: errors.length,
  };
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

  const mdSections: string[] = [
    `### Real-Time Telemetry & Dynamic Step Tracer: ${runId}`,
    `- **Total Steps Trace**: ${summary.totalSteps} events across ${summary.uniqueActors.length} active agent(s)`,
    `- **Dynamic Graph Scope**: ${summary.taskCount} total tasks (${summary.dynamicExpansionCount} dynamically spawned)`,
    `- **Execution Duration**: ${formatDuration(summary.totalDurationMs)} | **Gates Passed/Failed**: ${summary.gatePassesCount}/${summary.gateFailsCount}`,
    "",
    "#### Chronological Step Execution Timeline",
    "```text",
    asciiTimeline,
    "```",
  ];

  if (dynamicDag.dynamicTasksCount > 0) {
    mdSections.push("");
    mdSections.push("#### Dynamically Spawned Subgraphs & Branches");
    const dynHeaders = ["Task ID", "Origin", "Branch", "Status", "Created At Seq"];
    const dynRows = [...dynamicDag.tasks.values()]
      .filter((t) => t.origin !== "static")
      .map((t) => [
        `\`${t.id}\``,
        t.origin,
        t.branchId ? `\`${t.branchId}\`` : "—",
        `\`${t.status}\``,
        `#${t.createdAtSeq}`,
      ]);
    mdSections.push(...formatTable(dynHeaders, dynRows));
  }

  return {
    markdown: mdSections.join("\n"),
    asciiTimeline,
    dynamicDag,
    steps,
    summary,
  };
}

/**
 * Reads events directly from run capsule path and builds report.
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
