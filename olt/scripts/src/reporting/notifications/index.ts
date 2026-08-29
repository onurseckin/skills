export type {
  NotificationPayload,
  NotificationPlatform,
  NotificationProcessSpawner,
  NotificationProcessSpawnResult,
  NotificationResult,
  PhaseCompletionNotificationOptions,
} from "./types.ts";

export { DEFAULT_DARWIN_NOTIFICATION_SOUND, DEFAULT_LINUX_NOTIFICATION_SOUND } from "./types.ts";

export {
  buildPhaseNotificationPayload,
  escapeAppleScriptString,
  escapePowerShellString,
  formatElapsedDuration,
} from "./formatters.ts";

export {
  defaultNotificationSpawner,
  displaySystemNotification,
  isTestEnvironment,
  notifyPhaseCompletion,
  playCompletionChime,
  sendSystemNotification,
} from "./system-notifier.ts";
