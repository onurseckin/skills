import { describe, expect, test } from "bun:test";
import {
  readProcessIdentity,
  sameProcessIdentity,
} from "../../../olt/scripts/src/runner/process-identity.ts";

describe("readProcessIdentity", () => {
  test("returns undefined for pid 1, 0, negative, or non-integer values without dispatching", () => {
    expect(readProcessIdentity(1)).toBeUndefined();
    expect(readProcessIdentity(0)).toBeUndefined();
    expect(readProcessIdentity(-5)).toBeUndefined();
    expect(readProcessIdentity(1.5)).toBeUndefined();
  });

  test("dispatches to the real darwin implementation for this live process", () => {
    const identity = readProcessIdentity(process.pid, "darwin");
    expect(identity).toBeDefined();
    expect(identity!.pid).toBe(process.pid);
  });

  test("rejects a platform that is neither darwin nor linux", () => {
    expect(() => readProcessIdentity(process.pid, "win32")).toThrow(
      "strong process identity is unavailable",
    );
  });
});

describe("sameProcessIdentity", () => {
  test("matches only when both sides share pid and birth", () => {
    const a = { pid: 10, parent: 1, group: 10, birth: "b1" };
    expect(sameProcessIdentity(a, { ...a })).toBe(true);
    expect(sameProcessIdentity(a, { ...a, birth: "b2" })).toBe(false);
    expect(sameProcessIdentity(a, { ...a, pid: 11 })).toBe(false);
    expect(sameProcessIdentity(undefined, a)).toBe(false);
    expect(sameProcessIdentity(a, undefined)).toBe(false);
  });
});
