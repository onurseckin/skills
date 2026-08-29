import { describe, expect, test } from "bun:test";
import { signalProcessGroup } from "../../../../olt/scripts/src/engine/runner/process/process-group.ts";

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("signalProcessGroup error handling", () => {
  test("returns false when the process group is already gone (ESRCH)", () => {
    const result = signalProcessGroup(40, "SIGTERM", () => {
      throw errnoError("ESRCH");
    });
    expect(result).toBe(false);
  });

  test("wraps a permission failure (EPERM) into a HarnessError", () => {
    expect(() =>
      signalProcessGroup(40, "SIGTERM", () => {
        throw errnoError("EPERM");
      }),
    ).toThrow("permission refused while signaling process group 40");
  });

  test("rethrows an unrecognized errno as-is", () => {
    const unexpected = errnoError("EINVAL");
    expect(() =>
      signalProcessGroup(40, "SIGTERM", () => {
        throw unexpected;
      }),
    ).toThrow(unexpected);
  });

  test("returns true when the signal is delivered successfully", () => {
    let calledWith: [number, NodeJS.Signals] | undefined;
    const result = signalProcessGroup(40, "SIGKILL", (pid, signal) => {
      calledWith = [pid, signal];
      return true;
    });
    expect(result).toBe(true);
    expect(calledWith).toEqual([-40, "SIGKILL"]);
  });
});
