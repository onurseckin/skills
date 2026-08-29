import type { HarnessEvent } from "../../core/contracts/index.ts";
import type { JsonValue } from "../../core/contracts/index.ts";
import type {
  ActionKind,
  ActionOutcome,
  ActionStepRecord,
  ActionTarget,
} from "../graph/graph-types.ts";
import { narrateUnclassifiedEvent } from "./step-event-summaries.ts";
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
  pushback_reason?: string;
  findings?: JsonValue;
  severity?: string;
  validator_id?: string;
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
  const pushbackReason =
    typeof p.pushback_reason === "string"
      ? p.pushback_reason
      : typeof p.pushbackReason === "string"
        ? p.pushbackReason
        : typeof p.reason === "string"
          ? p.reason
          : undefined;
  const validatorId =
    typeof p.validator_id === "string"
      ? p.validator_id
      : typeof p.validatorId === "string"
        ? p.validatorId
        : typeof p.critic_id === "string"
          ? p.critic_id
          : typeof p.criticId === "string"
            ? p.criticId
            : undefined;
  const severity = typeof p.severity === "string" ? p.severity : undefined;
  const findingsVal = p.findings !== undefined ? (p.findings as JsonValue) : undefined;

  const result: EventDetails = {
    phase: "general",
    summary: `Event ${event.kind}`,
    ...(tokens !== undefined ? { tokens } : {}),
    ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
    ...(pushbackReason !== undefined ? { pushback_reason: pushbackReason } : {}),
    ...(findingsVal !== undefined ? { findings: findingsVal } : {}),
    ...(severity !== undefined ? { severity } : {}),
    ...(validatorId !== undefined ? { validator_id: validatorId } : {}),
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
      result.summary = `Task ${taskId ?? String(p.id ?? "")} added: ${String(p.label ?? p.goal ?? "an unrecorded label")}`;
      if (taskId ?? p.id) result.task_id = taskId ?? String(p.id);
      break;
    case "plan-compiled":
      result.phase = "planning";
      result.summary = `Plan compiled with revision ${event.revision ?? "unknown"}`;
      break;
    case "task-claimed":
    case "task-leased":
      result.phase = "execution";
      result.summary = `Task ${taskId ?? "unknown"} claimed by ${event.actor} (role: ${String(p.role ?? "unknown")})`;
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
    case "task-escalated-by-supervisor":
      result.phase = "execution";
      result.summary = `Task ${taskId ?? "unknown"} escalated by ${event.actor}: ${String(p.reason ?? "no reason recorded")}`;
      if (taskId) result.task_id = taskId;
      break;
    case "task-cancelled":
      result.phase = "execution";
      result.summary = `Task ${taskId ?? "unknown"} cancelled`;
      if (taskId) result.task_id = taskId;
      break;
    case "validation-started":
    case "gate-started":
      result.phase = "validation";
      result.summary = `Validation started for task ${taskId ?? gateId ?? "unknown"} by ${event.actor}`;
      if (taskId) result.task_id = taskId;
      if (gateId) result.gate_id = gateId;
      if (!result.validator_id && event.actor) result.validator_id = event.actor;
      break;
    case "gate-completed": {
      const isPass = p.verdict === "pass" || p.status === "pass";
      result.phase = "validation";
      result.summary = `Gate verification for task ${taskId ?? gateId ?? "unknown"} ${isPass ? "passed" : "rejected"}`;
      if (taskId) result.task_id = taskId;
      if (gateId) result.gate_id = gateId;
      if (!result.validator_id && event.actor) result.validator_id = event.actor;
      break;
    }
    case "review-recorded": {
      const verdict = p.verdict === "pass" || p.verdict === "reject" ? p.verdict : null;
      const findingCount =
        typeof p.finding_count === "number"
          ? p.finding_count
          : Array.isArray(p.findings)
            ? p.findings.length
            : typeof p.findings === "number"
              ? p.findings
              : null;
      const counted = findingCount === null ? "" : ` (${findingCount} findings)`;
      result.phase =
        verdict === "reject" ? "repair" : verdict === "pass" ? "validation" : "general";
      result.summary =
        verdict === "pass"
          ? `Task ${taskId ?? "unknown"} passed validation review`
          : verdict === "reject"
            ? `Task ${taskId ?? "unknown"} review requested changes${counted}`
            : `Task ${taskId ?? "unknown"} review recorded; the event states no verdict`;
      if (taskId) result.task_id = taskId;
      if (round !== undefined) result.round = round;
      if (!result.validator_id && event.actor) result.validator_id = event.actor;
      break;
    }
    case "task-finished":
      result.phase = "validation";
      result.summary = `Task ${taskId ?? "unknown"} finished and marked done`;
      if (taskId) result.task_id = taskId;
      break;
    case "command-recorded": {
      const exitCode = typeof p.exit_code === "number" ? ` (exit ${p.exit_code})` : "";
      const argv = Array.isArray(p.argv)
        ? p.argv.join(" ")
        : typeof p.command === "string"
          ? p.command
          : null;
      result.phase = taskId ? "execution" : "system";
      result.summary =
        argv === null ? `Command recorded${exitCode}` : `Command executed: ${argv}${exitCode}`;
      if (taskId) result.task_id = taskId;
      if (gateId) result.gate_id = gateId;
      if (commandId ?? p.id) result.command_id = commandId ?? String(p.id);
      break;
    }
    case "command-intent-recorded":
      result.phase = taskId ? "execution" : "system";
      result.summary = `Command ${commandId ?? "unknown"} started`;
      if (taskId) result.task_id = taskId;
      if (gateId) result.gate_id = gateId;
      if (commandId) result.command_id = commandId;
      break;
    case "command-reconciled": {
      const status = typeof p.status === "string" ? p.status : undefined;
      result.phase = taskId ? "execution" : "system";
      result.summary =
        status === undefined
          ? `Command ${commandId ?? "unknown"} reconciled`
          : `Command ${commandId ?? "unknown"} finished (${status})`;
      if (taskId) result.task_id = taskId;
      if (gateId) result.gate_id = gateId;
      if (commandId) result.command_id = commandId;
      break;
    }
    case "critic-started":
      result.phase = "review";
      result.summary = `Completeness critic review started by ${event.actor}`;
      if (!result.validator_id && event.actor) result.validator_id = event.actor;
      break;
    case "critic-reviewed":
      result.phase = "review";
      result.summary = `Completeness critic review completed (${String(p.verdict ?? "no verdict recorded")})`;
      if (!result.validator_id && event.actor) result.validator_id = event.actor;
      break;
    case "run-completed":
      result.phase = "completion";
      result.summary = `Run completed successfully by ${event.actor}`;
      break;
    case "tasks-unblocked":
      result.phase = "execution";
      result.summary = "Downstream tasks unblocked and marked ready";
      break;
    default: {
      const narrated = narrateUnclassifiedEvent(event);
      if (narrated) {
        result.phase = narrated.phase;
        result.summary = narrated.summary;
      } else {
        result.summary = `Event ${event.kind} recorded by ${event.actor}`;
      }
      if (taskId) result.task_id = taskId;
      if (gateId) result.gate_id = gateId;
      if (commandId) result.command_id = commandId;
      if (round !== undefined) result.round = round;
      break;
    }
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
      actor: event.actor ?? "unknown",
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
    if (details.pushback_reason !== undefined) record.pushback_reason = details.pushback_reason;
    if (details.findings !== undefined) record.findings = details.findings;
    if (details.severity !== undefined) record.severity = details.severity;
    if (details.validator_id !== undefined) record.validator_id = details.validator_id;
    return record;
  });
}

