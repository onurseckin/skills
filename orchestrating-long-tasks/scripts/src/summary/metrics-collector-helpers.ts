import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import type { TimingBreakdown, TokenUsageDetail } from "./types.ts";

export function parseDurationMs(startedAt?: string | null, finishedAt?: string | null): number {
  if (!startedAt || !finishedAt) return 0;
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  return isNaN(start) || isNaN(end) || end < start ? 0 : end - start;
}

export function computeWallDurationMs(events: readonly HarnessEvent[]): number {
  if (events.length < 2) return 0;
  const first = events[0]?.timestamp;
  const last = events[events.length - 1]?.timestamp;
  return parseDurationMs(first, last);
}

export interface ValidationInterval {
  start: string;
  end?: string | undefined;
  durationMs: number;
}

export interface TaskTimestampSummary {
  claim?: string | undefined;
  submit?: string | undefined;
  valStart?: string | undefined;
  review?: string | undefined;
  executionDurationMs?: number | undefined;
  validationDurationMs?: number | undefined;
  validationIntervals: ValidationInterval[];
}

export function extractTaskTimestamps(
  task: TaskRecord,
  events: readonly HarnessEvent[],
): TaskTimestampSummary {
  let claim: string | undefined;
  let submit: string | undefined;
  let valStart: string | undefined;
  let review: string | undefined;

  let currentExecStart: string | undefined;
  let totalExecDurationMs = 0;
  let hasExecIntervals = false;

  let currentValStart: string | undefined;
  let totalValDurationMs = 0;
  let hasValIntervals = false;
  const validationIntervals: ValidationInterval[] = [];

  for (const ev of events) {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    const tId =
      typeof p.task_id === "string" ? p.task_id : typeof p.id === "string" ? p.id : undefined;
    if (tId === task.id) {
      if (ev.kind === "task-claimed" || ev.kind === "task-leased") {
        if (!claim) claim = ev.timestamp;
        currentExecStart = ev.timestamp;
      } else if (ev.kind === "task-submitted") {
        submit = ev.timestamp;
        if (currentExecStart) {
          totalExecDurationMs += parseDurationMs(currentExecStart, ev.timestamp);
          hasExecIntervals = true;
          currentExecStart = undefined;
        }
      } else if (ev.kind === "task-validation-started" || ev.kind === "gate-started") {
        if (!valStart) valStart = ev.timestamp;
        if (!currentValStart) {
          currentValStart = ev.timestamp;
        }
      } else if (
        ev.kind === "review-recorded" ||
        ev.kind === "task-finished" ||
        ev.kind === "gate-completed"
      ) {
        review = ev.timestamp;
        if (currentValStart) {
          const durationMs = parseDurationMs(currentValStart, ev.timestamp);
          validationIntervals.push({ start: currentValStart, end: ev.timestamp, durationMs });
          totalValDurationMs += durationMs;
          hasValIntervals = true;
          currentValStart = undefined;
        }
      }
    }
  }

  if (currentValStart) {
    const end = review && Date.parse(review) >= Date.parse(currentValStart) ? review : undefined;
    const durationMs = end ? parseDurationMs(currentValStart, end) : 0;
    validationIntervals.push({ start: currentValStart, end, durationMs });
    if (end) {
      totalValDurationMs += durationMs;
      hasValIntervals = true;
    }
  }

  return {
    claim,
    submit,
    valStart,
    review,
    executionDurationMs: hasExecIntervals ? totalExecDurationMs : undefined,
    validationDurationMs: hasValIntervals ? totalValDurationMs : undefined,
    validationIntervals,
  };
}

