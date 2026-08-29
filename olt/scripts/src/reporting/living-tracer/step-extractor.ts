/**
 * Living Tracer Chronological Step Trace Extractor
 */
import type { HarnessEvent } from "../../core/contracts/index.ts";
import {
  parsePayloadNumber,
  parsePayloadString,
  type LivingTracerOptions,
  type StepTraceEntry,
} from "./types.ts";

/**
 * Parses events into structured chronological step traces with precise execution glyphs.
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

    const payload =
      typeof ev.payload === "object" && ev.payload !== null
        ? (ev.payload as Record<string, unknown>)
        : {};
    const actor = ev.actor;
    const kind = ev.kind;

    const taskId = parsePayloadString(payload, ["task_id", "taskId", "task", "id"]);
    const role = parsePayloadString(payload, [
      "role",
      "assigned_role",
      "assignedRole",
      "repair_assignee",
    ]);
    const tool = parsePayloadString(payload, [
      "tool",
      "current_tool",
      "tool_name",
      "toolName",
      "tool_call",
    ]);
    const cmd = parsePayloadString(payload, ["command", "cmd", "command_line", "commandLine"]);
    const exitCode = parsePayloadNumber(payload, ["exit_code", "code", "exitCode"]);
    const errorMsg = parsePayloadString(payload, [
      "error",
      "message",
      "reason",
      "stderr",
      "feedback",
    ]);
    const round = parsePayloadNumber(payload, ["round", "repair_round"]);

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
      if (typeof payload.lease_seconds === "number")
        details.push(`Lease: ${payload.lease_seconds}s`);
      if (round !== null) details.push(`Round: R${round}`);
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
    } else if (
      lowerKind.includes("review") ||
      lowerKind.includes("verdict") ||
      lowerKind.includes("pass")
    ) {
      const verdictStr = parsePayloadString(payload, ["verdict", "decision"]);
      if (verdictStr === "reject" || verdictStr === "rejected" || lowerKind.includes("reject")) {
        glyph = "❌";
        isError = true;
        if (errorMsg) details.push(`Reason: ${errorMsg}`);
        if (round !== null) details.push(`Round: R${round}`);
      } else {
        glyph = "✓";
        if (verdictStr) details.push(`Verdict: ${verdictStr}`);
        if (round !== null) details.push(`Round: R${round}`);
      }
    } else if (
      lowerKind.includes("reject") ||
      lowerKind.includes("fail") ||
      lowerKind.includes("error")
    ) {
      glyph = "❌";
      isError = true;
      if (errorMsg) details.push(`Reason: ${errorMsg}`);
      if (round !== null) details.push(`Round: R${round}`);
    } else if (lowerKind.includes("branch")) {
      glyph = "🌿";
      const bId = parsePayloadString(payload, ["branch_id", "branchId"]);
      if (bId) details.push(`Branch: ${bId}`);
    } else if (lowerKind.includes("replacement") || lowerKind.includes("assign-repairer")) {
      glyph = "🔧";
      const replacementId = parsePayloadString(payload, ["replacement_id", "replacementId"]);
      if (replacementId) details.push(`Replacement Repairer: ${replacementId}`);
      if (errorMsg) details.push(`Reason: ${errorMsg}`);
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
