export interface TimeoutWatcherOptions {
  readonly timeoutMs: number;
  readonly gracePeriodMs?: number | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly onTimeout?: ((elapsedMs: number) => void) | undefined;
  readonly onGracePeriodExceeded?: ((elapsedMs: number) => void) | undefined;
  readonly onHeartbeat?: ((lastHeartbeatTime: number) => void) | undefined;
}

export type WatcherState = "idle" | "running" | "timed_out" | "grace_period" | "cancelled" | "disposed";

export class TimeoutWatcher {
  private readonly timeoutMs: number;
  private readonly gracePeriodMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly onTimeoutCallback?: ((elapsedMs: number) => void) | undefined;
  private readonly onGracePeriodExceededCallback?: ((elapsedMs: number) => void) | undefined;
  private readonly onHeartbeatCallback?: ((lastHeartbeatTime: number) => void) | undefined;

  private abortController: AbortController | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private graceTimerId: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimerId: ReturnType<typeof setInterval> | null = null;
  private startTime: number = 0;
  private lastHeartbeatTime: number = 0;
  private state: WatcherState = "idle";

  constructor(options: TimeoutWatcherOptions) {
    this.timeoutMs = Math.max(1, options.timeoutMs);
    this.gracePeriodMs = Math.max(0, options.gracePeriodMs ?? 0);
    this.heartbeatIntervalMs = Math.max(0, options.heartbeatIntervalMs ?? 0);
    this.onTimeoutCallback = options.onTimeout;
    this.onGracePeriodExceededCallback = options.onGracePeriodExceeded;
    this.onHeartbeatCallback = options.onHeartbeat;
  }

  public start(): AbortSignal {
    if (this.state === "running") {
      throw new Error("TimeoutWatcher is already running");
    }
    this.dispose();

    this.abortController = new AbortController();
    this.startTime = performance.now();
    this.lastHeartbeatTime = this.startTime;
    this.state = "running";

    this.timerId = setTimeout(() => {
      this.handleTimeout();
    }, this.timeoutMs);

    if (this.heartbeatIntervalMs > 0) {
      this.heartbeatTimerId = setInterval(() => {
        this.checkHeartbeat();
      }, this.heartbeatIntervalMs);
    }

    return this.abortController.signal;
  }

  public heartbeat(): void {
    if (this.state !== "running") return;
    this.lastHeartbeatTime = performance.now();
    this.onHeartbeatCallback?.(this.lastHeartbeatTime);
  }

  public getElapsedMs(): number {
    if (this.startTime === 0) return 0;
    return performance.now() - this.startTime;
  }

  public getState(): WatcherState {
    return this.state;
  }

  public isExpired(): boolean {
    return this.state === "timed_out" || this.state === "grace_period";
  }

  public cancel(): void {
    if (this.state === "disposed" || this.state === "cancelled") return;
    this.clearAllTimers();
    this.state = "cancelled";
  }

  public dispose(): void {
    this.clearAllTimers();
    this.abortController = null;
    this.state = "disposed";
    this.startTime = 0;
  }

  private clearAllTimers(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.graceTimerId !== null) {
      clearTimeout(this.graceTimerId);
      this.graceTimerId = null;
    }
    if (this.heartbeatTimerId !== null) {
      clearInterval(this.heartbeatTimerId);
      this.heartbeatTimerId = null;
    }
  }

  private handleTimeout(): void {
    if (this.state !== "running") return;
    const elapsed = this.getElapsedMs();
    this.state = "timed_out";
    this.abortController?.abort(new Error(`Execution timed out after ${Math.round(elapsed)}ms`));
    this.onTimeoutCallback?.(elapsed);

    if (this.gracePeriodMs > 0) {
      this.state = "grace_period";
      this.graceTimerId = setTimeout(() => {
        if (this.state === "grace_period") {
          const totalElapsed = this.getElapsedMs();
          this.onGracePeriodExceededCallback?.(totalElapsed);
        }
      }, this.gracePeriodMs);
    }
  }

  private checkHeartbeat(): void {
    if (this.state !== "running") return;
    const now = performance.now();
    const timeSinceLastHeartbeat = now - this.lastHeartbeatTime;
    if (timeSinceLastHeartbeat > this.heartbeatIntervalMs * 2) {
      this.handleTimeout();
    }
  }
}
