import type { NotificationPayload, NotificationPlatform } from "../types.ts";
import type {
  INotificationDispatcher,
  PlatformNotificationDeliveryResult,
  PlatformNotificationOptions,
} from "./types.ts";

export class HeadlessNotificationDispatcher implements INotificationDispatcher {
  readonly platform: NotificationPlatform;
  private readonly _logs: string[] = [];

  constructor(platform: NotificationPlatform = "unknown") {
    this.platform = platform;
  }

  get logs(): readonly string[] {
    return this._logs;
  }

  display(
    payload: NotificationPayload,
    options?: PlatformNotificationOptions,
  ): PlatformNotificationDeliveryResult {
    const formatted = `[NOTIFICATION ${options?.priority ?? "normal"}]: ${payload.title} - ${payload.subtitle ? `${payload.subtitle}: ` : ""}${payload.message}`;
    this._logs.push(formatted);
    return {
      delivered: true,
      command: "headless-log",
    };
  }

  chime(
    soundFile?: string | undefined,
    _options?: PlatformNotificationOptions,
  ): PlatformNotificationDeliveryResult {
    const formatted = `[CHIME]: ${soundFile ?? "default"}`;
    this._logs.push(formatted);
    return {
      delivered: true,
      command: "headless-chime",
    };
  }

  clearLogs(): void {
    this._logs.length = 0;
  }
}
