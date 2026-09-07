import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { daemonHealthPath, roomLogDir, roomLogIndexPath } from "../core/index.ts";
import { readHealthRecord, writeHealthRecord } from "./health.ts";

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

export interface WatcherHandle {
  close: () => void;
  on: (event: "error", listener: () => void) => void;
}

export interface DaemonWatcherPorts {
  readonly existsSync?: (path: string) => boolean;
  readonly watch?: (
    path: string,
    options: { persistent?: boolean },
    listener: (event: string, filename: string | null) => void,
  ) => WatcherHandle | FSWatcher;
  readonly readdirSync?: (path: string) => string[];
  readonly readFileSync?: (path: string, encoding: string) => string;
  readonly statSync?: (path: string) => { size: number; ino?: number };
  readonly writeAtomic?: (path: string, content: string) => void;
  readonly writeFileSync?: (path: string, content: string) => void;
}

export interface DaemonWatcherOptions {
  readonly pollIntervalMs?: number;
  readonly retryDelayMs?: number;
  readonly ports?: DaemonWatcherPorts | undefined;
  readonly reader?: string | undefined;
  readonly healthPath?: string | undefined;
  readonly onStatusChange?: ((metrics: WatcherMetrics) => void) | undefined;
}

const MIN_POLL_INTERVAL_MS = 250;
const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_RETRY_DELAY_MS = 1000;

export function computeChangeToken(roomId: string, ports?: DaemonWatcherPorts): ChangeToken {
  let nextSeq = 0;
  const indexPath = roomLogIndexPath(roomId);
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;

  if (existsFn(indexPath)) {
    try {
      const raw = readFn(indexPath, "utf8");
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
  const readdirFn = ports?.readdirSync ?? readdirSync;
  const statFn = ports?.statSync ?? statSync;

  if (existsFn(logDir)) {
    try {
      const entries = readdirFn(logDir)
        .filter((name) => name.endsWith(".jsonl"))
        .sort();
      if (entries.length > 0) {
        const headName = entries[entries.length - 1];
        if (headName) {
          const headPath = join(logDir, headName);
          const stats = statFn(headPath);
          headSegmentSize = stats.size;
          headSegmentInode = typeof stats.ino === "number" ? stats.ino : 0;
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
  private readonly reader?: string | undefined;
  private readonly healthPath?: string | undefined;
  private readonly ports?: DaemonWatcherPorts | undefined;
  private readonly retryDelayMs: number;
  private readonly configuredPollIntervalMs: number;
  private onStatusChange?: ((metrics: WatcherMetrics) => void) | undefined;
  private watchFailures = 0;
  private watchActive = false;
  private dirWatcher: WatcherHandle | FSWatcher | null = null;
  private indexWatcher: WatcherHandle | FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastToken: ChangeToken;
  private isRunning = false;
  private onWakeCallback:
    | ((source: WakeSource, tokenChanged: boolean) => void | Promise<void>)
    | null = null;

  constructor(roomId: string, options: DaemonWatcherOptions = {}) {
    this.roomId = roomId;
    this.reader = options.reader;
    this.healthPath = options.healthPath;
    this.ports = options.ports;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.onStatusChange = options.onStatusChange;
    const requested = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const minInterval = options.ports ? 1 : MIN_POLL_INTERVAL_MS;
    this.configuredPollIntervalMs = Math.max(minInterval, requested);
    this.lastToken = computeChangeToken(roomId, this.ports);
  }

  public setOnStatusChange(cb?: (metrics: WatcherMetrics) => void): void {
    this.onStatusChange = cb;
  }

  public getMetrics(): WatcherMetrics {
    return {
      watch_active: this.watchActive,
      watch_failures: this.watchFailures,
      poll_interval_ms: this.configuredPollIntervalMs,
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
    this.cancelRetry();
    this.teardownWatchers();
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public async triggerWake(source: WakeSource): Promise<void> {
    const currentToken = computeChangeToken(this.roomId, this.ports);
    const tokenChanged = hasTokenChanged(this.lastToken, currentToken);
    this.lastToken = currentToken;

    if (this.onWakeCallback) {
      await this.onWakeCallback(source, tokenChanged);
    }
  }

  private scheduleRetry(): void {
    if (!this.isRunning || this.retryTimer !== null) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.isRunning) {
        this.setupWatchers();
      }
    }, this.retryDelayMs);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setupWatchers(): void {
    const existsFn = this.ports?.existsSync ?? existsSync;
    const watchFn = this.ports?.watch ?? watch;
    const logDir = roomLogDir(this.roomId);
    const indexPath = roomLogIndexPath(this.roomId);

    if (this.dirWatcher === null) {
      try {
        if (existsFn(logDir)) {
          this.dirWatcher = watchFn(logDir, { persistent: false }, () => {
            void this.handleWatchEvent();
          });
          this.dirWatcher.on("error", () => {
            this.handleWatchError("dir");
          });
        }
      } catch {
        this.handleWatchError("dir");
      }
    }

    if (this.indexWatcher === null) {
      try {
        if (existsFn(indexPath)) {
          this.indexWatcher = watchFn(indexPath, { persistent: false }, () => {
            void this.handleWatchEvent();
          });
          this.indexWatcher.on("error", () => {
            this.handleWatchError("index");
          });
        }
      } catch {
        this.handleWatchError("index");
      }
    }

    this.watchActive = this.dirWatcher !== null || this.indexWatcher !== null;
    this.syncHealth();

    if (this.dirWatcher === null || this.indexWatcher === null) {
      this.scheduleRetry();
    } else {
      this.cancelRetry();
    }
  }

  private teardownWatchers(): void {
    if (this.dirWatcher !== null) {
      try {
        this.dirWatcher.close();
      } catch {}
      this.dirWatcher = null;
    }
    if (this.indexWatcher !== null) {
      try {
        this.indexWatcher.close();
      } catch {}
      this.indexWatcher = null;
    }
    this.watchActive = false;
    this.syncHealth();
  }

  private handleWatchError(target: "dir" | "index" | "all" = "all"): void {
    this.watchFailures++;
    if (target === "dir" || target === "all") {
      if (this.dirWatcher !== null) {
        try {
          this.dirWatcher.close();
        } catch {}
        this.dirWatcher = null;
      }
    }
    if (target === "index" || target === "all") {
      if (this.indexWatcher !== null) {
        try {
          this.indexWatcher.close();
        } catch {}
        this.indexWatcher = null;
      }
    }
    this.watchActive = this.dirWatcher !== null || this.indexWatcher !== null;
    this.syncHealth();
    this.scheduleRetry();
  }

  private syncHealth(): void {
    const targetPath =
      this.healthPath ?? (this.reader ? daemonHealthPath(this.roomId, this.reader) : undefined);
    if (targetPath) {
      const health = readHealthRecord(targetPath, this.ports);
      if (health) {
        const nowIso = new Date().toISOString();
        writeHealthRecord(
          targetPath,
          {
            ...health,
            watch_active: this.watchActive,
            watch_failures: this.watchFailures,
            poll_interval_ms: this.configuredPollIntervalMs,
            updated_at: nowIso,
          },
          this.ports,
        );
      }
    }
    if (this.onStatusChange) {
      this.onStatusChange(this.getMetrics());
    }
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
      if (this.dirWatcher === null || this.indexWatcher === null) {
        this.setupWatchers();
      }
      void this.triggerWake("poll");
    }, this.configuredPollIntervalMs);
  }
}
