import { escapeAppleScriptString } from "../formatters.ts";
import { defaultNotificationSpawner } from "../system-notifier.ts";
import { DEFAULT_DARWIN_NOTIFICATION_SOUND, type NotificationPayload } from "../types.ts";
import type {
  INotificationDispatcher,
  PlatformNotificationDeliveryResult,
  PlatformNotificationOptions,
} from "./types.ts";

export class DarwinNotificationDispatcher implements INotificationDispatcher {
  readonly platform = "darwin" as const;

  display(
    payload: NotificationPayload,
    options?: PlatformNotificationOptions,
  ): PlatformNotificationDeliveryResult {
    const spawner = options?.customSpawn ?? defaultNotificationSpawner;
    const scriptParts = [
      `display notification "${escapeAppleScriptString(payload.message)}"`,
      `with title "${escapeAppleScriptString(payload.title)}"`,
    ];
    if (payload.subtitle) {
      scriptParts.push(`subtitle "${escapeAppleScriptString(payload.subtitle)}"`);
    }
    const appleScript = scriptParts.join(" ");
    const cmd = `osascript -e '${appleScript}'`;

    try {
      spawner("osascript", ["-e", appleScript], { detached: true, stdio: "ignore" });
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
    const resolvedSound = soundFile ?? DEFAULT_DARWIN_NOTIFICATION_SOUND;
    const cmd = `afplay "${resolvedSound}"`;

    try {
      spawner("afplay", [resolvedSound], { detached: true, stdio: "ignore" });
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
