import type { HarnessEvent } from "../contracts/capsule.ts";
import type { TimelineEventRecord } from "./types.ts";

interface EventDetails {
  phase: string;
  summary: string;
  payload_ref?: string;
  task_id?: string;
  gate_id?: string;
  command_id?: string;
  round?: number;
}

function determinePhaseAndSummary(event: HarnessEvent, promptBytes = 0): EventDetails {
  const p = event.payload ?? {};
  const taskId = typeof p.task_id === "string" ? p.task_id : undefined;
  const gateId = typeof p.gate_id === "string" ? p.gate_id : undefined;
  const commandId = typeof p.command_id === "string" ? p.command_id : undefined;
  const round = typeof p.round === "number" ? p.round : undefined;
  const result: EventDetails = {
    phase: "general",
    summary: `Event ${event.kind}`,
  };

  switch (event.kind) {
    case "plan-init":
    case "capsule-initialized":
      result.phase = "planning";
      result.summary = `Capsule initialized with verbatim prompt (${promptBytes.toLocaleString()} bytes)`;
      result.payload_ref = "prompt.md";
      break;
    case "plan-task-added":
      result.phase = "planning";
      result.summary = `Task ${taskId ?? String(p.id ?? "")} added: ${String(p.label ?? p.goal ?? "staged task")}`;
      if (taskId ?? p.id) result.task_id = taskId ?? String(p.id);
      break;
    case "plan-compiled":
      result.phase = "planning";
      result.summary = `Plan compiled with revision ${event.revision ?? 1}`;
      break;
    case "task-claimed":
      result.phase = "execution";
      result.summary = `Task ${taskId ?? "unknown"} claimed by ${event.actor} (role: ${String(p.role ?? "implementer")})`;
      if (taskId) result.task_id = taskId;
      break;
    case "task-heartbeat":
      result.phase = "execution";
      result.summary = `Heartbeat acknowledged for task ${taskId ?? "unknown"}`;
      if (taskId) result.task_id = taskId;
      break;
    case "task-submitted":
      result.phase = "execution";
      result.summary = `Task ${taskId ?? "unknown"} submitted by ${event.actor}`;
      if (taskId) result.task_id = taskId;
      break;
    case "task-validation-started":
      result.phase = "validation";
      result.summary = `Validation started for task ${taskId ?? "unknown"} by ${event.actor}`;
      if (taskId) result.task_id = taskId;
      break;
    case "review-recorded": {
      const isPass = p.verdict === "pass" || p.status === "pass";
      const findings = Array.isArray(p.findings) ? p.findings.length : 0;
      result.phase = isPass ? "validation" : "repair";
      result.summary = isPass
        ? `Task ${taskId ?? "unknown"} passed validation review`
        : `Task ${taskId ?? "unknown"} review requested changes (${findings} findings)`;
      if (taskId) result.task_id = taskId;
      if (round !== undefined) result.round = round;
      break;
    }
    case "task-finished":
      result.phase = "validation";
      result.summary = `Task ${taskId ?? "unknown"} finished and marked done`;
      if (taskId) result.task_id = taskId;
      break;
    case "command-recorded": {
      const exitCode = typeof p.exit_code === "number" ? p.exit_code : 0;
      const argv = Array.isArray(p.argv) ? p.argv.join(" ") : String(p.command ?? "cmd");
      result.phase = taskId ? "execution" : "system";
      result.summary = `Command executed: ${argv} (exit ${exitCode})`;
      if (taskId) result.task_id = taskId;
      if (gateId) result.gate_id = gateId;
      if (commandId ?? p.id) result.command_id = commandId ?? String(p.id);
      break;
    }
    case "critic-started":
      result.phase = "review";
      result.summary = `Completeness critic review started by ${event.actor}`;
      break;
    case "critic-reviewed":
      result.phase = "review";
      result.summary = `Completeness critic review completed (${String(p.verdict ?? "reviewed")})`;
      break;
    case "run-completed":
      result.phase = "completion";
      result.summary = `Run completed successfully by ${event.actor}`;
      break;
    case "tasks-unblocked":
      result.phase = "execution";
      result.summary = "Downstream tasks unblocked and marked ready";
      break;
    default:
      result.summary = `Event ${event.kind} recorded by ${event.actor}`;
      if (taskId) result.task_id = taskId;
      if (gateId) result.gate_id = gateId;
      if (commandId) result.command_id = commandId;
      if (round !== undefined) result.round = round;
      break;
  }
  return result;
}

export function collectTimeline(
  events: readonly HarnessEvent[],
  promptBytes = 0,
): TimelineEventRecord[] {
  return events.map((event, idx) => {
    const details = determinePhaseAndSummary(event, promptBytes);
    const record: TimelineEventRecord = {
      sequence: event.sequence ?? idx + 1,
      timestamp: event.timestamp ?? new Date().toISOString(),
      actor: event.actor ?? "system",
      event: event.kind ?? "unknown",
      phase: details.phase,
      summary: details.summary,
    };
    if (details.payload_ref) record.payload_ref = details.payload_ref;
    if (details.task_id) record.task_id = details.task_id;
    if (details.gate_id) record.gate_id = details.gate_id;
    if (details.command_id) record.command_id = details.command_id;
    if (details.round !== undefined) record.round = details.round;
    return record;
  });
}
