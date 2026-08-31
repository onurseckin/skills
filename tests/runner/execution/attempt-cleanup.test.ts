import { describe, expect, test } from "bun:test";
import { cleanupFailedAttempt } from "../../../olt/scripts/src/engine/runner/execution/attempt-cleanup.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/process/process-identity.ts";

const mockIdentity: ProcessIdentity = {
  pid: 40,
  parent: 1,
  group: 40,
  birth: "2026-08-14T00:00:00.000Z",
};

const baseOptions = {
  child: undefined,
  descendants: undefined,
  rootIdentity: undefined,
  trackerReady: undefined,
  activityRecord: undefined,
  pumps: [],
  pumpAbort: new AbortController(),
  graceMs: 0,
  drainTimeoutMs: 0,
};

describe("failed attempt cleanup", () => {
  test("keeps an unbound short-lived child stranded despite its settled exit", async () => {
    const result = await cleanupFailedAttempt({
      ...baseOptions,
      child: { pid: 40, exited: Promise.resolve(0) } as never,
      descendants: {
        stop: async () => undefined,
        terminate: async () => [],
        proveAbsent: async () => true,
      } as never,
      trackerReady: Promise.resolve(undefined),
    });
    expect(result.issues).toContain(
      "termination withheld because strong root identity was unavailable; residual pid 40 requires inspection",
    );
  });

  test("fails closed without signaling when an unbound child has not exited", async () => {
    const result = await cleanupFailedAttempt({
      ...baseOptions,
      child: { pid: 40, exited: new Promise(() => undefined) } as never,
    });
    expect(result.issues).toContain(
      "termination withheld because strong root identity was unavailable; residual pid 40 requires inspection",
    );
    expect(result.issues).toContain(
      "tracked descendant absence was not proven because the tracker was unavailable",
    );
  });

  test("successfully cleans up with full proof when all steps succeed", async () => {
    let beforeCalled = false;
    let completedStatus: string | undefined;
    const signalsRecorded: NodeJS.Signals[] = [];

    const result = await cleanupFailedAttempt({
      ...baseOptions,
      child: { pid: 40, exited: Promise.resolve(0) } as never,
      descendants: {
        stop: async () => undefined,
        terminate: async (_g, onSig) => {
          onSig("SIGTERM");
          return ["SIGTERM"];
        },
        proveAbsent: async () => true,
      } as never,
      rootIdentity: mockIdentity,
      activityRecord: { complete: (s) => (completedStatus = s) } as never,
      pumps: [Promise.resolve({ bytes: 10, truncated: false, path: "/out" })],
      signalsSent: ["SIGTERM"],
      beforeCleanup: () => (beforeCalled = true),
      persistSignal: (sig) => signalsRecorded.push(sig),
      probeProcess: () => "absent",
      terminateGroup: async (_p, _g, _e, _r, opts) => opts?.onSignal?.("SIGTERM"),
    });

    expect(beforeCalled).toBe(true);
    expect(completedStatus).toBe("failed");
    expect(result.issues).toEqual([]);
    expect(result.signals).toEqual(["SIGTERM"]);
    expect(result.terminalProof?.kind).toBe("strong_absence");
  });

  test("handles trackerReady rejection and probe failure", async () => {
    const result = await cleanupFailedAttempt({
      ...baseOptions,
      child: { pid: 40, exited: Promise.resolve(0) } as never,
      descendants: {
        stop: async () => {
          throw new Error("descendants stop failed");
        },
        terminate: async () => [],
        proveAbsent: async () => false,
      } as never,
      trackerReady: Promise.reject(new Error("tracker lookup failed")),
      activityRecord: {
        complete: () => {
          throw new Error("complete failed");
        },
      } as never,
      onSignal: () => undefined,
    });

    expect(result.issues).toContain("Error: descendants stop failed");
    expect(result.issues).toContain("Error: tracker lookup failed");
    expect(result.issues).toContain("tracked descendant absence was not proven after cleanup");
    expect(result.issues).toContain("Error: complete failed");
    expect(result.terminalProof).toBeUndefined();
  });

  test("handles terminateGroup and probeProcess throwing errors", async () => {
    const result = await cleanupFailedAttempt({
      ...baseOptions,
      child: { pid: 40, exited: Promise.resolve(0) } as never,
      descendants: {
        stop: async () => undefined,
        terminate: async () => [],
        proveAbsent: async () => {
          throw new Error("proveAbsent exploded");
        },
      } as never,
      rootIdentity: mockIdentity,
      terminateGroup: async () => {
        throw new Error("terminateGroup failed");
      },
      probeProcess: () => {
        throw new Error("probeProcess failed");
      },
    });

    expect(result.issues).toContain("Error: terminateGroup failed");
    expect(result.issues).toContain("Error: probeProcess failed");
    expect(result.issues).toContain(
      "root process absence was not proven for pid 40: exited=true, identity=unknown",
    );
    expect(result.issues).toContain("Error: proveAbsent exploded");
  });

  test("handles signal persistence failures with recovery and terminal retry failure", async () => {
    let attempts = 0;
    const result = await cleanupFailedAttempt({
      ...baseOptions,
      child: { pid: 40, exited: Promise.resolve(0) } as never,
      descendants: {
        stop: async () => undefined,
        terminate: async (_g, onSig) => onSig("SIGKILL"),
        proveAbsent: async () => true,
      } as never,
      rootIdentity: mockIdentity,
      pumps: [new Promise(() => undefined)],
      drainTimeoutMs: 1,
      persistSignal: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("persist failed once");
      },
      probeProcess: () => "present",
      terminateGroup: async (_p, _g, _e, _r, opts) => opts?.onSignal?.("SIGTERM"),
    });

    expect(result.issues).toContain(
      "root process absence was not proven for pid 40: exited=true, identity=present",
    );
    expect(result.issues).toContain("command output pumps did not settle after abort");
  });

  test("records issue when persistUndurable fails permanently in terminateGroup retry", async () => {
    const result = await cleanupFailedAttempt({
      ...baseOptions,
      child: { pid: 40, exited: Promise.resolve(0) } as never,
      rootIdentity: mockIdentity,
      persistSignal: () => {
        throw new Error("durable write failed permanently");
      },
      probeProcess: () => "absent",
      terminateGroup: async (_p, _g, _e, _r, opts) => opts?.onSignal?.("SIGTERM"),
    });

    expect(
      result.issues.some((issue) =>
        issue.includes("signal delivery ledger could not be persisted"),
      ),
    ).toBe(true);
  });

  test("handles descendants.terminate general error and persistUndurable permanent error", async () => {
    const genResult = await cleanupFailedAttempt({
      ...baseOptions,
      descendants: {
        stop: async () => undefined,
        terminate: async () => {
          throw new Error("direct terminate failure");
        },
        proveAbsent: async () => true,
      } as never,
    });
    expect(genResult.issues).toContain("Error: direct terminate failure");

    let persistFails = false;
    const persistResult = await cleanupFailedAttempt({
      ...baseOptions,
      descendants: {
        stop: async () => undefined,
        terminate: async (_g, onSig) => {
          persistFails = true;
          onSig("SIGKILL");
        },
        proveAbsent: async () => true,
      } as never,
      persistSignal: () => {
        if (persistFails) throw new Error("fail on descendant signal");
      },
    });

    expect(
      persistResult.issues.some((issue) =>
        issue.includes("signal delivery ledger could not be persisted"),
      ),
    ).toBe(true);
  });
});