export function computeTaskTiming(
  task: TaskRecord,
  events: readonly HarnessEvent[] = [],
  taskCmds: readonly CommandRecord[] = [],
): TimingBreakdown {
  const {
    claim,
    submit,
    valStart,
    review,
    executionDurationMs,
    validationDurationMs: accumulatedValMs,
  } = extractTaskTimestamps(task, events);
  const activeCommandMs = taskCmds.reduce(
    (acc, c) => acc + parseDurationMs(c.started_at, c.finished_at),
    0,
  );

  let wallDurationMs = 0;
  if (executionDurationMs !== undefined && executionDurationMs > 0) {
    wallDurationMs = executionDurationMs;
  } else if (claim && submit) {
    wallDurationMs = parseDurationMs(claim, submit);
  } else if (claim && review) {
    wallDurationMs = parseDurationMs(claim, review);
  } else if (taskCmds.length > 0) {
    const sTimes = taskCmds.map((c) => Date.parse(c.started_at)).filter((t) => !isNaN(t));
    const eTimes = taskCmds
      .map((c) => Date.parse(c.finished_at ?? c.started_at))
      .filter((t) => !isNaN(t));
    if (sTimes.length > 0 && eTimes.length > 0)
      wallDurationMs = Math.max(activeCommandMs, Math.max(...eTimes) - Math.min(...sTimes));
  }
  if (wallDurationMs < activeCommandMs) wallDurationMs = activeCommandMs;

  const cognitiveLatencyMs = Math.max(0, wallDurationMs - activeCommandMs);
  let validationDurationMs: number | undefined;
  if (accumulatedValMs !== undefined) {
    validationDurationMs = accumulatedValMs;
  } else if (valStart && review) {
    validationDurationMs = parseDurationMs(valStart, review);
  } else {
    const valCmds = taskCmds.filter((c) => Boolean(c.gate_id) || c.actor === "val");
    if (valCmds.length > 0)
      validationDurationMs = valCmds.reduce(
        (acc, c) => acc + parseDurationMs(c.started_at, c.finished_at),
        0,
      );
  }

  return {
    wallDurationMs,
    activeCommandMs,
    cognitiveLatencyMs,
    ...(validationDurationMs !== undefined ? { validationDurationMs } : {}),
  };
}

export function computeGateTiming(
  task: TaskRecord,
  events: readonly HarnessEvent[] = [],
  taskCmds: readonly CommandRecord[] = [],
): TimingBreakdown | undefined {
  const {
    valStart,
    review,
    validationDurationMs: accumulatedValMs,
  } = extractTaskTimestamps(task, events);
  const valCmds = taskCmds.filter((c) => Boolean(c.gate_id) || c.actor === "val");
  const activeCommandMs = valCmds.reduce(
    (acc, c) => acc + parseDurationMs(c.started_at, c.finished_at),
    0,
  );

  let wallDurationMs = 0;
  if (accumulatedValMs !== undefined) {
    wallDurationMs = accumulatedValMs;
  } else if (valStart && review) {
    wallDurationMs = parseDurationMs(valStart, review);
  } else if (valCmds.length > 0) {
    const sTimes = valCmds.map((c) => Date.parse(c.started_at)).filter((t) => !isNaN(t));
    const eTimes = valCmds
      .map((c) => Date.parse(c.finished_at ?? c.started_at))
      .filter((t) => !isNaN(t));
    if (sTimes.length > 0 && eTimes.length > 0)
      wallDurationMs = Math.max(activeCommandMs, Math.max(...eTimes) - Math.min(...sTimes));
  }
  if (wallDurationMs < activeCommandMs) wallDurationMs = activeCommandMs;

  return {
    wallDurationMs,
    activeCommandMs,
    cognitiveLatencyMs: Math.max(0, wallDurationMs - activeCommandMs),
    validationDurationMs: wallDurationMs,
  };
}

