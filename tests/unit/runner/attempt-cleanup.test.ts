import { describe, expect, test } from "bun:test";
import { cleanupFailedAttempt } from "../../../orchestrating-long-tasks/scripts/src/runner/attempt-cleanup.ts";

function options(exited: Promise<number>) {
  return {
    child: { pid: 40, exited } as never,
    descendants: {
      stop: async () => undefined,
      terminate: async () => [],
      proveAbsent: async () => true,
    } as never,
    rootIdentity: undefined,
    trackerReady: Promise.resolve(undefined),
    activityRecord: undefined,
    pumps: [],
    pumpAbort: new AbortController(),
    graceMs: 0,
    drainTimeoutMs: 0,
  };
}

describe("failed attempt cleanup", () => {
  test("keeps an unbound short-lived child stranded despite its settled exit", async () => {
    expect(await cleanupFailedAttempt(options(Promise.resolve(0)))).toEqual({
      issues: [
        "termination withheld because strong root identity was unavailable; residual pid 40 requires inspection",
      ],
      signals: [],
    });
  });

  test("fails closed without signaling when an unbound child has not exited", async () => {
    const result = await cleanupFailedAttempt(options(new Promise(() => undefined)));
    expect(result).toEqual({
      issues: [
        "termination withheld because strong root identity was unavailable; residual pid 40 requires inspection",
      ],
      signals: [],
    });
  });
});
