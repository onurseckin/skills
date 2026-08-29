import { defaultNotificationSpawner } from "../system-notifier.ts";
import { DEFAULT_LINUX_NOTIFICATION_SOUND, type NotificationPayload } from "../types.ts";
import type {
  INotificationDispatcher,
  PlatformNotificationDeliveryResult,
  PlatformNotificationOptions,
} from "./types.ts";

export class LinuxNotificationDispatcher implements INotificationDispatcher {
  readonly platform = "linux" as const;

  display(
    payload: NotificationPayload,
    options?: PlatformNotificationOptions,
  ): PlatformNotificationDeliveryResult {
    const spawner = options?.customSpawn ?? defaultNotificationSpawner;
    const messageBody = payload.subtitle
      ? `${payload.subtitle}\n${payload.message}`
      : payload.message;

    const args = [payload.title, messageBody];
    if (options?.priority) {
      args.unshift("-u", options.priority);
    }
    if (options?.iconPath) {
      args.unshift("-i", options.iconPath);
    }

    const cmd = `notify-send ${args.map((a) => `"${a}"`).join(" ")}`;

    try {
      spawner("notify-send", args, { detached: true, stdio: "ignore" });
      return { delivered: true, command: cmd };
    } catch (err) {
      return {
        delivered: false,
        command: cmd,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  chime(
    soundFile?: string | undefined,
    options?: PlatformNotificationOptions,
  ): PlatformNotificationDeliveryResult {
    const spawner = options?.customSpawn ?? defaultNotificationSpawner;
    const resolvedSound = soundFile ?? DEFAULT_LINUX_NOTIFICATION_SOUND;
    const cmd = `paplay "${resolvedSound}"`;

    try {
      spawner("paplay", [resolvedSound], { detached: true, stdio: "ignore" });
      return { delivered: true, command: cmd };
    } catch (err) {
      return {
        delivered: false,
        command: cmd,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
