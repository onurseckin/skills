import { describe, expect, it } from "bun:test";
import { TimeoutWatcher } from "../../../olt/scripts/src/tooling/sandbox/timeout-watcher.ts";

describe("TimeoutWatcher Unit Test Suite", () => {
  it("initializes with correct parameters and idle state", () => {
    const watcher = new TimeoutWatcher({ timeoutMs: 100 });
    expect(watcher.getState()).toBe("idle");
    expect(watcher.isExpired()).toBe(false);
    expect(watcher.getElapsedMs()).toBe(0);
  });

  it("triggers abort signal and callback on timeout", async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(timeoutFired).toBe(true);
    expect(reportedElapsed).toBeGreaterThanOrEqual(40);
    expect(watcher.isExpired()).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(watcher.getState()).toBe("timed_out");
    watcher.dispose();
  });

  it("can be cancelled before timeout triggers", async () => {
    let timeoutFired = false;

    const watcher = new TimeoutWatcher({
      timeoutMs: 100,
      onTimeout: () => {
        timeoutFired = true;
      },
    });

    const signal = watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    watcher.cancel();

    expect(watcher.getState()).toBe("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(timeoutFired).toBe(false);
    expect(signal.aborted).toBe(false);
    watcher.dispose();
  });

  it("triggers grace period when configured", async () => {
    let gracePeriodFired = false;

    const watcher = new TimeoutWatcher({
      timeoutMs: 30,
      gracePeriodMs: 40,
      onGracePeriodExceeded: () => {
        gracePeriodFired = true;
      },
    });

    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(watcher.getState()).toBe("grace_period");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gracePeriodFired).toBe(true);
    watcher.dispose();
  });

  it("supports heartbeat keepalive to refresh activity", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 50));

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
