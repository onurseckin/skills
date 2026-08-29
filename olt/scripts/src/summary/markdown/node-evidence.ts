import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { HarnessEvent } from "../../core/contracts/index.ts";
import type { CommandRecord } from "../../core/contracts/index.ts";
import type { EvidenceClass } from "../../core/contracts/index.ts";
import { isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import type { NodeScript, NodeStateTransition } from "../types.ts";

export const LOG_READ_CEILING_BYTES = 64 * 1024 * 1024;

export interface LogRead {
  text: string;
  truncated: boolean;
}

export function readLog(
  logPath: string | undefined,
  runRoot?: string,
  maxBytes: number = LOG_READ_CEILING_BYTES,
): LogRead | undefined {
  if (!logPath) return undefined;
  const resolved = isAbsolute(logPath) || !runRoot ? logPath : join(runRoot, logPath);
  let fd: number | undefined;
  try {
    fd = openSync(resolved, "r");
    const size = fstatSync(fd).size;
    if (size === 0) return undefined;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString("utf-8").trim();
    return text.length > 0 ? { text, truncated: size > length } : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

export function readLogText(logPath: string | undefined, runRoot?: string): string | undefined {
  return readLog(logPath, runRoot)?.text;
}

function durationMs(startedAt?: string | null, finishedAt?: string | null): number | undefined {
  if (!startedAt || !finishedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  return end - start;
}

function declaredTool(command: CommandRecord): Partial<NodeScript> {
  const evidence: Record<string, EvidenceClass> = {};
  if (command.tool_category !== undefined) evidence.category = "agent_reported";
  if (command.tool !== undefined) evidence.tool = "agent_reported";
  if (command.tool_extras !== undefined) evidence.extras = "agent_reported";
  if (Object.keys(evidence).length === 0) return {};
  return {
    ...(command.tool_category === undefined ? {} : { category: command.tool_category }),
    ...(command.tool === undefined ? {} : { tool: command.tool }),
    ...(command.tool_extras === undefined ? {} : { extras: { ...command.tool_extras } }),
    evidence,
  };
}

function redactedRecord(command: CommandRecord): JsonObject {
  const { environment: _environment, ...rest } = command;
  return rest;
}

export function buildNodeScripts(
  commands: readonly CommandRecord[],
  runRoot?: string,
): NodeScript[] {
  return commands.map((command) => {
    const elapsed = durationMs(command.started_at, command.finished_at);
    const stdout = readLog(command.logs?.stdout?.path, runRoot);
    const stderr = readLog(command.logs?.stderr?.path, runRoot);
    return {
      commandId: command.id,
      argv: command.argv,
      ...(command.execution_argv ? { executionArgv: command.execution_argv } : {}),
      cwd: command.cwd,
      ...(command.cwd_relative ? { cwdRelative: command.cwd_relative } : {}),
      ...(command.repository_root ? { repositoryRoot: command.repository_root } : {}),
      exitCode: command.exit_code,
      ...(command.signal ? { signal: command.signal } : {}),
      ...(command.signals_sent ? { signalsSent: command.signals_sent } : {}),
      ...(command.timeout_kind ? { timeoutKind: command.timeout_kind } : {}),
      status: command.status,
      startedAt: command.started_at,
      ...(command.finished_at ? { finishedAt: command.finished_at } : {}),
      ...(elapsed !== undefined ? { durationMs: elapsed } : {}),
      ...(command.gate_id ? { gateId: command.gate_id } : {}),
      ...(command.task_id ? { taskId: command.task_id } : {}),
      ...(command.actor ? { actor: command.actor } : {}),
      ...(command.record_path ? { logPath: command.record_path } : {}),
      ...(command.fingerprint ? { fingerprint: command.fingerprint } : {}),
      ...(command.assurance ? { assurance: command.assurance } : {}),
      ...(command.attempts ? { attemptCount: command.attempts.length } : {}),
      ...(command.retry_exhausted !== undefined ? { retryExhausted: command.retry_exhausted } : {}),
      ...(command.evidence_issues ? { evidenceIssues: command.evidence_issues } : {}),
      ...(command.preflight_failure ? { preflightFailure: command.preflight_failure } : {}),
      ...(stdout !== undefined ? { stdoutTail: stdout.text } : {}),
      ...(stderr !== undefined ? { stderrTail: stderr.text } : {}),
      ...(stdout?.truncated ? { stdoutTruncated: true } : {}),
      ...(stderr?.truncated ? { stderrTruncated: true } : {}),
      ...(command.logs?.stdout ? { stdoutBytes: command.logs.stdout.bytes } : {}),
      ...(command.logs?.stderr ? { stderrBytes: command.logs.stderr.bytes } : {}),
      ...(command.logs?.stdout ? { stdoutSha256: command.logs.stdout.sha256 } : {}),
      ...(command.logs?.stderr ? { stderrSha256: command.logs.stderr.sha256 } : {}),
      record: redactedRecord(command),
      ...declaredTool(command),
      evidence_class: "harness_observed",
    };
  });
}

export interface TaskCommandPartition {
  implementer: CommandRecord[];
  validator: CommandRecord[];
}

export function partitionTaskCommands(
  commands: readonly CommandRecord[],
  validatorId?: string,
): TaskCommandPartition {
  const implementer: CommandRecord[] = [];
  const validator: CommandRecord[] = [];
  for (const command of commands) {
    const byValidator =
      Boolean(command.gate_id) || (validatorId !== undefined && command.actor === validatorId);
    if (byValidator) validator.push(command);
    else implementer.push(command);
  }
  return { implementer, validator };
}

export function isCriticCommand(command: CommandRecord, criticIds: ReadonlySet<string>): boolean {
  return criticIds.has(command.actor);
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadText(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

interface ReviewSignal {
  timestamp: string;
  actor: string;
  verdict?: string | undefined;
  round?: number | undefined;
  findingClass?: string | undefined;
  findingCount?: number | undefined;
  isProbe: boolean;
}

function classOfReferencedFindings(task: TaskRecord, ids: unknown): string | undefined {
  if (!Array.isArray(ids) || ids.length === 0) return undefined;
  const byId = new Map((task.findings ?? []).map((finding) => [finding.id, finding]));
  const classes = new Set<string>();
  for (const id of ids) {
    const finding = typeof id === "string" ? byId.get(id) : undefined;
    if (finding === undefined || typeof finding.class !== "string") return undefined;
    classes.add(finding.class);
  }
  return classes.size === 1 ? [...classes][0] : undefined;
}

function reviewSignalsFor(task: TaskRecord, events: readonly HarnessEvent[]): ReviewSignal[] {
  const signals: ReviewSignal[] = [];
  for (const event of events) {
    if (event.kind !== "review-recorded" && event.kind !== "probe-recorded") continue;
    const payload = isJsonObject(event.payload) ? event.payload : {};
    if (payload.task_id !== task.id) continue;
    const findingIds = payload.finding_ids;
    signals.push({
      timestamp: event.timestamp,
      actor: event.actor,
      verdict: payloadText(payload, "verdict"),
      round: payloadNumber(payload, "round"),
      findingClass: payloadText(payload, "class") ?? classOfReferencedFindings(task, findingIds),
      findingCount:
        payloadNumber(payload, "finding_count") ??
        (Array.isArray(findingIds) ? findingIds.length : undefined),
      isProbe: event.kind === "probe-recorded",
    });
  }
  return signals;
}

export function buildStateTransitions(
  task: TaskRecord,
  events: readonly HarnessEvent[] = [],
): NodeStateTransition[] {
  const signals = reviewSignalsFor(task, events);
  const transitions: NodeStateTransition[] = (task.history ?? []).map((entry) => ({
    at: entry.at,
    actor: entry.actor,
    from: entry.from,
    to: entry.to,
    reason: entry.reason,
    attempt: entry.attempt,
    evidence_class: "harness_observed",
  }));

  const historyCount = transitions.length;
  const claimed = new Set<number>();
  for (const signal of signals) {
    if (signal.isProbe) {
      transitions.push({
        at: signal.timestamp,
        actor: signal.actor,
        from: "validating",
        to: "validating",
        reason: "adversarial probe recorded",
        attempt: signal.round ?? 0,
        evidence_class: "harness_observed",
        verdict: "probe",
        ...(signal.round !== undefined ? { round: signal.round } : {}),
        ...(signal.findingClass !== undefined ? { findingClass: signal.findingClass } : {}),
        ...(signal.findingCount !== undefined ? { findingCount: signal.findingCount } : {}),
      });
      continue;
    }
    const at = Date.parse(signal.timestamp);
    let index = -1;
    let closest = Number.POSITIVE_INFINITY;
    for (let position = 0; position < historyCount; position++) {
      const transition = transitions[position];
      if (!transition || claimed.has(position)) continue;
      if (transition.from !== "validating" || transition.actor !== signal.actor) continue;
      const distance = Math.abs(Date.parse(transition.at) - at);
      if (distance < closest) {
        closest = distance;
        index = position;
      }
    }
    if (index === -1) continue;
    claimed.add(index);
    const transition = transitions[index];
    if (!transition) continue;
    if (signal.verdict !== undefined) transition.verdict = signal.verdict;
    if (signal.round !== undefined) transition.round = signal.round;
    if (signal.findingClass !== undefined && signal.verdict !== "pass") {
      transition.findingClass = signal.findingClass;
    }
    if (signal.findingCount !== undefined) transition.findingCount = signal.findingCount;
  }

  return transitions.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}
