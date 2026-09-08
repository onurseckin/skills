import {
  formatElapsedDuration,
  notifyPhaseCompletion,
  playCompletionChime,
  sendSystemNotification,
  type NotificationResult,
} from "../../reporting/notifications/index.ts";
import { boolFlag, integerFlag, textFlag, type Flags } from "../index.ts";

export function notifyPhaseCommand(flags: Flags): Record<string, unknown> {
  const phaseName = textFlag(flags, "phase", false);
  const effectivePhase = phaseName !== undefined ? phaseName : "";
  const durationMs = integerFlag(flags, "duration-ms", { required: false });
  const taskCount = integerFlag(flags, "tasks", { required: false });
  const commitSha = textFlag(flags, "commit", false);
  const title = textFlag(flags, "title", false);
  const subtitle = textFlag(flags, "subtitle", false);
  const details = textFlag(flags, "details", false);
  const soundFlag = boolFlag(flags, "sound");
  const noSound = boolFlag(flags, "no-sound");
  const silent = boolFlag(flags, "silent");
  const asJson = boolFlag(flags, "json");

  const soundEnabled = !noSound && (soundFlag || true);

  const result: NotificationResult = notifyPhaseCompletion({
    phaseName: effectivePhase,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(taskCount !== undefined ? { taskCount } : {}),
    ...(commitSha !== undefined ? { commitSha } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(details !== undefined ? { details } : {}),
    soundEnabled,
    silent,
  });

  const lines: string[] = [];
  lines.push(`### Native OS Notification Dispatched: \`${effectivePhase}\``);
  lines.push(`- **Platform**: \`${result.platform}\``);
  lines.push(`- **Visual Delivered**: \`${result.visualDelivered}\``);
  lines.push(`- **Audio Delivered**: \`${result.audioDelivered}\``);
  if (durationMs !== undefined) {
    lines.push(`- **Duration**: \`${formatElapsedDuration(durationMs)}\``);
  }
  if (taskCount !== undefined) {
    lines.push(`- **Task Count**: \`${taskCount}\``);
  }
  if (commitSha !== undefined) {
    lines.push(`- **Commit**: \`${commitSha}\``);
  }
  if (result.visualCommand) {
    lines.push(`- **Visual Command**: \`${result.visualCommand}\``);
  }
  if (result.audioCommand) {
    lines.push(`- **Audio Command**: \`${result.audioCommand}\``);
  }

  return {
    markdown: lines.join("\n"),
    phase: effectivePhase,
    result,
    ...(asJson ? { json: true } : {}),
  };
}

export function notifyTestCommand(flags: Flags): Record<string, unknown> {
  const asJson = boolFlag(flags, "json");
  const noSound = boolFlag(flags, "no-sound");
  const soundEnabled = !noSound;

  const result: NotificationResult = sendSystemNotification({
    title: "OLT Notification Engine",
    subtitle: "Native Push Verification",
    message: "Native OS audio and visual notification engine is active and operational.",
    soundEnabled,
  });

  const lines: string[] = [];
  lines.push(`### Native Notification Engine Test: Complete`);
  lines.push(`- **Platform**: \`${result.platform}\``);
  lines.push(
    `- **Visual Notification**: \`${result.visualDelivered ? "Delivered" : "Skipped/Failed"}\``,
  );
  lines.push(
    `- **Glass Audio Chime**: \`${result.audioDelivered ? "Delivered" : "Skipped/Disabled"}\``,
  );

  return {
    markdown: lines.join("\n"),
    status: result.success ? "success" : "failed",
    result,
    ...(asJson ? { json: true } : {}),
  };
}