function classifyActionKind(kind: string): ActionKind {
  switch (kind) {
    case "command-recorded":
    case "command-intent-recorded":
    case "command-reconciled":
      return "command";
    case "agent-registered":
    case "agent-released":
    case "agent-reported":
      return "agent";
    case "task-claimed":
    case "task-leased":
    case "task-heartbeat":
    case "lease-heartbeat":
    case "lease-renewed":
    case "lease-revoked":
    case "lease-released":
    case "stale-recovery":
      return "lease";
    case "packet-prepared":
    case "packet-published":
      return "packet";
    case "review-recorded":
    case "critic-started":
    case "critic-reviewed":
    case "critic-assigned":
    case "completion-reviewed":
    case "completion-remediated":
    case "requirement-authority-decided":
      return "review";
    case "probe-recorded":
      return "probe";
    case "branch-opened":
    case "branch-collected":
    case "branch-abandoned":
    case "branch-claimed":
    case "branch-submitted":
      return "branch";
    case "gate-started":
    case "gate-completed":
    case "gate-attached":
    case "validation-started":
      return "gate";
    case "plan-init":
    case "plan-task-added":
    case "plan-compiled":
    case "plan-enhanced":
    case "plan-recompiled":
    case "topology-recorded":
    case "plan-audited":
    case "plan-audit-accepted":
      return "plan";
    case "task-submitted":
    case "task-escalated-by-supervisor":
    case "task-cancelled":
    case "task-finished":
    case "tasks-unblocked":
    case "replacement-repairer-assigned":
    case "orphan-evidence-dispositioned":
      return "task";
    case "capsule-initialized":
    case "run-completed":
      return "run";
    default:
      return "run";
  }
}

