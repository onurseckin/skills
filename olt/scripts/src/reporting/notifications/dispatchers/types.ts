import type {
  NotificationPayload,
  NotificationPlatform,
  NotificationProcessSpawner,
  NotificationResult,
} from "../types.ts";

export type NotificationPriority = "low" | "normal" | "critical";

export interface PlatformNotificationOptions {
  readonly priority?: NotificationPriority | undefined;
  readonly category?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly iconPath?: string | undefined;
  readonly silent?: boolean | undefined;
  readonly customSpawn?: NotificationProcessSpawner | undefined;
}

export interface PlatformNotificationDeliveryResult {
  readonly delivered: boolean;
  readonly command?: string | undefined;
  readonly error?: string | undefined;
}

export interface INotificationDispatcher {
  readonly platform: NotificationPlatform;
  display(
    payload: NotificationPayload,
    options?: PlatformNotificationOptions,
  ): PlatformNotificationDeliveryResult;
  chime(
    soundFile?: string | undefined,
    options?: PlatformNotificationOptions,
  ): PlatformNotificationDeliveryResult;
}

export interface RateLimiterOptions {
  readonly maxNotificationsPerWindow?: number | undefined;
  readonly windowMs?: number | undefined;
}

export interface DispatcherRegistryOptions {
  readonly defaultPlatform?: NotificationPlatform | undefined;
  readonly rateLimiter?: RateLimiterOptions | undefined;
}

export interface DispatchEventRecord {
  readonly timestamp: number;
  readonly title: string;
  readonly platform: string;
  readonly success: boolean;
}
