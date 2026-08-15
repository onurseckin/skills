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
  tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
}

function determinePhaseAndSummary(event: HarnessEvent, promptBytes = 0): EventDetails {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const taskId = typeof p.task_id === "string" ? p.task_id : undefined;
  const gateId = typeof p.gate_id === "string" ? p.gate_id : undefined;
  const commandId = typeof p.command_id === "string" ? p.command_id : undefined;
  const round = typeof p.round === "number" ? p.round : undefined;
  const tokens =
    typeof p.tokens === "number"
      ? p.tokens
      : typeof p.total_tokens === "number"
        ? p.total_tokens
        : typeof p.totalTokens === "number"
          ? p.totalTokens
          : undefined;
  const costUsd =
    typeof p.cost_usd === "number"
      ? p.cost_usd
      : typeof p.costUsd === "number"
        ? p.costUsd
        : undefined;
  const durationMs =
    typeof p.duration_ms === "number"
      ? p.duration_ms
      : typeof p.durationMs === "number"
        ? p.durationMs
        : undefined;

  const result: EventDetails = {
    phase: "general",
    summary: `Event ${event.kind}`,
    ...(tokens !== undefined ? { tokens } : {}),
    ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
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
    case "task-leased":
      result.phase = "execution";
      result.summary = `Task ${taskId ?? "unknown"} claimed by ${event.actor} (role: ${String(p.role ?? "implementer")})`;
      if (taskId) result.task_id = taskId;
      break;
    case "task-heartbeat":
      result.phase = "execution";
      result.summary = `Heartbeat acknowledged for task ${taskId ?? "unknown"}`;
      if (taskId) result.task_id = taskId;
      break;
    case "lease-renewed":
      result.phase = "execution";
      result.summary = `Lease renewed for task ${taskId ?? "unknown"} by ${event.actor}`;
      if (taskId) result.task_id = taskId;
      break;
    case "lease-revoked":
      result.phase = "execution";
      result.summary = `Lease revoked for task ${taskId ?? "unknown"}`;
      if (taskId) result.task_id = taskId;
      break;
    case "task-submitted":
      result.phase = "execution";
      result.summary = `Task ${taskId ?? "unknown"} submitted by ${event.actor}`;
      if (taskId) result.task_id = taskId;
      break;
    case "task-escalated":
      result.phase = "execution";
      result.summary = `Task ${taskId ?? "unknown"} escalated by ${event.actor}: ${String(p.reason ?? "escalation")}`;
      if (taskId) result.task_id = taskId;
      break;
    case "task-cancelled":
      result.phase = "execution";
      result.summary = `Task ${taskId ?? "unknown"} cancelled`;
      if (taskId) result.task_id = taskId;
      break;
    case "task-validation-started":
    case "gate-started":
      result.phase = "validation";
      result.summary = `Validation started for task ${taskId ?? gateId ?? "unknown"} by ${event.actor}`;
      if (taskId) result.task_id = taskId;
      if (gateId) result.gate_id = gateId;
      break;
    case "gate-completed": {
      const isPass = p.verdict === "pass" || p.status === "pass";
      result.phase = "validation";
      result.summary = `Gate verification for task ${taskId ?? gateId ?? "unknown"} ${isPass ? "passed" : "rejected"}`;
      if (taskId) result.task_id = taskId;
      if (gateId) result.gate_id = gateId;
      break;
    }
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
    if (details.tokens !== undefined) record.tokens = details.tokens;
    if (details.cost_usd !== undefined) record.cost_usd = details.cost_usd;
    if (details.duration_ms !== undefined) record.duration_ms = details.duration_ms;
    return record;
  });
}
