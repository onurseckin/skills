import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  finalizeSuccessfulAttempt,
  writeSuccessfulAttemptEvidence,
} from "../../../olt/scripts/src/engine/runner/models/attempt-success-evidence.ts";
import type {
  NormalizedCommandOptions,
  OutputSummary,
} from "../../../olt/scripts/src/capture/runners/types.ts";
import type { WatchdogOutcome } from "../../../olt/scripts/src/engine/runner/telemetry/watchdog.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/reconciliation/descendant-tracker.ts";

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

describe("writeSuccessfulAttemptEvidence", () => {
  test("marks a clean zero-exit run as succeeded with no failure class", async () => {
    const fixture = await attemptFixture("success-evidence-succeeded-");
    const outcome: WatchdogOutcome = { code: 0, timeout: null, interrupted: false };
    const result = writeSuccessfulAttemptEvidence({
      options: options(fixture.runRoot),
      commandId: "C-1",
      attempt: 1,
      attemptDir: fixture.attemptDir,
      stdoutPath: fixture.stdoutPath,
      stderrPath: fixture.stderrPath,
      activityPath: fixture.activityPath,
      startedAt: new Date("2026-08-19T00:00:00.000Z"),
      finishedAt: new Date("2026-08-19T00:00:01.000Z"),
      outcome,
      exitCode: 0,
      signal: null,
      signals: [],
      stdoutLog: emptyLog,
      stderrLog: emptyLog,
      failureSignals: noFailureSignals,
      outputTail: "hello\n",
    });
    expect(result.record.status).toBe("succeeded");
    expect(result.record.failure_class).toBeNull();
    expect(result.failureClass).toBeUndefined();
    expect(result.record.evidence_issues).toEqual([]);
    const persisted = JSON.parse(await readFile(join(fixture.attemptDir, "record.json"), "utf8"));
    expect(persisted.status).toBe("succeeded");
  });

  test("classifies a run with output-evidence issues as a terminal test failure", async () => {
    const fixture = await attemptFixture("success-evidence-test-failure-");
    // "bun test" argv gives the command test intent, and stdout reporting zero discovered tests
    // is exactly what outputEvidenceIssues flags as suspicious for a claimed success.
    await writeFile(fixture.stdoutPath, "no tests found\n");
    const outcome: WatchdogOutcome = { code: 0, timeout: null, interrupted: false };
    const result = writeSuccessfulAttemptEvidence({
      options: { ...options(fixture.runRoot), argv: ["bun", "test"] } as NormalizedCommandOptions,
      commandId: "C-1",
      attempt: 1,
      attemptDir: fixture.attemptDir,
      stdoutPath: fixture.stdoutPath,
      stderrPath: fixture.stderrPath,
      activityPath: fixture.activityPath,
      startedAt: new Date("2026-08-19T00:00:00.000Z"),
      finishedAt: new Date("2026-08-19T00:00:01.000Z"),
      outcome,
      exitCode: 0,
      signal: null,
      signals: [],
      stdoutLog: emptyLog,
      stderrLog: emptyLog,
      failureSignals: noFailureSignals,
      outputTail: "",
    });
    expect(result.record.status).toBe("failed");
    expect(result.record.failure_class).toBe("test_failure");
    expect(result.failureClass).toBe("test_failure");
    expect(result.record.evidence_issues.length).toBeGreaterThan(0);
  });

  test("marks a nonzero exit as failed and classifies it via the failure signals", async () => {
    const fixture = await attemptFixture("success-evidence-nonzero-exit-");
    const outcome: WatchdogOutcome = { code: 1, timeout: null, interrupted: false };
    const result = writeSuccessfulAttemptEvidence({
      options: options(fixture.runRoot),
      commandId: "C-1",
      attempt: 1,
      attemptDir: fixture.attemptDir,
      stdoutPath: fixture.stdoutPath,
      stderrPath: fixture.stderrPath,
      activityPath: fixture.activityPath,
      startedAt: new Date("2026-08-19T00:00:00.000Z"),
      finishedAt: new Date("2026-08-19T00:00:01.000Z"),
      outcome,
      exitCode: 1,
      signal: null,
      signals: [],
      stdoutLog: emptyLog,
      stderrLog: emptyLog,
      failureSignals: { ...noFailureSignals, networkTransient: true },
      outputTail: "",
    });
    expect(result.record.status).toBe("failed");
    expect(result.record.failure_class).toBe("network_transient");
    expect(result.failureClass).toBe("network_transient");
  });

  test("marks a wall-clock timeout as timed_out with a matching timeout_kind", async () => {
    const fixture = await attemptFixture("success-evidence-timeout-");
    const outcome: WatchdogOutcome = { code: null, timeout: "wall", interrupted: false };
    const result = writeSuccessfulAttemptEvidence({
      options: options(fixture.runRoot),
      commandId: "C-1",
      attempt: 1,
      attemptDir: fixture.attemptDir,
      stdoutPath: fixture.stdoutPath,
      stderrPath: fixture.stderrPath,
      activityPath: fixture.activityPath,
      startedAt: new Date("2026-08-19T00:00:00.000Z"),
      finishedAt: new Date("2026-08-19T00:00:01.000Z"),
      outcome,
      exitCode: null,
      signal: null,
      signals: [],
      stdoutLog: emptyLog,
      stderrLog: emptyLog,
      failureSignals: noFailureSignals,
      outputTail: "",
    });
    expect(result.record.status).toBe("timed_out");
    expect(result.record.timeout_kind).toBe("wall");
    expect(result.record.failure_class).toBe("timeout");
  });

  test("marks a host-interrupted run as failed even with a zero exit code", async () => {
    const fixture = await attemptFixture("success-evidence-interrupted-");
    const outcome: WatchdogOutcome = { code: null, timeout: null, interrupted: true };
    const result = writeSuccessfulAttemptEvidence({
      options: options(fixture.runRoot),
      commandId: "C-1",
      attempt: 1,
      attemptDir: fixture.attemptDir,
      stdoutPath: fixture.stdoutPath,
      stderrPath: fixture.stderrPath,
      activityPath: fixture.activityPath,
      startedAt: new Date("2026-08-19T00:00:00.000Z"),
      finishedAt: new Date("2026-08-19T00:00:01.000Z"),
      outcome,
      exitCode: 0,
      signal: "SIGTERM",
      signals: ["SIGTERM"],
      stdoutLog: emptyLog,
      stderrLog: emptyLog,
      failureSignals: noFailureSignals,
      outputTail: "",
    });
    expect(result.record.status).toBe("failed");
    expect(result.record.failure_class).toBe("host_interruption");
    expect(result.record.signal).toBe("SIGTERM");
    expect(result.record.signals_sent).toEqual(["SIGTERM"]);
  });
});

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
