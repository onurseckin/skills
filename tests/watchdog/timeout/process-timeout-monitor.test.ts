import { describe, expect, it } from "bun:test";
import {
  monitorSubprocessLoop,
  ProcessTimeoutWatchdog,
  type BunSubprocess,
} from "../../../olt/scripts/src/watchdog/process-timeout/index.ts";

function createMockSubprocess(
  opts: { pid?: number; exited?: Promise<number> } = {},
): BunSubprocess {
  return {
    pid: opts.pid ?? 4321,
    exited: opts.exited ?? new Promise<number>(() => undefined),
    stdout: new ReadableStream() as ReadableStream<Uint8Array>,
    stderr: new ReadableStream() as ReadableStream<Uint8Array>,
  };
}

describe("monitorSubprocessLoop Execution & Liveness Checks", () => {
  it("resolves clean exit successfully when subprocess completes within limits", async () => {
    let now = 1700000000000;
    const watchdog = new ProcessTimeoutWatchdog({
      pid: 1001,
      wallTimeoutMs: 10_000,
      idleTimeoutMs: 5_000,
      heartbeatIntervalMs: 100,
      now: () => now,
      startedAt: now,
      wait: async () => {},
    });

    const proc = createMockSubprocess({
      pid: 1001,
      exited: Promise.resolve(0),
    });

    const result = await monitorSubprocessLoop(watchdog, proc);
    expect(result.outcome).toBe("exit");
    expect(result.exitCode).toBe(0);
    expect(result.signalsSent).toEqual([]);
  });

  it("handles wall timeout by dispatching SIGTERM/SIGKILL and synthesizing failure payload", async () => {
    let now = 1700000000000;
    const signalsSent: NodeJS.Signals[] = [];

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 1002,
      wallTimeoutMs: 50,
      idleTimeoutMs: 100,
      heartbeatIntervalMs: 10,
      graceMs: 10,
      now: () => now,
      startedAt: now,
      killProcessTree: (_, sig) => {
        signalsSent.push(sig);
        return true;
      },
      wait: async () => {},
    });

    const proc = createMockSubprocess({
      pid: 1002,
      exited: new Promise(() => {}),
    });

    let heartbeats = 0;
    const monitorPromise = monitorSubprocessLoop(watchdog, proc, () => {
      heartbeats++;
      now += 60; // Advance time past wallTimeout
    });

    const result = await monitorPromise;
    expect(result.outcome).toBe("timeout");
    expect(result.exitCode).toBeNull();
    expect(result.failurePayload?.exitStatus).toBe("SIGKILL_TIMEOUT");
    expect(result.failurePayload?.errorClassification).toBe("WALL_TIMEOUT");
    expect(signalsSent).toEqual(["SIGTERM", "SIGKILL"]);
    expect(heartbeats).toBeGreaterThan(0);
  });

  it("handles abort signal interruption by enforcing SIGKILL and returning interrupted outcome", async () => {
    let now = 1700000000000;
    const signalsSent: NodeJS.Signals[] = [];

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 1003,
      wallTimeoutMs: 10_000,
      idleTimeoutMs: 5_000,
      graceMs: 0,
      now: () => now,
      startedAt: now,
      killProcessTree: (_, sig) => {
        signalsSent.push(sig);
        return true;
      },
      wait: async () => {},
    });

    const proc = createMockSubprocess({
      pid: 1003,
      exited: new Promise(() => {}),
    });

    const controller = new AbortController();
    controller.abort();

    const result = await monitorSubprocessLoop(watchdog, proc, undefined, controller.signal);
    expect(result.outcome).toBe("interrupted");
    expect(result.failurePayload?.errorClassification).toBe("PROCESS_HANG");
    expect(signalsSent).toEqual(["SIGKILL"]);
  });
});
