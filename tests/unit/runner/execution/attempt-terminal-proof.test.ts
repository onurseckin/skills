import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupFailedAttempt } from "../../../../olt/scripts/src/engine/runner/execution/attempt-cleanup.ts";
import {
  settledAttemptTerminalProof,
  startAttemptIntent,
} from "../../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { createCommandSigningCapability } from "../../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import type { ProcessIdentity } from "../../../../olt/scripts/src/engine/runner/process/process-identity.ts";
import { cleanupAfterAttemptFailure } from "../../../../olt/scripts/src/engine/runner/models/attempt/run-attempt.ts";

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

describe("failed attempt terminal proof", () => {
  test("post-terminal evidence failure preserves proof and skips duplicate cleanup", async () => {
    const attemptDir = await mkdtemp(join(tmpdir(), "attempt-post-terminal-failure-"));
    roots.push(attemptDir);
    const controller = startAttemptIntent(
      attemptDir,
      "C-post-terminal-failure",
      1,
      "2026-08-14T00:00:00.000Z",
      "12345678-1234-4234-8234-123456789abc",
      () => undefined,
      createCommandSigningCapability(),
    );
    controller.markRecordPending("successful evidence is ready");
    controller.markTerminalProof("child settlement proven", settledAttemptTerminalProof(undefined));
    const markerPath = join(attemptDir, "attempt-started.json");
    const terminalMarker = await readFile(markerPath, "utf8");
    const original = new Error("successful attempt evidence write failed");
    let cleanupCalls = 0;

    let caught: unknown;
    try {
      await cleanupAfterAttemptFailure(original, true, async () => {
        cleanupCalls += 1;
        controller.beginCleanupUncertain([original.message]);
        return undefined;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
    expect(cleanupCalls).toBe(0);
    expect(await readFile(markerPath, "utf8")).toBe(terminalMarker);
  });

  test("keeps an identity-unavailable child stranded when exit never settles", async () => {
    const result = await cleanup({
      child: { pid: 40, exited: new Promise(() => undefined) },
    });

    expect(result).toMatchObject({ signals: [] });
    expect(result.issues).toContain(
      "termination withheld because strong root identity was unavailable; residual pid 40 requires inspection",
    );
  });

  test("does not begin cleanup when its uncertainty prewrite fails", async () => {
    const actions: string[] = [];
    await expect(
      cleanup({
        beforeCleanup: () => {
          actions.push("prewrite");
          throw new Error("injected disposition write failure");
        },
        child: { pid: 40, exited: Promise.resolve(1) },
        rootIdentity,
        trackerReady: Promise.resolve(rootIdentity),
        descendants: {
          stop: async () => actions.push("stop"),
          terminate: async () => {
            actions.push("terminate");
            return [];
          },
          proveAbsent: async () => true,
        },
        probeProcess: () => "absent",
        terminateGroup: async () => {
          actions.push("signal");
          return [];
        },
      }),
    ).rejects.toThrow("injected disposition write failure");
    expect(actions).toEqual(["prewrite"]);
  });

  test("keeps a settled child stranded when no strong root identity was bound", async () => {
    const result = await cleanup({
      child: { pid: 40, exited: Promise.resolve(0) },
      descendants: {
        stop: async () => undefined,
        terminate: async () => [],
        proveAbsent: async () => true,
      },
    });

    expect(result.issues.join("\n")).toMatch(/strong root identity|root.*not.*proven/i);
  });

  test("accepts only settled and identity-confirmed root and descendants", async () => {
    const descendants = {
      stop: async () => undefined,
      terminate: async (_grace: number, onSignal?: (signal: NodeJS.Signals) => void) => {
        onSignal?.("SIGKILL");
        return ["SIGKILL" as NodeJS.Signals];
      },
      proveAbsent: async () => true,
    };
    const result = await cleanup({
      child: { pid: 40, exited: Promise.resolve(1), signalCode: "SIGTERM" },
      descendants,
      rootIdentity,
      trackerReady: Promise.resolve(rootIdentity),
      probeProcess: () => "absent",
      terminateGroup: async (
        _pid: number,
        _grace: number,
        _exited: Promise<number>,
        _root: ProcessIdentity,
        dependencies: { onSignal?: (signal: NodeJS.Signals) => void },
      ) => {
        dependencies.onSignal?.("SIGTERM");
        return ["SIGTERM" as NodeJS.Signals];
      },
    });

    expect(result).toMatchObject({
      issues: [],
      signals: ["SIGTERM", "SIGKILL"],
      terminalProof: {
        kind: "strong_absence",
        childSettled: true,
        descendantsAbsent: true,
        rootAbsent: true,
        rootIdentity,
      },
    });
  });

  test("retains a delivered TERM when later process-group termination throws", async () => {
    const persisted: NodeJS.Signals[] = [];
    const result = await cleanup({
      child: { pid: 40, exited: Promise.resolve(1), signalCode: "SIGTERM" },
      descendants: {
        stop: async () => undefined,
        terminate: async () => [],
        proveAbsent: async () => true,
      },
      rootIdentity,
      trackerReady: Promise.resolve(rootIdentity),
      probeProcess: () => "absent",
      onSignal: (signal: NodeJS.Signals) => persisted.push(signal),
      terminateGroup: async (
        _pid: number,
        _grace: number,
        _exited: Promise<number>,
        _root: ProcessIdentity,
        dependencies: { onSignal?: (signal: NodeJS.Signals) => void },
      ) => {
        dependencies.onSignal?.("SIGTERM");
        throw new Error("injected KILL failure");
      },
    });

    expect(result.signals).toEqual(["SIGTERM"]);
    expect(persisted).toEqual(["SIGTERM"]);
    expect(result.issues.join("\n")).toContain("injected KILL failure");
  });

  test("retries a one-shot signal ledger write without delivering TERM twice", async () => {
    const durable: NodeJS.Signals[] = [];
    const sentDuringCleanup: NodeJS.Signals[] = [];
    let appendAttempts = 1;
    const result = await cleanup({
      child: { pid: 40, exited: Promise.resolve(1), signalCode: "SIGKILL" },
      descendants: {
        stop: async () => undefined,
        terminate: async () => [],
        proveAbsent: async () => true,
      },
      rootIdentity,
      trackerReady: Promise.resolve(rootIdentity),
      signalsSent: ["SIGTERM"],
      signalsRecorded: [],
      processGroupSignalsSent: ["SIGTERM"],
      persistSignal: (signal: NodeJS.Signals) => {
        appendAttempts += 1;
        durable.push(signal);
      },
      probeProcess: () => "absent",
      terminateGroup: async (
        _pid: number,
        _grace: number,
        _exited: Promise<number>,
        _root: ProcessIdentity,
        dependencies: {
          onSignal?: (signal: NodeJS.Signals) => void;
          signalsSent?: readonly NodeJS.Signals[];
        },
      ) => {
        expect(dependencies.signalsSent).toEqual(["SIGTERM"]);
        sentDuringCleanup.push("SIGKILL");
        dependencies.onSignal?.("SIGKILL");
        return ["SIGKILL"];
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(durable).toEqual(["SIGTERM", "SIGKILL"]);
    expect(sentDuringCleanup).toEqual(["SIGKILL"]);
    expect(appendAttempts).toBe(3);
  });
});