export function computeTaskTokens(
  task: TaskRecord,
  manifest?: Manifest,
  taskCmds: readonly CommandRecord[] = [],
  hostTokens?: TokenUsageDetail,
): TokenUsageDetail {
  if (hostTokens && !hostTokens.isEstimated) {
    const input = hostTokens.inputTokens ?? 0;
    const output = hostTokens.outputTokens ?? 0;
    const reasoning = hostTokens.reasoningTokens ?? 0;
    const cacheC = hostTokens.cacheCreationTokens ?? 0;
    const cacheR = hostTokens.cacheReadTokens ?? 0;
    const totalTokens = input + output + reasoning + cacheC + cacheR;
    return {
      inputTokens: input,
      outputTokens: output,
      ...(hostTokens.reasoningTokens !== undefined
        ? { reasoningTokens: hostTokens.reasoningTokens }
        : {}),
      ...(hostTokens.cacheCreationTokens !== undefined
        ? { cacheCreationTokens: hostTokens.cacheCreationTokens }
        : {}),
      ...(hostTokens.cacheReadTokens !== undefined
        ? { cacheReadTokens: hostTokens.cacheReadTokens }
        : {}),
      totalTokens,
      ...(hostTokens.costUsd !== undefined ? { costUsd: hostTokens.costUsd } : {}),
      isEstimated: false,
    };
  }

  const promptBytes = manifest?.prompt_bytes ?? 1200;
  let cmdStdoutBytes = 0;
  for (const cmd of taskCmds)
    cmdStdoutBytes +=
      cmd.logs?.stdout?.bytes ?? (typeof cmd.stdout === "string" ? cmd.stdout.length : 0);
  const reportBytes = task.report ? JSON.stringify(task.report).length : 400;
  const summaryStr = typeof task.report?.summary === "string" ? task.report.summary : "";

  const inputTokens = Math.max(50, Math.round((promptBytes + cmdStdoutBytes) / 4));
  const outputTokens = Math.max(50, Math.round((summaryStr.length * 4 + reportBytes) / 4));
  const reasoningTokens = hostTokens?.reasoningTokens;
  const cacheCreationTokens = hostTokens?.cacheCreationTokens;
  const cacheReadTokens = hostTokens?.cacheReadTokens;
  const totalTokens =
    inputTokens +
    outputTokens +
    (reasoningTokens ?? 0) +
    (cacheCreationTokens ?? 0) +
    (cacheReadTokens ?? 0);

  return {
    inputTokens,
    outputTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    totalTokens,
    ...(hostTokens?.costUsd !== undefined ? { costUsd: hostTokens.costUsd } : {}),
    isEstimated: true,
  };
}

export function computeGateTokens(
  task: TaskRecord,
  taskCmds: readonly CommandRecord[] = [],
  hostTokens?: TokenUsageDetail,
): TokenUsageDetail {
  if (hostTokens && !hostTokens.isEstimated) {
    const input = hostTokens.inputTokens ?? 0;
    const output = hostTokens.outputTokens ?? 0;
    const reasoning = hostTokens.reasoningTokens ?? 0;
    const cacheC = hostTokens.cacheCreationTokens ?? 0;
    const cacheR = hostTokens.cacheReadTokens ?? 0;
    const totalTokens = input + output + reasoning + cacheC + cacheR;
    return {
      inputTokens: input,
      outputTokens: output,
      ...(hostTokens.reasoningTokens !== undefined
        ? { reasoningTokens: hostTokens.reasoningTokens }
        : {}),
      ...(hostTokens.cacheCreationTokens !== undefined
        ? { cacheCreationTokens: hostTokens.cacheCreationTokens }
        : {}),
      ...(hostTokens.cacheReadTokens !== undefined
        ? { cacheReadTokens: hostTokens.cacheReadTokens }
        : {}),
      totalTokens,
      ...(hostTokens.costUsd !== undefined ? { costUsd: hostTokens.costUsd } : {}),
      isEstimated: false,
    };
  }

  const valCmds = taskCmds.filter((c) => Boolean(c.gate_id) || c.actor === "val");
  let valStdoutBytes = 0;
  for (const cmd of valCmds) {
    valStdoutBytes +=
      cmd.logs?.stdout?.bytes ?? (typeof cmd.stdout === "string" ? cmd.stdout.length : 0);
  }
  const findingsBytes = (task.findings ?? []).reduce((acc, f) => acc + JSON.stringify(f).length, 0);
  const inputTokens = Math.max(40, Math.round((valStdoutBytes + findingsBytes + 200) / 4));
  const outputTokens = Math.max(30, Math.round((findingsBytes + 150) / 4));
  const reasoningTokens = hostTokens?.reasoningTokens;
  const cacheCreationTokens = hostTokens?.cacheCreationTokens;
  const cacheReadTokens = hostTokens?.cacheReadTokens;
  const totalTokens =
    inputTokens +
    outputTokens +
    (reasoningTokens ?? 0) +
    (cacheCreationTokens ?? 0) +
    (cacheReadTokens ?? 0);

  return {
    inputTokens,
    outputTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    totalTokens,
    ...(hostTokens?.costUsd !== undefined ? { costUsd: hostTokens.costUsd } : {}),
    isEstimated: true,
  };
}
