import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupAfterAttemptFailure,
  handleAttemptFailure,
  settleAndTerminateAttempt,
  startAttemptPumpsAndMonitoring,
} from "../../../olt/scripts/src/engine/runner/attempt-failure-cleanup.ts";
import type { NormalizedCommandOptions } from "../../../olt/scripts/src/capture/runners/types.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/descendant-tracker.ts";

import { scratchRoot } from "../../support/scratch-root.ts";
import { readProcessIdentity } from "../../../olt/scripts/src/engine/runner/process-identity.ts";

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

describe("attempt-failure-cleanup", () => {
  test("cleanupAfterAttemptFailure handles durable and non-durable", async () => {
    const err = new Error("durable failure");
    await expect(cleanupAfterAttemptFailure(err, true, async () => "ok")).rejects.toThrow(
      "durable failure",
    );
    expect(await cleanupAfterAttemptFailure(err, false, async () => "ok")).toBe("ok");
  });

  test("startAttemptPumpsAndMonitoring starts custom pumps", async () => {
    const tempDir = scratchRoot(import.meta.path, "cleanup-pumps");
    const child = {
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
      exited: Promise.resolve(0),
      pid: 123,
    } as never;
    const pumps: Promise<never>[] = [];
    const res = startAttemptPumpsAndMonitoring(
      {
        ...mockOptions,
        runRoot: tempDir,
        pump: async (_s, _f, path) => ({ bytes: 5, truncated: false, path }),
      },
      child,
      {} as never,
      {} as never,
      join(tempDir, "out.log"),
      join(tempDir, "err.log"),
      () => () => undefined,
      pumps as never,
      new AbortController(),
      new Date(),
      () => Date.now(),
      { heartbeat: () => undefined } as never,
    );
    expect((await res.allPumps)[0].path).toBe("out.log");
    expect((await res.monitoring).code).toBe(0);
  });

  test("settleAndTerminateAttempt terminates detached process group and records signal", async () => {
    const child = Bun.spawn(["sleep", "5"], { detached: true });
    const rootIdentity = readProcessIdentity(child.pid);
    const tracker = {
      terminate: async () => [],
      proveAbsent: async () => true,
    } as never;
    const pgSignals: NodeJS.Signals[] = [];
    const recorded: NodeJS.Signals[] = [];

    const res = await settleAndTerminateAttempt(
      child as never,
      tracker,
      rootIdentity,
      { ...mockOptions, graceMs: 50 },
      { timeout: "wall", code: null, interrupted: false },
      pgSignals,
      (s) => recorded.push(s),
    );
    expect(res.descendantsAbsent).toBe(true);
    expect(res.rootProof).toBe(true);
    expect(pgSignals).toContain("SIGTERM");
    expect(recorded).toContain("SIGTERM");
  });

  test("settleAndTerminateAttempt validates root identity and timeouts", async () => {
    const tracker = {
      terminate: async () => [],
      proveAbsent: async () => true,
    } as never;
    await expect(
      settleAndTerminateAttempt(
        { pid: 999, exited: Promise.resolve(0) } as never,
        tracker,
        undefined,
        mockOptions,
        { timeout: "wall", code: null, interrupted: false },
        [],
        () => undefined,
      ),
    ).rejects.toThrow("termination withheld");

    const signals: NodeJS.Signals[] = [];
    const res = await settleAndTerminateAttempt(
      { pid: 999999, exited: Promise.resolve(0) } as never,
      tracker,
      { ...mockIdentity, pid: 999999 },
      mockOptions,
      { timeout: "wall", code: 0, interrupted: false },
      signals,
      (s) => signals.push(s),
    );
    expect(res.descendantsAbsent).toBe(true);
    expect(res.exitCode).toBe(0);

    let elapsedMs = 0;
    const fakeClock = {
      now: () => elapsedMs,
      wait: async (ms: number) => {
        elapsedMs += ms * 24;
      },
    };
    await expect(
      settleAndTerminateAttempt(
        { pid: 999999, exited: Promise.resolve(0) } as never,
        { terminate: async () => [], proveAbsent: async () => false } as never,
        { ...mockIdentity, pid: 999999 },
        mockOptions,
        { timeout: "wall", code: null, interrupted: false },
        [],
        () => undefined,
        fakeClock,
      ),
    ).rejects.toThrow("attempt process absence was not proven");
  });

  describe("handleAttemptFailure", () => {
    const tempDir = scratchRoot(import.meta.path, "handle-failure");
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
          child: { pid: 40, exited: Promise.resolve(0) } as never,
        }),
      ).rejects.toThrow("initial crash");

      const attemptIntent = {
        beginCleanupUncertain: () => {
          throw new Error("intent failed");
        },
      } as never;
      await expect(
        handleAttemptFailure({
          ...baseCtx,
          attemptIntent,
          child: { pid: 40, exited: Promise.resolve(0) } as never,
        }),
      ).rejects.toThrow("cleanup uncertainty prewrite failed");
    });

    test("handles cleanup with issues and disposition error", async () => {
      let callCount = 0;
      const attemptIntent = {
        beginCleanupUncertain: () => {
          callCount += 1;
          if (callCount > 1) throw new Error("disposition err");
        },
      } as never;
      await expect(
        handleAttemptFailure({
          ...baseCtx,
          attemptIntent,
          child: { pid: 40, exited: Promise.resolve(0) } as never,
        }),
      ).rejects.toThrow("command cleanup failed");
    });

    test("creates execution error when cleanup succeeds with terminalProof", async () => {
      let pendingReason = "";
      let proofReason = "";
      const attemptIntent = {
        beginCleanupUncertain: () => undefined,
        markRecordPending: (r: string) => (pendingReason = r),
        markTerminalProof: (r: string) => (proofReason = r),
      } as never;
      const activityRecord = { complete: () => undefined } as never;

      await expect(
        handleAttemptFailure({
          ...baseCtx,
          attemptIntent,
          startedAt: new Date(),
          activityRecord,
          rootIdentity: { ...mockIdentity, pid: 999999 },
          child: { pid: 999999, exited: Promise.resolve(0) } as never,
          descendants: {
            stop: async () => undefined,
            terminate: async () => [],
            proveAbsent: async () => true,
          } as never,
        }),
      ).rejects.toThrow();
      expect(pendingReason).toContain("failed-attempt evidence is ready");
      expect(proofReason).toContain("absence proven");
    });

    test("throws terminal process proof failed when markRecordPending throws", async () => {
      const attemptIntent = {
        beginCleanupUncertain: () => undefined,
        markRecordPending: () => {
          throw new Error("db lock failed");
        },
      } as never;
      const activityRecord = { complete: () => undefined } as never;

      await expect(
        handleAttemptFailure({
          ...baseCtx,
          attemptIntent,
          startedAt: new Date(),
          activityRecord,
          rootIdentity: { ...mockIdentity, pid: 999999 },
          child: { pid: 999999, exited: Promise.resolve(0) } as never,
          descendants: {
            stop: async () => undefined,
            terminate: async () => [],
            proveAbsent: async () => true,
          } as never,
        }),
      ).rejects.toThrow("terminal process proof failed");
    });
  });
});
