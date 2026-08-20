import type {
  AutoWakeAction,
  AutoWakeResult,
  HealthCheckResult,
  MonitorState,
  WatchdogConfig,
  WatchdogEvent,
  WatchdogEventType,
} from "./types.ts";

export interface RegisterMonitorOptions {
  readonly agentId: string;
  readonly taskId?: string | undefined;
  readonly runId?: string | undefined;
  readonly initialStartedAt?: number | undefined;
}

export type WatchdogEventListener = (event: WatchdogEvent) => void;

export class OrchestratorWatchdog {
  private readonly monitors = new Map<string, MonitorState>();
  private readonly listeners = new Map<WatchdogEventType | "*", Set<WatchdogEventListener>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  public readonly heartbeatTimeoutMs: number;
  public readonly idleTimeoutMs: number;
  public readonly wallClockTimeoutMs: number;
  public readonly pollIntervalMs: number;
  public readonly maxWakeRetries: number;
  public readonly autoWakeAction: AutoWakeAction;

  public constructor(config: WatchdogConfig = {}) {
    this.heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? 60_000;
    this.idleTimeoutMs = config.idleTimeoutMs ?? 120_000;
    this.wallClockTimeoutMs = config.wallClockTimeoutMs ?? 3_600_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 1_000;
    this.maxWakeRetries = config.maxWakeRetries ?? 3;
    // Config default alongside its sibling timeouts above, not a substitute for a missing value.
    this.autoWakeAction = config.autoWakeAction ?? "nudge";
  }

  public registerMonitor(id: string, options: RegisterMonitorOptions): MonitorState {
    const now = Date.now();
    const monitor: MonitorState = {
      id,
      agentId: options.agentId,
      taskId: options.taskId,
      runId: options.runId,
      startedAt: options.initialStartedAt ?? now,
      lastHeartbeatAt: now,
      lastActivityAt: now,
      wakeAttempts: 0,
      status: "active",
    };
    this.monitors.set(id, monitor);
    return monitor;
  }

  public unregisterMonitor(id: string): boolean {
    const monitor = this.monitors.get(id);
    if (monitor) {
      monitor.status = "closed";
      this.monitors.delete(id);
      return true;
    }
    return false;
  }

  public recordHeartbeat(agentId: string, taskId?: string, runId?: string): boolean {
    const now = Date.now();
    let updated = false;
    for (const monitor of this.monitors.values()) {
      if (
        monitor.agentId === agentId &&
        (taskId === undefined || monitor.taskId === taskId) &&
        (runId === undefined || monitor.runId === runId)
      ) {
        monitor.lastHeartbeatAt = now;
        monitor.lastActivityAt = now;
        if (monitor.status === "stalled") {
          monitor.status = "active";
          monitor.wakeAttempts = 0;
          this.emit({
            type: "recovered",
            timestamp: new Date(now).toISOString(),
            monitorId: monitor.id,
            agentId: monitor.agentId,
            taskId: monitor.taskId,
            runId: monitor.runId,
            details: "Heartbeat received; monitor recovered from stalled state.",
          });
        }
        updated = true;
      }
    }
    return updated;
  }

  public recordActivity(agentId: string, taskId?: string, runId?: string): boolean {
    const now = Date.now();
    let updated = false;
    for (const monitor of this.monitors.values()) {
      if (
        monitor.agentId === agentId &&
        (taskId === undefined || monitor.taskId === taskId) &&
        (runId === undefined || monitor.runId === runId)
      ) {
        monitor.lastActivityAt = now;
        updated = true;
      }
    }
    return updated;
  }

  public getMonitor(id: string): MonitorState | undefined {
    return this.monitors.get(id);
  }

  public getAllMonitors(): readonly MonitorState[] {
    return Array.from(this.monitors.values());
  }