function deriveTarget(event: HarnessEvent): ActionTarget {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const field = (key: string): string | undefined =>
    typeof p[key] === "string" ? (p[key] as string) : undefined;
  const target: ActionTarget = {
    ...(field("task_id") !== undefined ? { taskId: field("task_id") } : {}),
    ...(field("gate_id") !== undefined ? { gateId: field("gate_id") } : {}),
    ...(field("branch_id") !== undefined ? { branchId: field("branch_id") } : {}),
    ...(field("sub_task_id") !== undefined ? { subTaskId: field("sub_task_id") } : {}),
    ...(field("agent_id") !== undefined ? { agentId: field("agent_id") } : {}),
    ...(field("command_id") !== undefined ? { commandId: field("command_id") } : {}),
    ...(field("packet_id") !== undefined ? { packetId: field("packet_id") } : {}),
    ...(field("requirement_id") !== undefined ? { requirementId: field("requirement_id") } : {}),
    ...(field("path") !== undefined ? { path: field("path") } : {}),
  };
  const nodeId = resolveActionNodeId(target);
  return nodeId !== undefined ? { ...target, nodeId } : target;
}

function resolveActionNodeId(target: ActionTarget): string | undefined {
  if (target.branchId !== undefined && target.subTaskId !== undefined) {
    return `node-branch-${target.branchId}-${target.subTaskId}`;
  }
  if (target.taskId !== undefined) {
    return target.gateId !== undefined
      ? `node-gate-${target.taskId}`
      : `node-task-${target.taskId}`;
  }
  return undefined;
}

function deriveOutcome(event: HarnessEvent): ActionOutcome {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.kind) {
    case "review-recorded": {
      if (p.verdict === "pass") return "success";
      if (p.verdict === "reject") return "failure";
      return "unknown";
    }
    case "gate-completed": {
      const stated = p.verdict === "pass" || p.status === "pass";
      if (stated) return "success";
      return p.verdict !== undefined || p.status !== undefined ? "failure" : "unknown";
    }
    case "critic-reviewed": {
      const verdict = typeof p.verdict === "string" ? p.verdict : undefined;
      if (verdict === undefined) return "unknown";
      return verdict === "clean" || verdict === "pass" ? "success" : "failure";
    }
    case "command-reconciled": {
      const status = typeof p.status === "string" ? p.status : undefined;
      if (status === undefined) return "unknown";
      return status === "failed" || status === "error" ? "failure" : "success";
    }
    case "command-recorded": {
      const exitCode = typeof p.exit_code === "number" ? p.exit_code : undefined;
      if (exitCode === undefined) return "unknown";
      return exitCode === 0 ? "success" : "failure";
    }
    default:
      return "success";
  }
}

export function collectActionSteps(
  events: readonly HarnessEvent[],
  promptBytes = 0,
): ActionStepRecord[] {
  return events.map((event, idx) => {
    const details = determinePhaseAndSummary(event, promptBytes);
    return {
      step: event.sequence ?? idx + 1,
      timestamp: event.timestamp ?? new Date().toISOString(),
      actor: event.actor ?? "unknown",
      kind: classifyActionKind(event.kind ?? ""),
      rawKind: event.kind ?? "unknown",
      target: deriveTarget(event),
      outcome: deriveOutcome(event),
      evidence_class: "harness_observed",
      summary: details.summary,
    };
  });
}
