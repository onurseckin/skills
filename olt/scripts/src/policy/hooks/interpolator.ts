export interface HookVariableContext {
  readonly phase_name?: string | undefined;
  readonly phaseName?: string | undefined;
  readonly commit_sha?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly duration_formatted?: string | undefined;
  readonly durationFormatted?: string | undefined;
  readonly duration_ms?: number | string | undefined;
  readonly durationMs?: number | string | undefined;
  readonly task_count?: number | string | undefined;
  readonly taskCount?: number | string | undefined;
  readonly repo_root?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly error_message?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly task_id?: string | undefined;
  readonly taskId?: string | undefined;
  readonly status?: string | undefined;
  readonly [key: string]: unknown;
}

export type HookInterpolationContext = HookVariableContext;

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0s";
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

export const formatHookDuration = formatDuration;

function str(val: unknown): string {
  return typeof val === "string" ? val : "";
}

export function interpolateHookCommand(template: string, context: HookVariableContext): string {
  const rawPhase = context.phase_name !== undefined ? context.phase_name : context.phaseName;
  const phaseName = str(rawPhase);
  const rawCommit = context.commit_sha !== undefined ? context.commit_sha : context.commitSha;
  const commitSha = str(rawCommit);
  const rawMs = context.duration_ms !== undefined ? context.duration_ms : context.durationMs;
  let numMs: number | undefined;
  if (typeof rawMs === "number") {
    numMs = rawMs;
  } else if (typeof rawMs === "string" && !Number.isNaN(Number(rawMs)) && rawMs.trim() !== "") {
    numMs = Number(rawMs);
  }
  const rawDuration = context.duration_formatted !== undefined ? context.duration_formatted : context.durationFormatted;
  let durationFormatted = str(rawDuration);
  if (durationFormatted === "") {
    durationFormatted = numMs !== undefined ? formatDuration(numMs) : "0s";
  }
  const durationMs = numMs !== undefined ? String(numMs) : "0";
  const rawCount = context.task_count !== undefined ? context.task_count : context.taskCount;
  let taskCount = "0";
  if (typeof rawCount === "number") {
    taskCount = String(rawCount);
  } else if (typeof rawCount === "string" && rawCount.trim() !== "") {
    taskCount = rawCount;
  }
  const rawRepoRoot = context.repo_root !== undefined ? context.repo_root : context.repoRoot;
  const repoRoot = str(rawRepoRoot);
  const rawErr = context.error_message !== undefined ? context.error_message : context.errorMessage;
  const errorMessage = str(rawErr);
  const rawTaskId = context.task_id !== undefined ? context.task_id : context.taskId;
  const taskId = str(rawTaskId);
  const rawStatus = str(context.status);
  const status = rawStatus !== "" ? rawStatus : "SUCCESS";

  const replacements: Record<string, string> = {
    "{phase_name}": phaseName,
    "{phaseName}": phaseName,
    "{commit_sha}": commitSha,
    "{commitSha}": commitSha,
    "{duration_formatted}": durationFormatted,
    "{durationFormatted}": durationFormatted,
    "{duration_ms}": durationMs,
    "{durationMs}": durationMs,
    "{task_count}": taskCount,
    "{taskCount}": taskCount,
    "{repo_root}": repoRoot,
    "{repoRoot}": repoRoot,
    "{error_message}": errorMessage,
    "{errorMessage}": errorMessage,
    "{task_id}": taskId,
    "{taskId}": taskId,
    "{status}": status,
  };

  let result = template;
  for (const [token, value] of Object.entries(replacements)) {
    result = result.replaceAll(token, value);
  }
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null && typeof value !== "object") {
      result = result.replaceAll(`{${key}}`, String(value));
    }
  }
  return result;
}

export const interpolateLifecycleHookCommand = interpolateHookCommand;
