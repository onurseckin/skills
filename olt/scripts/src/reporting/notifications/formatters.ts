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
  const resolvedPhase =
    options.phaseName && options.phaseName.trim().length > 0
      ? options.phaseName.trim()
      : "OLT Release";

  const title = options.title !== undefined ? options.title : "OLT Release Deployed";
  const subtitle = options.subtitle !== undefined ? options.subtitle : `Phase: ${resolvedPhase}`;

  const messageSegments: string[] = [];
  if (options.commitSha && options.commitSha.trim().length > 0) {
    messageSegments.push(`✓ Pushed ${options.commitSha.trim().slice(0, 8)}`);
  }
  if (options.durationMs !== undefined && options.durationMs >= 0) {
    messageSegments.push(formatElapsedDuration(options.durationMs));
  }

  let message = messageSegments.join(" | ");

  if (options.taskCount !== undefined && options.taskCount >= 0) {
    const taskWord = options.taskCount === 1 ? "task" : "tasks";
    message =
      message.length > 0
        ? `${message} (${options.taskCount} ${taskWord})`
        : `${options.taskCount} ${taskWord}`;
  }

  if (options.details && options.details.trim().length > 0) {
    message =
      message.length > 0 ? `${message} - ${options.details.trim()}` : options.details.trim();
  }

  if (message.length === 0) {
    message = `Phase "${resolvedPhase}" completed successfully.`;
  }

  return {
    title,
    subtitle,
    message,
    soundFile: options.soundFile,
    soundEnabled: options.soundEnabled !== false,
  };
}
