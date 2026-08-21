import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import {
  earliestOpenValidation,
  everyApplicableDomainPassed,
} from "../workflow/review/validation-state.ts";
import type { EdgeExchange, ExchangeTransferredFile, FileRef, NodeFinding } from "./types.ts";

export function transferredFiles(files: readonly FileRef[]): ExchangeTransferredFile[] {
  return files.map((file) => ({ path: file.path, ...(file.mode ? { mode: file.mode } : {}) }));
}

export function commandLogBytes(commands: readonly CommandRecord[]): number | undefined {
  let total = 0;
  let seen = false;
  for (const command of commands) {
    const stdout = command.logs?.stdout?.bytes;
    const stderr = command.logs?.stderr?.bytes;
    if (stdout !== undefined) {
      total += stdout;
      seen = true;
    }
    if (stderr !== undefined) {
      total += stderr;
      seen = true;
    }
  }
  return seen ? total : undefined;
}

export function commandDurationMs(commands: readonly CommandRecord[]): number | undefined {
  let total = 0;
  let seen = false;
  for (const command of commands) {
    if (!command.finished_at) continue;
    const start = Date.parse(command.started_at);
    const end = Date.parse(command.finished_at);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    total += end - start;
    seen = true;
  }
  return seen ? total : undefined;
}

export function reportBytes(task: TaskRecord): number | undefined {
  return task.report ? JSON.stringify(task.report).length : undefined;
}

export function dispatchExchange(
  task: TaskRecord,
  taskName: string,
  agentId: string | undefined,
): EdgeExchange {
  return {
    id: `exch-dispatch-${task.id}`,
    ...(task.lease?.issued_at ? { timestamp: task.lease.issued_at } : {}),
    direction: "forward",
    type: "dispatch",
    kind: "prompt",
    summary: agentId ? `Dispatched ${task.id} to ${agentId}` : `Dispatched ${task.id}`,
    detail: `Goal: ${taskName}`,
    evidence_class: task.lease ? "harness_observed" : "derived",
  };
}

export function submissionExchange(
  task: TaskRecord,
  files: readonly FileRef[],
  target: "validator" | "gate",
): EdgeExchange {
  const bytes = reportBytes(task);
  const summaryText = typeof task.report?.summary === "string" ? task.report.summary : undefined;
  return {
    id: `exch-submit-${task.id}`,
    direction: "forward",
    type: target === "validator" ? "handoff" : "submission",
    kind: "file",
    summary: `Submitted ${task.id} for verification`,
    ...(summaryText !== undefined ? { detail: summaryText } : {}),
    ...(files.length > 0 ? { files: transferredFiles(files) } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
    evidence_class: task.report ? "harness_observed" : "derived",
  };
}

function verdictOf(task: TaskRecord): "PASS" | "FAIL" | "PROBE" | undefined {
  const validations = task.validations ?? [];
  if (validations.length > 0 && everyApplicableDomainPassed(task)) return "PASS";
  if (validations.some((entry) => entry.verdict === "probe")) return "PROBE";
  if (task.status === "done" || task.status === "validated") return "PASS";
  if (task.status === "changes_requested") return "FAIL";
  return undefined;
}

export function verdictExchange(
  task: TaskRecord,
  validatorCommands: readonly CommandRecord[],
): EdgeExchange {
  const verdict = verdictOf(task);
  const bytes = commandLogBytes(validatorCommands);
  const duration = commandDurationMs(validatorCommands);
  const validation = earliestOpenValidation(task);
  return {
    id: `exch-verdict-${task.id}`,
    ...(validation?.started_at ? { timestamp: validation.started_at } : {}),
    direction: "forward",
    type: "verdict",
    kind: "decision",
    summary: `Verification verdict for ${task.id}`,
    ...(verdict !== undefined ? { verdict } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
    ...(duration !== undefined ? { durationMs: duration } : {}),
    evidence_class: validation ? "harness_observed" : "derived",
  };
}

function findingExchange(
  finding: NodeFinding,
  taskId: string,
  index: number,
  type: "probe" | "pushback",
): EdgeExchange {
  const round = typeof finding.round === "number" ? finding.round : undefined;
  return {
    id: `exch-${type}-${taskId}-${index + 1}`,
    ...(finding.timestamp ? { timestamp: finding.timestamp } : {}),
    direction: "reverse",
    type,
    kind: "decision",
    summary: finding.observation,
    ...(finding.remediation !== undefined ? { detail: finding.remediation } : {}),
    ...(type === "pushback" ? { verdict: "FAIL" as const } : { verdict: "PROBE" as const }),
    finding: {
      id: finding.id,
      ...(finding.requirementId !== undefined ? { requirementId: finding.requirementId } : {}),
      ...(typeof finding.class === "string" ? { class: finding.class } : {}),
      severity: finding.severity,
      observation: finding.observation,
      ...(finding.remediation !== undefined ? { remediation: finding.remediation } : {}),
      status: finding.status,
      ...(round !== undefined ? { round } : {}),
    },
    evidence_class: "harness_observed",
  };
}

export function findingExchanges(
  findings: readonly NodeFinding[],
  taskId: string,
  type: "probe" | "pushback",
): EdgeExchange[] {
  return findings.map((finding, index) => findingExchange(finding, taskId, index, type));
}

function gateVerdictOf(task: TaskRecord): "PASS" | "FAIL" | undefined {
  if (task.status === "done" || task.status === "validated") return "PASS";
  if (task.status === "cancelled" || task.status === "escalated") return "FAIL";
  return undefined;
}

export function evidenceExchange(task: TaskRecord): EdgeExchange {
  const verdict = gateVerdictOf(task);
  return {
    id: `exch-evidence-${task.id}`,
    direction: "forward",
    type: "signoff",
    kind: "artifact",
    summary: `Gate evidence for ${task.id}`,
    ...(verdict !== undefined ? { verdict } : {}),
    evidence_class: "harness_observed",
  };
}
