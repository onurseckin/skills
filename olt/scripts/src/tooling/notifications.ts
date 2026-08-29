import {
  DEFAULT_DARWIN_NOTIFICATION_SOUND,
  DEFAULT_LINUX_NOTIFICATION_SOUND,
  buildPhaseNotificationPayload,
  defaultNotificationSpawner,
  displaySystemNotification,
  escapeAppleScriptString,
  escapePowerShellString,
  formatElapsedDuration,
  isTestEnvironment,
  notifyPhaseCompletion,
  playCompletionChime,
  sendSystemNotification,
  type NotificationPayload,
  type NotificationPlatform,
  type NotificationProcessSpawner,
  type NotificationProcessSpawnResult,
  type NotificationResult,
  type PhaseCompletionNotificationOptions,
} from "../reporting/notifications/index.ts";

export type {
  NotificationPayload,
  NotificationPlatform,
  NotificationProcessSpawner,
  NotificationProcessSpawnResult,
  NotificationResult,
  PhaseCompletionNotificationOptions,
};

export {
  DEFAULT_DARWIN_NOTIFICATION_SOUND,
  DEFAULT_LINUX_NOTIFICATION_SOUND,
  buildPhaseNotificationPayload,
  defaultNotificationSpawner,
  displaySystemNotification,
  escapeAppleScriptString,
  escapePowerShellString,
  formatElapsedDuration,
  isTestEnvironment,
  notifyPhaseCompletion,
  playCompletionChime,
  sendSystemNotification,
};

export function triggerPhaseNotification(
  options: PhaseCompletionNotificationOptions,
): NotificationResult {
  return notifyPhaseCompletion(options);
}

export function triggerTestNotification(options?: {
  readonly soundEnabled?: boolean | undefined;
  readonly silent?: boolean | undefined;
  readonly platform?: NotificationPlatform | undefined;
  readonly customSpawn?: NotificationProcessSpawner | undefined;
}): NotificationResult {
  const soundEnabled = options?.soundEnabled !== false;
  return sendSystemNotification(
    {
      title: "OLT Notification Engine",
      subtitle: "Native Push Verification",
      message: "Native OS audio and visual notification engine is active and operational.",
      soundEnabled,
    },
    {
      platform: options?.platform,
      customSpawn: options?.customSpawn,
      silent: options?.silent,
    },
  );
}

export function triggerAudioChime(
  soundFile?: string | undefined,
  options?: {
    readonly platform?: NotificationPlatform | undefined;
    readonly customSpawn?: NotificationProcessSpawner | undefined;
  },
): { delivered: boolean; command?: string | undefined } {
  return playCompletionChime(soundFile, options);
}
