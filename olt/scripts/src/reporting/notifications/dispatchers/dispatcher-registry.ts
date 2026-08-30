import type { NotificationPayload, NotificationPlatform } from "../types.ts";
import { DarwinNotificationDispatcher } from "./darwin-dispatcher.ts";
import { HeadlessNotificationDispatcher } from "./headless-dispatcher.ts";
import { LinuxNotificationDispatcher } from "./linux-dispatcher.ts";
import type {
  DispatchEventRecord,
  DispatcherRegistryOptions,
  INotificationDispatcher,
  PlatformNotificationDeliveryResult,
  PlatformNotificationOptions,
} from "./types.ts";
import { WindowsNotificationDispatcher } from "./windows-dispatcher.ts";

export class NotificationDispatcherRegistry {
  private readonly _dispatchers = new Map<string, INotificationDispatcher>();
  private readonly _defaultPlatform: NotificationPlatform;
  private readonly _maxPerWindow: number;
  private readonly _windowMs: number;
  private readonly _history: DispatchEventRecord[] = [];
  private readonly _recentTimestamps: number[] = [];

  constructor(options?: DispatcherRegistryOptions) {
    this._defaultPlatform = options?.defaultPlatform ?? process.platform;
    this._maxPerWindow = options?.rateLimiter?.maxNotificationsPerWindow ?? 30;
    this._windowMs = options?.rateLimiter?.windowMs ?? 60_000;

    this.registerDispatcher(new DarwinNotificationDispatcher());
    this.registerDispatcher(new LinuxNotificationDispatcher());
    this.registerDispatcher(new WindowsNotificationDispatcher());
    this.registerDispatcher(new HeadlessNotificationDispatcher("unknown"));
    this.registerDispatcher(new HeadlessNotificationDispatcher("aix"));
    this.registerDispatcher(new HeadlessNotificationDispatcher("freebsd"));
    this.registerDispatcher(new HeadlessNotificationDispatcher("openbsd"));
    this.registerDispatcher(new HeadlessNotificationDispatcher("sunos"));
  }

  registerDispatcher(dispatcher: INotificationDispatcher): void {
    this._dispatchers.set(dispatcher.platform, dispatcher);
  }

  getDispatcher(platform?: NotificationPlatform): INotificationDispatcher {
    const target = platform ?? this._defaultPlatform;
    const found = this._dispatchers.get(target);
    if (found) {
      return found;
    }
    return new HeadlessNotificationDispatcher(target);
  }

  getHistory(): readonly DispatchEventRecord[] {
    return this._history;
  }

  isRateLimited(): boolean {
    const now = Date.now();
    while (this._recentTimestamps.length > 0) {
      const earliest = this._recentTimestamps[0];
      if (earliest !== undefined && now - earliest > this._windowMs) {
        this._recentTimestamps.shift();
      } else {
        break;
      }
    }
    return this._recentTimestamps.length >= this._maxPerWindow;
  }

  dispatch(
    payload: NotificationPayload,
    options?: PlatformNotificationOptions & { platform?: NotificationPlatform | undefined },
  ): PlatformNotificationDeliveryResult {
    if (this.isRateLimited()) {
      return {
        delivered: false,
        error: `Notification rate limit exceeded (${this._maxPerWindow} notifications per ${this._windowMs}ms)`,
      };
    }

    const dispatcher = this.getDispatcher(options?.platform);
    const result = dispatcher.display(payload, options);

    this._recentTimestamps.push(Date.now());
    this._history.push({
      timestamp: Date.now(),
      title: payload.title,
      platform: dispatcher.platform,
      success: result.delivered,
    });
    while (this._history.length > 100) {
      this._history.shift();
    }

    if (payload.soundEnabled && !options?.silent) {
      dispatcher.chime(payload.soundFile, options);
    }

    return result;
  }
}

export const defaultDispatcherRegistry = new NotificationDispatcherRegistry();
