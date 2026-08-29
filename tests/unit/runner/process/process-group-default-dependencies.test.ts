import { describe, expect, test } from "bun:test";
import {
  terminateProcessGroup,
  type ProcessGroupIdentity,
} from "../../../../olt/scripts/src/engine/runner/process/process-group.ts";

describe("terminateProcessGroup default inspect/wait dependencies", () => {
  test("uses the real process inspector and a real timer wait when no overrides are given", async () => {
    // Exercising the module's own default `inspect` (readProcessIdentity) and default `wait`
    // (a real setTimeout) without stubbing them: pid is this real, live test process, but the
    // expected identity's group/birth are deliberately wrong so the identity check fails and
    // no signal is ever actually sent — kill throwing proves that.
    const mismatchedExpected: ProcessGroupIdentity = {
      pid: process.pid,
      group: 999_999_999,
      birth: "not-the-real-birth",
    };
    const neverExits = new Promise<number>(() => undefined);
    const signals = await terminateProcessGroup(process.pid, 5, neverExits, mismatchedExpected);
    expect(signals).toEqual([]);
  });

  test("handles rejected exited promise via catch callback and sends both SIGTERM and SIGKILL", async () => {
    const expected: ProcessGroupIdentity = { pid: 50, group: 50, birth: "birth-50" };
    const signalsRecorded: NodeJS.Signals[] = [];
    const rejectedExited = Promise.reject(new Error("failed spawn"));
    const signals = await terminateProcessGroup(50, 0, rejectedExited, expected, {
      inspect: () => expected,
      kill: () => true,
      wait: async () => undefined,
      onSignal: (sig) => signalsRecorded.push(sig),
    });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(signalsRecorded).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("skips SIGTERM when already in signalsSent and delivers SIGKILL", async () => {
    const expected: ProcessGroupIdentity = { pid: 60, group: 60, birth: "birth-60" };
    const delivered: NodeJS.Signals[] = [];
    const signals = await terminateProcessGroup(60, 0, Promise.resolve(0), expected, {
      inspect: () => expected,
      kill: () => true,
      wait: async () => undefined,
      signalsSent: ["SIGTERM"],
      onSignal: (sig) => delivered.push(sig),
    });
    expect(signals).toEqual(["SIGKILL"]);
    expect(delivered).toEqual(["SIGKILL"]);
  });

  test("handles case where both SIGTERM and SIGKILL are already in signalsSent", async () => {
    const expected: ProcessGroupIdentity = { pid: 70, group: 70, birth: "birth-70" };
    const signals = await terminateProcessGroup(70, 0, Promise.resolve(0), expected, {
      inspect: () => expected,
      kill: () => true,
      wait: async () => undefined,
      signalsSent: ["SIGTERM", "SIGKILL"],
    });
    expect(signals).toEqual([]);
  });
});
