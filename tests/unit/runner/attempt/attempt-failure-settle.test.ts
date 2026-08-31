import { describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import {
  cleanupAfterAttemptFailure,
  settleAndTerminateAttempt,
  startAttemptPumpsAndMonitoring,
} from "../../../../olt/scripts/src/engine/runner/execution/attempt-failure-cleanup.ts";
import type { NormalizedCommandOptions } from "../../../../olt/scripts/src/engine/runner/types/types.ts";
import {
  readProcessIdentity,
  type ProcessIdentity,
} from "../../../../olt/scripts/src/engine/runner/process/process-identity.ts";

import { scratchRoot } from "../../../support/scratch-root.ts";

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

describe("attempt-failure-settle", () => {
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

  test("settleAndTerminateAttempt catches errors during probeRoot and uses realSettleClock wait", async () => {
    const attemptIntentModule =
      await import("../../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts");
    let probeCount = 0;
    const probeSpy = spyOn(attemptIntentModule, "probeAttemptProcess").mockImplementation(() => {
      probeCount += 1;
      if (probeCount === 1) throw new Error("probe internal error");
      return "absent";
    });

    let absentCount = 0;
    const tracker = {
      terminate: async () => [],
      proveAbsent: async () => {
        absentCount += 1;
        return absentCount > 1;
      },
    } as never;

    try {
      const res = await settleAndTerminateAttempt(
        { pid: 999998, exited: Promise.resolve(0) } as never,
        tracker,
        { ...mockIdentity, pid: 999998 },
        mockOptions,
        { timeout: "wall", code: null, interrupted: false },
        [],
        () => undefined,
      );
      expect(res.descendantsAbsent).toBe(true);
      expect(res.rootProof).toBe(true);
    } finally {
      probeSpy.mockRestore();
    }
  });
});
