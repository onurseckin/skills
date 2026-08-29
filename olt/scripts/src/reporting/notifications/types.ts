export type NotificationPlatform =
  | "darwin"
  | "linux"
  | "win32"
  | "aix"
  | "freebsd"
  | "openbsd"
  | "sunos"
  | "android"
  | "haiku"
  | "cygwin"
  | "netbsd"
  | string;

export interface NotificationProcessSpawnResult {
  readonly pid?: number | undefined;
  readonly unref?: (() => void) | undefined;
}

export type NotificationProcessSpawner = (
  command: string,
  args: readonly string[],
  options?: {
    detached?: boolean | undefined;
    stdio?: "ignore" | "pipe" | "inherit" | undefined;
    shell?: boolean | undefined;
  },
) => NotificationProcessSpawnResult | void;

export interface PhaseCompletionNotificationOptions {
  readonly phaseName: string;
  readonly commitSha?: string | undefined;
  readonly taskCount?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly soundEnabled?: boolean | undefined;
  readonly soundFile?: string | undefined;
  readonly title?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly details?: string | undefined;
  readonly platform?: NotificationPlatform | undefined;
  readonly customSpawn?: NotificationProcessSpawner | undefined;
  readonly silent?: boolean | undefined;
}

export interface NotificationPayload {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly message: string;
  readonly soundFile?: string | undefined;
  readonly soundEnabled: boolean;
}

export interface NotificationResult {
  readonly success: boolean;
  readonly visualDelivered: boolean;
  readonly audioDelivered: boolean;
  readonly platform: string;
  readonly payload: NotificationPayload;
  readonly error?: string | undefined;
  readonly visualCommand?: string | undefined;
  readonly audioCommand?: string | undefined;
}

export const DEFAULT_DARWIN_NOTIFICATION_SOUND = "/System/Library/Sounds/Glass.aiff" as const;
export const DEFAULT_LINUX_NOTIFICATION_SOUND =
  "/usr/share/sounds/freedesktop/stereo/complete.oga" as const;
