import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { roomLogDir, roomLogIndexPath } from "../core/index.ts";

export type WakeSource = "watch" | "poll" | "tick" | "token";

export interface ChangeToken {
  readonly next_seq: number;
  readonly head_segment_size: number;
  readonly head_segment_inode: number;
}

export interface WatcherMetrics {
  readonly watch_active: boolean;
  readonly watch_failures: number;
  readonly poll_interval_ms: number;
}

export interface DaemonWatcherOptions {
  readonly pollIntervalMs?: number;
}

const MIN_POLL_INTERVAL_MS = 250;
const DEFAULT_POLL_INTERVAL_MS = 750;

export function computeChangeToken(roomId: string): ChangeToken {
  let nextSeq = 0;
  const indexPath = roomLogIndexPath(roomId);

  if (existsSync(indexPath)) {
    try {
      const raw = readFileSync(indexPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "next_seq" in parsed &&
        typeof (parsed as { next_seq: unknown }).next_seq === "number"
      ) {
        nextSeq = (parsed as { next_seq: number }).next_seq;
      }
    } catch {}
  }

  let headSegmentSize = 0;
  let headSegmentInode = 0;
  const logDir = roomLogDir(roomId);

  if (existsSync(logDir)) {
    try {
      const entries = readdirSync(logDir)
        .filter((name) => name.endsWith(".jsonl"))
        .sort();
      if (entries.length > 0) {
        const headName = entries[entries.length - 1];
        if (headName) {
          const headPath = join(logDir, headName);
          const stats = statSync(headPath);
          headSegmentSize = stats.size;
          headSegmentInode = stats.ino;
        }
      }
    } catch {}
  }

  return {
    next_seq: nextSeq,
    head_segment_size: headSegmentSize,
    head_segment_inode: headSegmentInode,
  };
}

export function hasTokenChanged(prev: ChangeToken, current: ChangeToken): boolean {
  return (
    prev.next_seq !== current.next_seq ||
    prev.head_segment_size !== current.head_segment_size ||
    prev.head_segment_inode !== current.head_segment_inode
  );
}

export class DaemonWatcher {
  private readonly roomId: string;
  private configuredPollIntervalMs: number;
  private currentPollIntervalMs: number;
  private watchFailures = 0;
  private watchActive = false;
  private dirWatcher: FSWatcher | null = null;
  private indexWatcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastToken: ChangeToken;
  private isRunning = false;
  private onWakeCallback:
    | ((source: WakeSource, tokenChanged: boolean) => void | Promise<void>)
    | null = null;

  constructor(roomId: string, options: DaemonWatcherOptions = {}) {
    this.roomId = roomId;
    const requested = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.configuredPollIntervalMs = Math.max(MIN_POLL_INTERVAL_MS, requested);
    this.currentPollIntervalMs = this.configuredPollIntervalMs;
    this.lastToken = computeChangeToken(roomId);
  }

  public getMetrics(): WatcherMetrics {
    return {
      watch_active: this.watchActive,
      watch_failures: this.watchFailures,
      poll_interval_ms: this.currentPollIntervalMs,
    };
  }

  public getCurrentToken(): ChangeToken {
    return this.lastToken;
  }

  public start(onWake: (source: WakeSource, tokenChanged: boolean) => void | Promise<void>): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.onWakeCallback = onWake;

    this.setupWatchers();
    this.startPollLoop();
  }

  public stop(): void {
    this.isRunning = false;
    this.onWakeCallback = null;
    this.teardownWatchers();
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public async triggerWake(source: WakeSource): Promise<void> {
    const currentToken = computeChangeToken(this.roomId);
    const tokenChanged = hasTokenChanged(this.lastToken, currentToken);
    this.lastToken = currentToken;

    if (this.onWakeCallback) {
      await this.onWakeCallback(source, tokenChanged);
    }
  }

  private setupWatchers(): void {
    this.teardownWatchers();
    const logDir = roomLogDir(this.roomId);
    const indexPath = roomLogIndexPath(this.roomId);

    try {
      if (existsSync(logDir)) {
        this.dirWatcher = watch(logDir, { persistent: false }, () => {
          void this.handleWatchEvent();
        });
        this.dirWatcher.on("error", () => {
          this.handleWatchError();
        });
      }

      if (existsSync(indexPath)) {
        this.indexWatcher = watch(indexPath, { persistent: false }, () => {
          void this.handleWatchEvent();
        });
        this.indexWatcher.on("error", () => {
          this.handleWatchError();
        });
      }

      this.watchActive = this.dirWatcher !== null || this.indexWatcher !== null;
    } catch {
      this.handleWatchError();
    }
  }

  private teardownWatchers(): void {
    if (this.dirWatcher) {
      try {
        this.dirWatcher.close();
      } catch {}
      this.dirWatcher = null;
    }
    if (this.indexWatcher) {
      try {
        this.indexWatcher.close();
      } catch {}
      this.indexWatcher = null;
    }
    this.watchActive = false;
  }

  private handleWatchError(): void {
    this.watchFailures++;
    this.watchActive = false;
    this.teardownWatchers();
    this.currentPollIntervalMs = MIN_POLL_INTERVAL_MS;
    this.restartPollLoop();

    setTimeout(() => {
      if (this.isRunning) {
        this.setupWatchers();
      }
    }, 1000);
  }

  private async handleWatchEvent(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    await this.triggerWake("watch");
  }

  private startPollLoop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
    }
    this.pollTimer = setInterval(() => {
      if (!this.isRunning) {
        return;
      }
      void this.triggerWake("poll");
    }, this.currentPollIntervalMs);
  }

  private restartPollLoop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.isRunning) {
      this.startPollLoop();
    }
  }
}
