import { describe, expect, test } from "bun:test";
import {
  ERROR_CLASS_PROCESS_HANG,
  ERROR_CLASS_WALL_TIMEOUT,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  ProcessTimeoutWatchdog,
} from "../../../../olt/scripts/src/engine/runner/process/process-timeout-watchdog.ts";
import type { BunSubprocess } from "../../../../olt/scripts/src/engine/runner/types/types.ts";

function createFakeSubprocess(
  options: {
    pid?: number;
    exited?: Promise<number>;
    stdout?: ReadableStream<Uint8Array>;
    stderr?: ReadableStream<Uint8Array>;
  } = {},
): BunSubprocess {
  return {
    pid: options.pid ?? 4321,
    exited: options.exited ?? new Promise<number>(() => undefined),
    stdout: options.stdout ?? (new ReadableStream() as ReadableStream<Uint8Array>),
    stderr: options.stderr ?? (new ReadableStream() as ReadableStream<Uint8Array>),
  };
}

describe("ProcessTimeoutWatchdog - Subprocess Monitoring Loop", () => {
  test("monitors process and returns exit code when subprocess finishes normally", async () => {
    const child = createFakeSubprocess({
      exited: Promise.resolve(0),
    });

    const watchdog = new ProcessTimeoutWatchdog();
    const result = await watchdog.monitorSubprocess(child);

    expect(result.outcome).toBe("exit");
    expect(result.exitCode).toBe(0);
  });

  test("detects wall timeout, SIGKILLs process, and returns structured failure payload", async () => {
    const signalsReceived: NodeJS.Signals[] = [];

    const child = createFakeSubprocess({
      pid: 6543,
      exited: new Promise(() => undefined),
    });

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 6543,
      startedAt: Date.now() - 1_000,
      wallTimeoutMs: 10,
      idleTimeoutMs: 10_000,
      graceMs: 0,
      killProcessTree: (_pid, sig) => {
        signalsReceived.push(sig);
        return true;
      },
    });

    const result = await watchdog.monitorSubprocess(child);

    expect(result.outcome).toBe("timeout");
    expect(result.exitCode).toBeNull();
    expect(signalsReceived).toContain("SIGKILL");
    expect(result.failurePayload).toBeDefined();
    expect(result.failurePayload?.exitStatus).toBe(EXIT_STATUS_SIGKILL_TIMEOUT);
    expect(result.failurePayload?.errorClassification).toBe(ERROR_CLASS_WALL_TIMEOUT);
  });

  test("resolves as interrupted immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const signalsReceived: NodeJS.Signals[] = [];

    const child = createFakeSubprocess({
      pid: 4444,
      exited: new Promise(() => undefined),
    });

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 4444,
      graceMs: 0,
      killProcessTree: (_pid, sig) => {
        signalsReceived.push(sig);
        return true;
      },
    });

    const result = await watchdog.monitorSubprocess(child, undefined, controller.signal);

    expect(result.outcome).toBe("interrupted");
    expect(result.exitCode).toBeNull();
    expect(signalsReceived).toContain("SIGKILL");
    expect(result.failurePayload?.errorClassification).toBe(ERROR_CLASS_PROCESS_HANG);
  });

  test("detects mid-flight abort signal interruption, SIGKILLs process, and synthesizes payload", async () => {
    const controller = new AbortController();
    const signalsReceived: NodeJS.Signals[] = [];

    const child = createFakeSubprocess({
      pid: 4445,
      exited: new Promise(() => undefined),
    });

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 4445,
      graceMs: 0,
      wallTimeoutMs: 10_000,
      idleTimeoutMs: 10_000,
      killProcessTree: (_pid, sig) => {
        signalsReceived.push(sig);
        return true;
      },
    });

    setTimeout(() => controller.abort(), 5);
    const result = await watchdog.monitorSubprocess(child, undefined, controller.signal);

    expect(result.outcome).toBe("interrupted");
    expect(result.exitCode).toBeNull();
    expect(signalsReceived).toContain("SIGKILL");
    expect(result.failurePayload?.errorClassification).toBe(ERROR_CLASS_PROCESS_HANG);
  });
});
