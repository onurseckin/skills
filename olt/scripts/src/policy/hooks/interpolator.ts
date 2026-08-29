export interface HookInterpolationContext {
  readonly phaseName?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly durationFormatted?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly taskCount?: number | undefined;
  readonly repoRoot?: string | undefined;
  readonly status?: string | undefined;
  readonly [key: string]: unknown;
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0s";
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

export function interpolateHookCommand(
  template: string,
  context: HookInterpolationContext
): string {
  const phaseName =
    context.phaseName ??
    (typeof context["phase_name"] === "string" ? context["phase_name"] : "");

  const commitSha =
    context.commitSha ??
    (typeof context["commit_sha"] === "string" ? context["commit_sha"] : "");

  const durationMsVal =
    context.durationMs ??
    (typeof context["duration_ms"] === "number" ? context["duration_ms"] : undefined);

  const durationFormatted =
    context.durationFormatted ??
    (typeof context["duration_formatted"] === "string"
      ? context["duration_formatted"]
      : durationMsVal !== undefined
        ? formatDuration(durationMsVal)
        : "0s");

  const durationMs = durationMsVal !== undefined ? String(durationMsVal) : "0";

  const taskCountVal =
    context.taskCount ??
    (typeof context["task_count"] === "number" ? context["task_count"] : undefined);

  const taskCount = taskCountVal !== undefined ? String(taskCountVal) : "0";

  const repoRoot =
    context.repoRoot ??
    (typeof context["repo_root"] === "string" ? context["repo_root"] : "");

  const status =
    context.status ??
    (typeof context["status"] === "string" ? context["status"] : "SUCCESS");

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
    "{status}": status,
  };

  let result = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replaceAll(placeholder, value);
  }
  return result;
}
