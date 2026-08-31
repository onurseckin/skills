import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteJson } from "../../../olt/scripts/src/core/durable-write.ts";
import { cleanupFailedAttempt } from "../../../olt/scripts/src/engine/runner/execution/attempt-cleanup.ts";
import { writeAttemptFailureEvidence } from "../../../olt/scripts/src/engine/runner/execution/attempt-failure-evidence.ts";
import type { AttemptProcessProof } from "../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { DescendantTracker } from "../../../olt/scripts/src/engine/runner/reconciliation/descendant-tracker.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/process/process-identity.ts";

const roots: string[] = [];
const rootIdentity: ProcessIdentity = { pid: 40, parent: 30, group: 40, birth: "root" };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function cleanup(overrides: Record<string, unknown> = {}) {
  return cleanupFailedAttempt({
    child: undefined,
    descendants: undefined,
    rootIdentity: undefined,
    trackerReady: Promise.resolve(undefined),
    activityRecord: undefined,
    pumps: [],
    pumpAbort: new AbortController(),
    graceMs: 0,
    drainTimeoutMs: 1,
    probeProcess: () => {
      throw new Error("unexpected process probe");
    },
    terminateGroup: async () => {
      throw new Error("unexpected process signal");
    },
    ...overrides,
  } as never);
}

describe("failed attempt descendant tracking and races", () => {
  test("keeps an attempt stranded when descendant absence is unproven", async () => {
    const result = await cleanup({
      descendants: {
        stop: async () => undefined,
        terminate: async () => ["SIGTERM" as NodeJS.Signals],
        proveAbsent: async () => false,
      },
    });
    expect(result.issues.join("\n")).toMatch(/descendant.*absence/i);
  });

  test("requires an absent strong-identity probe for every tracked descendant", async () => {
    const runner: ProcessIdentity = { pid: 30, parent: 20, group: 30, birth: "runner" };
    const descendant: ProcessIdentity = {
      pid: 50,
      parent: rootIdentity.pid,
      group: rootIdentity.group,
      birth: "descendant",
    };
    const processes = new Map([runner, rootIdentity, descendant].map((i) => [i.pid, i]));
    let proof: AttemptProcessProof = "unknown";
    const tracker = new DescendantTracker(rootIdentity.pid, new Set(), "token", {
      runnerPid: runner.pid,
      snapshot: async () => processes,
      identify: (pid) => processes.get(pid),
      ownedPids: () => new Set(),
      kill: () => {
        throw new Error("unexpected process signal");
      },
      probe: () => proof,
    });

    await tracker.start();
    await tracker.stop();
    expect(await tracker.proveAbsent()).toBeFalse();
    proof = "reused";
    expect(await tracker.proveAbsent()).toBeFalse();
    proof = "absent";
    expect(await tracker.proveAbsent()).toBeTrue();
  });

  test("withholds absence proof for a live reparented token owner without pipe anchors", async () => {
    const runner: ProcessIdentity = { pid: 30, parent: 20, group: 30, birth: "runner" };
    const escaped: ProcessIdentity = {
      pid: 50,
      parent: 1,
      group: rootIdentity.group,
      birth: "escaped",
    };
    const processes = new Map<number, ProcessIdentity>([
      [runner.pid, runner],
      [rootIdentity.pid, rootIdentity],
    ]);
    const tracker = new DescendantTracker(rootIdentity.pid, new Set(), "token", {
      runnerPid: runner.pid,
      snapshot: async () => new Map(processes),
      identify: (pid) => processes.get(pid),
      ownedPids: () => new Set(),
      tokenOwners: () => [escaped],
      kill: () => {
        throw new Error("absence proof must not signal a token owner");
      },
      probe: (i) => (i.pid === escaped.pid ? "live" : "absent"),
    });

    await tracker.start();
    processes.delete(rootIdentity.pid);
    processes.set(escaped.pid, escaped);
    await tracker.stop();
    expect(await tracker.proveAbsent()).toBeFalse();
  });

  test("fails closed when the bounded token-owner scan is unavailable", async () => {
    const runner: ProcessIdentity = { pid: 30, parent: 20, group: 30, birth: "runner" };
    const processes = new Map<number, ProcessIdentity>([
      [runner.pid, runner],
      [rootIdentity.pid, rootIdentity],
    ]);
    const tracker = new DescendantTracker(rootIdentity.pid, new Set(), "token", {
      runnerPid: runner.pid,
      snapshot: async () => new Map(processes),
      identify: (pid) => processes.get(pid),
      ownedPids: () => new Set(),
      tokenOwners: () => {
        throw new Error("token-owner scan unavailable");
      },
      kill: () => {
        throw new Error("uncertain ownership must not signal a process");
      },
      probe: () => "absent",
    });

    await tracker.start();
    await expect(tracker.stop()).rejects.toThrow("token-owner scan unavailable");
    await expect(tracker.proveAbsent()).rejects.toThrow("token-owner scan unavailable");
  });

  test("persists normal-phase and cleanup signals after a later evidence failure", async () => {
    const cleanupResult = await cleanup({
      child: { pid: 40, exited: Promise.resolve(1), signalCode: "SIGTERM" },
      descendants: {
        stop: async () => undefined,
        terminate: async (_g: number, onSignal?: (s: NodeJS.Signals) => void) => {
          onSignal?.("SIGKILL");
          return ["SIGKILL" as NodeJS.Signals];
        },
        proveAbsent: async () => true,
      },
      rootIdentity,
      trackerReady: Promise.resolve(rootIdentity),
      signalsSent: ["SIGTERM"],
      probeProcess: () => "absent",
      terminateGroup: async () => ["SIGTERM" as NodeJS.Signals],
    });
    const runRoot = await mkdtemp(join(tmpdir(), "attempt-terminal-signals-"));
    roots.push(runRoot);
    const attemptDir = join(runRoot, "commands", "C-signals", "attempt-1");
    await mkdir(attemptDir, { recursive: true });
    const stdoutPath = join(attemptDir, "stdout.log"),
      stderrPath = join(attemptDir, "stderr.log"),
      activityPath = join(attemptDir, "activity.json");
    await writeFile(stdoutPath, "partial\n");
    await writeFile(stderrPath, "");
    atomicWriteJson(
      activityPath,
      {
        schema: "harness.command-activity",
        version: 1,
        command_id: "C-signals",
        attempt: 1,
        status: "failed",
        started_at: "2026-08-14T00:00:00.000Z",
        heartbeat_at: "2026-08-14T00:00:01.000Z",
        last_output_at: "2026-08-14T00:00:00.000Z",
        stdout_bytes: 8,
        stderr_bytes: 0,
        finished_at: "2026-08-14T00:00:01.000Z",
      },
      0o600,
    );

    const result = writeAttemptFailureEvidence({
      runRoot,
      commandId: "C-signals",
      attempt: 1,
      attemptDir,
      stdoutPath,
      stderrPath,
      activityPath,
      startedAt: "2026-08-14T00:00:00.000Z",
      finishedAt: "2026-08-14T00:00:02.000Z",
      exitCode: null,
      signal: "SIGTERM",
      signals: cleanupResult.signals,
      maxOutputBytes: 1024,
      argv: ["tool"],
      outputTail: "partial",
      error: new Error("storage failed"),
    } as never);

    expect(cleanupResult.issues).toEqual([]);
    expect(result.record.signals_sent).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