  public checkHealth(currentTime?: number): HealthCheckResult {
    const now = currentTime ?? Date.now();
    let activeCount = 0;
    let stalledCount = 0;
    let timedOutCount = 0;

    for (const monitor of this.monitors.values()) {
      if (monitor.status === "closed") continue;

      const elapsedWall = now - monitor.startedAt;
      const elapsedHeartbeat = now - monitor.lastHeartbeatAt;
      const elapsedIdle = now - monitor.lastActivityAt;

      if (elapsedWall >= this.wallClockTimeoutMs) {
        monitor.status = "timed_out";
        timedOutCount++;
        this.emit({
          type: "timeout",
          timestamp: new Date(now).toISOString(),
          monitorId: monitor.id,
          agentId: monitor.agentId,
          taskId: monitor.taskId,
          runId: monitor.runId,
          details: `Wall clock timeout exceeded: ${elapsedWall}ms >= ${this.wallClockTimeoutMs}ms`,
        });
      } else if (elapsedHeartbeat >= this.heartbeatTimeoutMs || elapsedIdle >= this.idleTimeoutMs) {
        if (monitor.status !== "stalled" && monitor.status !== "escalated") {
          monitor.status = "stalled";
          stalledCount++;
          this.emit({
            type: "stall_detected",
            timestamp: new Date(now).toISOString(),
            monitorId: monitor.id,
            agentId: monitor.agentId,
            taskId: monitor.taskId,
            runId: monitor.runId,
            details: `Heartbeat or idle timeout exceeded: heartbeat=${elapsedHeartbeat}ms, idle=${elapsedIdle}ms`,
          });
        } else if (monitor.status === "stalled") {
          stalledCount++;
        }
      } else {
        monitor.status = "active";
        activeCount++;
      }
    }

    const healthy = stalledCount === 0 && timedOutCount === 0;
    return {
      healthy,
      activeCount,
      stalledCount,
      timedOutCount,
      monitors: Array.from(this.monitors.values()),
    };
  }

  public triggerAutoWake(monitorId: string, reason?: string): AutoWakeResult {
    const now = Date.now();
    const monitor = this.monitors.get(monitorId);
    if (!monitor) {
      return {
        monitorId,
        actionTaken: this.autoWakeAction,
        attempt: 0,
        succeeded: false,
        message: `Monitor not found: ${monitorId}`,
      };
    }

    monitor.wakeAttempts++;

    if (monitor.wakeAttempts > this.maxWakeRetries) {
      monitor.status = "escalated";
      this.emit({
        type: "escalated",
        timestamp: new Date(now).toISOString(),
        monitorId,
        agentId: monitor.agentId,
        taskId: monitor.taskId,
        runId: monitor.runId,
        details: `Max wake attempts (${this.maxWakeRetries}) exceeded. Escalating to human/coordinator. Reason: ${reason ?? "unknown"}`,
        attempt: monitor.wakeAttempts,
      });

      return {
        monitorId,
        actionTaken: "escalate",
        attempt: monitor.wakeAttempts,
        succeeded: false,
        message: `Max wake attempts exceeded for monitor ${monitorId}; escalated.`,
      };
    }

    this.emit({
      type: "auto_wake",
      timestamp: new Date(now).toISOString(),
      monitorId,
      agentId: monitor.agentId,
      taskId: monitor.taskId,
      runId: monitor.runId,
      details: `Auto-wake attempt ${monitor.wakeAttempts}/${this.maxWakeRetries} via action "${this.autoWakeAction}". Reason: ${reason ?? "unknown"}`,
      attempt: monitor.wakeAttempts,
    });

    return {
      monitorId,
      actionTaken: this.autoWakeAction,
      attempt: monitor.wakeAttempts,
      succeeded: true,
      message: `Auto-wake triggered successfully via ${this.autoWakeAction}`,
    };
  }

  public on(event: WatchdogEventType | "*", listener: WatchdogEventListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  private emit(event: WatchdogEvent): void {
    const specific = this.listeners.get(event.type);
    if (specific) {
      for (const listener of specific) {
        try {
          listener(event);
        } catch {
          // Guard listener exceptions
        }
      }
    }
    const wildcard = this.listeners.get("*");
    if (wildcard) {
      for (const listener of wildcard) {
        try {
          listener(event);
        } catch {
          // Guard listener exceptions
        }
      }
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      const health = this.checkHealth();
      if (!health.healthy) {
        for (const mon of health.monitors) {
          if (mon.status === "stalled") {
            this.triggerAutoWake(mon.id, "Periodic health poll detected stall");
          }
        }
      }
    }, this.pollIntervalMs);
    // Unref timer so node/bun process can exit cleanly
    if (typeof this.timer === "object" && this.timer !== null && "unref" in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  public stop(): void {
    if (!this.isRunning) return;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  public dispose(): void {
    this.stop();
    this.monitors.clear();
    this.listeners.clear();
  }

  public isMonitoring(): boolean {
    return this.isRunning;
  }
}
