import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { handleAttemptFailure } from "../../../olt/scripts/src/engine/runner/execution/attempt-failure-cleanup.ts";
import { createAttemptExecutionError } from "../../../olt/scripts/src/engine/runner/execution/attempt-failure-evidence.ts";
import type { NormalizedCommandOptions } from "../../../olt/scripts/src/engine/runner/types/types.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/process/process-identity.ts";
import { tempRoot, cleanupTempRoots } from "../command/fixture.ts";
import { afterAll, afterEach } from "bun:test";

afterEach(cleanupTempRoots);
afterAll(cleanupTempRoots);

const mockOptions: NormalizedCommandOptions = {
  commandId: "cmd-1",
  argv: ["echo", "test"],
  cwd: "/repo",
  runRoot: "/repo",
  timeoutMs: 1000,
  wallTimeoutMs: 1000,
  idleTimeoutMs: 500,
  graceMs: 50,
  drainTimeoutMs: 1,
  maxOutputBytes: 1024,
  maxRecordedOutputBytes: 1024,
  env: {},
};

const mockIdentity: ProcessIdentity = {
  pid: 12345,
  parent: 1,
  group: 12345,
  birth: "2026-08-14T00:00:00.000Z",
};

describe("attempt-failure-cleanup: handleAttemptFailure", () => {
  const tempDir = tempRoot("handle-failure");
  const attemptDir = join(tempDir, "attempts/1");
  mkdirSync(attemptDir, { recursive: true });
  writeFileSync(join(attemptDir, "stdout.log"), "sample stdout");
  writeFileSync(join(attemptDir, "stderr.log"), "sample stderr");

  const baseCtx = {
    error: new Error("initial crash"),
    terminalProofDurable: false,
    cleanupPrewriteFailed: false,
    attemptIntent: undefined,
    child: undefined,
    descendants: undefined,
    rootIdentity: undefined,
    trackerReady: undefined,
    activityRecord: undefined,
    pumps: [],
    pumpAbort: new AbortController(),
    options: mockOptions,
    deliveredSignals: [],
    durableSignals: [],
    processGroupSignals: [],
    persistSignal: () => undefined,
    startedAt: undefined,
    commandId: "cmd-1",
    attempt: 1,
    attemptDir,
    observedExitCode: 1,
    outputTail: "",
  };

  test("re-throws error directly when startedAt or activityRecord is missing", async () => {
    await expect(handleAttemptFailure(baseCtx)).rejects.toThrow("initial crash");
  });

  test("handles cleanupPrewriteFailed and intent failures in beforeCleanup", async () => {
    await expect(
      handleAttemptFailure({
        ...baseCtx,
        cleanupPrewriteFailed: true,
        startedAt: new Date(),
        activityRecord: {
          path: "activity.json",
          bytes: 10,
          sha256: "abc",
        },
      }),
    ).rejects.toThrow("initial crash");
  });

  test("settles pumps, waits for exit, and proceeds to afterProcessExit", async () => {
    const pumpPromise = Promise.resolve();
    const child = {
      pid: 12345,
      exited: Promise.resolve(0),
    };

    await expect(
      handleAttemptFailure({
        ...baseCtx,
        startedAt: new Date(),
        activityRecord: {
          path: "activity.json",
          bytes: 10,
          sha256: "abc",
        },
        rootIdentity: mockIdentity,
        child: child as unknown as typeof baseCtx.child,
        pumps: [pumpPromise],
      }),
    ).rejects.toThrow("initial crash");
  });

  test("terminates process group and logs warning when terminal proof not durable", async () => {
    const child = {
      pid: 12345,
      exited: Promise.resolve(0),
    };

    await expect(
      handleAttemptFailure({
        ...baseCtx,
        terminalProofDurable: false,
        startedAt: new Date(),
        activityRecord: {
          path: "activity.json",
          bytes: 10,
          sha256: "abc",
        },
        rootIdentity: mockIdentity,
        child: child as unknown as typeof baseCtx.child,
        processGroupSignals: [{ signal: "SIGTERM", at: "2026-08-14T00:00:00.000Z" }],
      }),
    ).rejects.toThrow("initial crash");
  });

  test("creates execution error and preserves original error cause", async () => {
    const startedAt = new Date("2026-08-14T00:00:00.000Z");
    writeFileSync(join(attemptDir, "activity.json"), JSON.stringify({ pid: 12345 }));

    try {
      await handleAttemptFailure({
        ...baseCtx,
        terminalProofDurable: true,
        startedAt,
        activityRecord: {
          path: "activity.json",
          bytes: 10,
          sha256: "abc",
        },
        rootIdentity: mockIdentity,
      });
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      const e = err as Error;
      expect(e.message).toContain("initial crash");
    }
  });
});

describe("createAttemptExecutionError terminal-evidence-failure fallback", () => {
  test("wraps a failure while persisting evidence around the original error message", async () => {
    const runRoot = tempRoot("attempt-failure-evidence-terminal");
    const attemptDir = join(runRoot, "attempt-1");
    await mkdir(attemptDir);
    const options = { runRoot, maxOutputBytes: 1024, argv: ["tool"] } as NormalizedCommandOptions;

    expect(() =>
      createAttemptExecutionError({
        options,
        commandId: "C-1",
        attempt: 1,
        attemptDir,
        startedAt: new Date("2026-08-19T00:00:00.000Z"),
        exitCode: null,
        signal: null,
        signals: [],
        outputTail: "",
        error: new Error("original attempt failure"),
      }),
    ).toThrow(/^original attempt failure; terminal attempt evidence failed: /);
  });

  test("falls back to String(error) when the original error is not an Error instance", async () => {
    const runRoot = tempRoot("attempt-failure-evidence-terminal-nonerror");
    const attemptDir = join(runRoot, "attempt-1");
    await mkdir(attemptDir);
    const options = { runRoot, maxOutputBytes: 1024, argv: ["tool"] } as NormalizedCommandOptions;

    expect(() =>
      createAttemptExecutionError({
        options,
        commandId: "C-1",
        attempt: 1,
        attemptDir,
        startedAt: new Date("2026-08-19T00:00:00.000Z"),
        exitCode: null,
        signal: null,
        signals: [],
        outputTail: "",
        error: "plain string failure",
      }),
    ).toThrow(/^plain string failure; terminal attempt evidence failed: /);
  });
});
