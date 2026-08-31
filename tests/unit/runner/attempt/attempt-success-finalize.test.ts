import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finalizeSuccessfulAttempt } from "../../../../olt/scripts/src/engine/runner/models/attempt/attempt-success-evidence.ts";
import type {
  NormalizedCommandOptions,
  OutputSummary,
} from "../../../../olt/scripts/src/engine/runner/types/types.ts";
import type { ProcessIdentity } from "../../../../olt/scripts/src/engine/runner/process/process-identity.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function attemptFixture(name: string) {
  const runRoot = await mkdtemp(join(tmpdir(), name));
  roots.push(runRoot);
  const attemptDir = join(runRoot, "attempt-1");
  await mkdir(attemptDir);
  const stdoutPath = join(attemptDir, "stdout.log");
  const stderrPath = join(attemptDir, "stderr.log");
  const activityPath = join(attemptDir, "activity.json");
  await writeFile(stdoutPath, "hello\n");
  await writeFile(stderrPath, "");
  await writeFile(activityPath, '{"status":"running"}');
  return { runRoot, attemptDir, stdoutPath, stderrPath, activityPath };
}

function options(runRoot: string): NormalizedCommandOptions {
  return {
    argv: ["echo", "hello"],
    maxOutputBytes: 4096,
    runRoot,
  } as unknown as NormalizedCommandOptions;
}

const emptyLog: OutputSummary = { path: "empty", bytes: 0, sha256: "e".repeat(64) };
const noFailureSignals = { authorization: false, networkTransient: false, testFailure: false };

describe("finalizeSuccessfulAttempt", () => {
  function fakeAttemptIntent() {
    const calls: string[] = [];
    return {
      calls,
      controller: {
        bindRoot: () => undefined,
        beginCleanupUncertain: () => undefined,
        recordSignal: () => undefined,
        markRecordPending: (reason: string) => {
          calls.push(`record_pending:${reason}`);
        },
        markTerminalProof: (reason: string) => {
          calls.push(`terminal_proof:${reason}`);
        },
      } as never,
    };
  }

  test("uses a strong terminal proof and completes the activity record when root absence is proven", async () => {
    const fixture = await attemptFixture("finalize-success-strong-");
    const completedWith: Array<{ status: string; at: Date }> = [];
    const rootIdentity: ProcessIdentity = {
      pid: 111,
      parent: 1,
      group: 111,
      birth: "2026-08-19T00:00:00.000Z",
    };
    const { calls, controller } = fakeAttemptIntent();
    const result = await finalizeSuccessfulAttempt({
      allPumps: Promise.resolve([emptyLog, emptyLog]),
      options: options(fixture.runRoot),
      commandId: "C-1",
      attempt: 1,
      attemptDir: fixture.attemptDir,
      stdoutPath: fixture.stdoutPath,
      stderrPath: fixture.stderrPath,
      activityPath: fixture.activityPath,
      startedAt: new Date("2026-08-19T00:00:00.000Z"),
      outcome: { code: 0, timeout: null, interrupted: false },
      exitCode: 0,
      child: { signalCode: null } as never,
      uniqueSignals: [],
      evidence: { snapshot: () => noFailureSignals },
      outputTail: "",
      activityRecord: {
        complete: (status: string, at: Date) => {
          completedWith.push({ status, at });
        },
      } as never,
      rootProof: true,
      rootIdentity,
      attemptIntent: controller,
    });
    expect(result.record.status).toBe("succeeded");
    expect(completedWith).toHaveLength(1);
    expect(completedWith[0]!.status).toBe("completed");
    expect(calls[0]).toMatch(/^record_pending:/);
    expect(calls[1]).toMatch(/^terminal_proof:/);
  });

  test("falls back to a settled terminal proof when root absence was not strongly proven", async () => {
    const fixture = await attemptFixture("finalize-success-settled-");
    const { controller } = fakeAttemptIntent();
    const result = await finalizeSuccessfulAttempt({
      allPumps: Promise.resolve([emptyLog, emptyLog]),
      options: options(fixture.runRoot),
      commandId: "C-1",
      attempt: 1,
      attemptDir: fixture.attemptDir,
      stdoutPath: fixture.stdoutPath,
      stderrPath: fixture.stderrPath,
      activityPath: fixture.activityPath,
      startedAt: new Date("2026-08-19T00:00:00.000Z"),
      outcome: { code: 0, timeout: null, interrupted: false },
      exitCode: 0,
      child: { signalCode: null } as never,
      uniqueSignals: [],
      evidence: { snapshot: () => noFailureSignals },
      outputTail: "",
      activityRecord: { complete: () => undefined } as never,
      rootProof: false,
      rootIdentity: undefined,
      attemptIntent: controller,
    });
    expect(result.record.status).toBe("succeeded");
  });

  test("propagates a pipe-drain timeout instead of writing evidence", async () => {
    const fixture = await attemptFixture("finalize-success-drain-timeout-");
    const { controller } = fakeAttemptIntent();
    await expect(
      finalizeSuccessfulAttempt({
        allPumps: new Promise(() => undefined),
        options: { ...options(fixture.runRoot), drainTimeoutMs: 5 } as NormalizedCommandOptions,
        commandId: "C-1",
        attempt: 1,
        attemptDir: fixture.attemptDir,
        stdoutPath: fixture.stdoutPath,
        stderrPath: fixture.stderrPath,
        activityPath: fixture.activityPath,
        startedAt: new Date("2026-08-19T00:00:00.000Z"),
        outcome: { code: 0, timeout: null, interrupted: false },
        exitCode: 0,
        child: { signalCode: null } as never,
        uniqueSignals: [],
        evidence: { snapshot: () => noFailureSignals },
        outputTail: "",
        activityRecord: { complete: () => undefined } as never,
        rootProof: false,
        rootIdentity: undefined,
        attemptIntent: controller,
      }),
    ).rejects.toThrow("command pipe drain timeout");
  });
});
