import type { NotificationPayload, PhaseCompletionNotificationOptions } from "./types.ts";

/**
 * Formats a millisecond duration into a human-readable elapsed duration string.
 * Examples:
 *   - 0 -> "0s"
 *   - 14000 -> "14s"
 *   - 272000 -> "4m 32s"
 *   - 3724000 -> "1h 2m 4s"
 */
export function formatElapsedDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0s";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 1) {
    return "<1s";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Escapes characters for AppleScript string literals.
 */
export function escapeAppleScriptString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Escapes characters for PowerShell string literals.
 */
export function escapePowerShellString(input: string): string {
  return input.replace(/'/g, "''").replace(/`/g, "``");
}

/**
 * Builds a structured notification payload from phase completion options.
 */
export function buildPhaseNotificationPayload(
  options: PhaseCompletionNotificationOptions,
): NotificationPayload {
  const title = options.title ?? "OLT Release Complete";
  const subtitle = options.subtitle ?? options.phaseName;

  const parts: string[] = [];

  if (options.durationMs !== undefined && options.durationMs >= 0) {
    parts.push(`Duration: ${formatElapsedDuration(options.durationMs)}`);
  }

  if (options.taskCount !== undefined && options.taskCount >= 0) {
    const taskWord = options.taskCount === 1 ? "task" : "tasks";
    parts.push(`${options.taskCount} ${taskWord}`);
  }

  if (options.commitSha) {
    const shortSha = options.commitSha.trim().slice(0, 8);
    if (shortSha.length > 0) {
      parts.push(`commit ${shortSha}`);
    }
  }

  if (options.details) {
    parts.push(options.details.trim());
  }

  const message =
    parts.length > 0
      ? `Phase "${options.phaseName}" landed (${parts.join(", ")})`
      : `Phase "${options.phaseName}" landed successfully.`;

  return {
    title,
    subtitle,
    message,
    soundFile: options.soundFile,
    soundEnabled: options.soundEnabled !== false,
  };
}
