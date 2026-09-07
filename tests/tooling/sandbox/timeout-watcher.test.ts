import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { TimeoutWatcher } from "../../../olt/scripts/src/tooling/sandbox/timeout-watcher.ts";

interface ScheduledTask {
  id: number;
  runAt: number;
  interval?: number;
  callback: () => void;
  cleared: boolean;
}

class VirtualClock {
  private currentTime = 1000;
  private nextId = 1;
  private tasks = new Map<number, ScheduledTask>();

  private origPerformanceNow = performance.now;
  private origSetTimeout = globalThis.setTimeout;
  private origClearTimeout = globalThis.clearTimeout;
  private origSetInterval = globalThis.setInterval;
  private origClearInterval = globalThis.clearInterval;

  public install(): void {
    this.currentTime = 1000;
    this.nextId = 1;
    this.tasks.clear();

    performance.now = () => this.currentTime;

    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]): any => {
      const id = this.nextId++;
      const ms = Math.max(0, timeout ?? 0);
      const runAt = this.currentTime + ms;
      const callback = typeof handler === "function" ? () => handler(...args) : () => {};
      this.tasks.set(id, { id, runAt, callback, cleared: false });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    globalThis.clearTimeout = ((id?: unknown): void => {
      if (typeof id === "number") {
        const task = this.tasks.get(id);
        if (task) {
          task.cleared = true;
          this.tasks.delete(id);
        }
      }
    }) as typeof clearTimeout;

    globalThis.setInterval = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): any => {
      const id = this.nextId++;
      const ms = Math.max(1, timeout ?? 1);
      const runAt = this.currentTime + ms;
      const callback = typeof handler === "function" ? () => handler(...args) : () => {};
      this.tasks.set(id, { id, runAt, interval: ms, callback, cleared: false });
      return id as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;

    globalThis.clearInterval = ((id?: unknown): void => {
      if (typeof id === "number") {
        const task = this.tasks.get(id);
        if (task) {
          task.cleared = true;
          this.tasks.delete(id);
        }
      }
    }) as typeof clearInterval;
  }

  public uninstall(): void {
    performance.now = this.origPerformanceNow;
    globalThis.setTimeout = this.origSetTimeout;
    globalThis.clearTimeout = this.origClearTimeout;
    globalThis.setInterval = this.origSetInterval;
    globalThis.clearInterval = this.origClearInterval;
    this.tasks.clear();
  }

  public tick(ms: number): void {
    const targetTime = this.currentTime + ms;
    let guard = 0;
    while (guard++ < 10000) {
      let earliest: ScheduledTask | null = null;
      for (const task of this.tasks.values()) {
        if (task.cleared) continue;
        if (task.runAt <= targetTime) {
          if (
            !earliest ||
            task.runAt < earliest.runAt ||
            (task.runAt === earliest.runAt && task.id < earliest.id)
          ) {
            earliest = task;
          }
        }
      }

      if (!earliest) {
        this.currentTime = targetTime;
        break;
      }

      this.currentTime = earliest.runAt;

      if (earliest.interval !== undefined) {
        earliest.runAt = this.currentTime + earliest.interval;
      } else {
        this.tasks.delete(earliest.id);
      }

      earliest.callback();
    }
  }
}

describe("TimeoutWatcher Unit Test Suite", () => {
  let clock: VirtualClock;

  beforeEach(() => {
    clock = new VirtualClock();
    clock.install();
  });

  afterEach(() => {
    clock.uninstall();
  });

  it("initializes with correct parameters and idle state", () => {
    const watcher = new TimeoutWatcher({ timeoutMs: 100 });
    expect(watcher.getState()).toBe("idle");
    expect(watcher.isExpired()).toBe(false);
    expect(watcher.getElapsedMs()).toBe(0);
  });

  it("triggers abort signal and callback on timeout", () => {
    let timeoutFired = false;
    let reportedElapsed = 0;

    const watcher = new TimeoutWatcher({
      timeoutMs: 50,
      onTimeout: (elapsed) => {
        timeoutFired = true;
        reportedElapsed = elapsed;
      },
    });

    const signal = watcher.start();
    expect(watcher.getState()).toBe("running");
    expect(signal.aborted).toBe(false);

    clock.tick(80);

    expect(timeoutFired).toBe(true);
    expect(reportedElapsed).toBeGreaterThanOrEqual(40);
    expect(watcher.isExpired()).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(watcher.getState()).toBe("timed_out");
    watcher.dispose();
  });

  it("can be cancelled before timeout triggers", () => {
    let timeoutFired = false;

    const watcher = new TimeoutWatcher({
      timeoutMs: 100,
      onTimeout: () => {
        timeoutFired = true;
      },
    });

    const signal = watcher.start();
    clock.tick(20);
    watcher.cancel();

    expect(watcher.getState()).toBe("cancelled");
    clock.tick(100);

    expect(timeoutFired).toBe(false);
    expect(signal.aborted).toBe(false);
    watcher.dispose();
  });

  it("triggers grace period when configured", () => {
    let gracePeriodFired = false;

    const watcher = new TimeoutWatcher({
      timeoutMs: 30,
      gracePeriodMs: 40,
      onGracePeriodExceeded: () => {
        gracePeriodFired = true;
      },
    });

    watcher.start();
    clock.tick(40);
    expect(watcher.getState()).toBe("grace_period");

    clock.tick(50);
    expect(gracePeriodFired).toBe(true);
    watcher.dispose();
  });

  it("supports heartbeat keepalive to refresh activity", () => {
    let heartbeats = 0;

    const watcher = new TimeoutWatcher({
      timeoutMs: 100,
      heartbeatIntervalMs: 20,
      onHeartbeat: () => {
        heartbeats++;
      },
    });

    watcher.start();
    watcher.heartbeat();
    clock.tick(50);

    expect(heartbeats).toBeGreaterThanOrEqual(1);
    watcher.dispose();
    expect(watcher.getState()).toBe("disposed");
  });

  it("prevents double start", () => {
    const watcher = new TimeoutWatcher({ timeoutMs: 100 });
    watcher.start();
    expect(() => watcher.start()).toThrow("TimeoutWatcher is already running");
    watcher.dispose();
  });
});
