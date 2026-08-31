import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleAttemptFailure } from "../../../olt/scripts/src/engine/runner/execution/attempt-failure-cleanup.ts";
import type { NormalizedCommandOptions } from "../../../olt/scripts/src/engine/runner/types/types.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/process/process-identity.ts";

import { scratchRoot } from "../../shared/scratch-root.ts";

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

  test("handles missing terminalProof in cleanup when startedAt and activityRecord are set", async () => {
    const attemptCleanupModule =
      await import("../../../olt/scripts/src/engine/runner/execution/attempt-cleanup.ts");
    const spyCleanup = spyOn(attemptCleanupModule, "cleanupFailedAttempt").mockResolvedValue({
      issues: [],
      signals: [],
      terminalProof: undefined,
    });

    const attemptIntent = {
      beginCleanupUncertain: () => undefined,
    } as never;
    const activityRecord = { complete: () => undefined } as never;

    try {
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
      ).rejects.toThrow(
        "terminal process proof failed: Error: failed attempt cleanup lacks strong terminal process proof",
      );
    } finally {
      spyCleanup.mockRestore();
    }
  });
});
