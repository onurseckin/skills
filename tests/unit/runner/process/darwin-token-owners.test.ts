import { describe, expect, test } from "bun:test";
import {
  processHasToken,
  scanDarwinTokenOwners,
} from "../../../../olt/scripts/src/engine/runner/process/darwin/darwin-token-owners.ts";
import type { ProcessIdentity } from "../../../../olt/scripts/src/engine/runner/process/process-identity.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("scanDarwinTokenOwners edge cases", () => {
  test("returns empty array when token is empty", () => {
    const result = scanDarwinTokenOwners([1234], "", () => ({
      pid: 1234,
      parent: 1,
      group: 1234,
      birth: "1000",
    }));
    expect(result).toEqual([]);
  });

  test("skips process.pid", () => {
    const result = scanDarwinTokenOwners([process.pid], "some-token", () => ({
      pid: process.pid,
      parent: 1,
      group: process.pid,
      birth: "1000",
    }));
    expect(result).toEqual([]);
  });

  test("skips pid when identify returns undefined initially", () => {
    const result = scanDarwinTokenOwners([99999], "some-token", () => undefined);
    expect(result).toEqual([]);
  });

  test("detects process identity change after processHasToken", () => {
    let callCount = 0;
    const identify = (pid: number): ProcessIdentity | undefined => {
      callCount += 1;
      if (callCount === 1) return { pid, parent: 1, group: pid, birth: "1000" };
      return { pid, parent: 1, group: pid, birth: "2000" }; // birth changed!
    };

    expect(() => scanDarwinTokenOwners([99999], "some-token", identify)).toThrow(
      "process identity changed during ownership-token scan for pid 99999",
    );
  });

  test("skips pid if process exited after processHasToken", () => {
    let callCount = 0;
    const identify = (pid: number): ProcessIdentity | undefined => {
      callCount += 1;
      if (callCount === 1) return { pid, parent: 1, group: pid, birth: "1000" };
      return undefined;
    };

    const result = scanDarwinTokenOwners([99999], "some-token", identify);
    expect(result).toEqual([]);
  });

  test("rethrows error when processHasToken throws and identity is unchanged", () => {
    const child = Bun.spawn(["sleep", "10"]);
    const origRead = Buffer.prototype.readBigUInt64LE;
    Buffer.prototype.readBigUInt64LE = function () {
      return 10_000_000n;
    };
    try {
      const pids = Array(8).fill(child.pid);
      const identify = (pid: number): ProcessIdentity | undefined => ({
        pid,
        parent: 1,
        group: pid,
        birth: "1000",
      });

      expect(() => scanDarwinTokenOwners(pids, "token", identify)).toThrow(
        "ownership-token environment scan is too large",
      );
    } finally {
      Buffer.prototype.readBigUInt64LE = origRead;
      child.kill();
    }
  });

  test("throws identity changed when processHasToken throws and identity changed", () => {
    const child = Bun.spawn(["sleep", "10"]);
    const origRead = Buffer.prototype.readBigUInt64LE;
    Buffer.prototype.readBigUInt64LE = function () {
      return 10_000_000n;
    };
    try {
      const pids = Array(8).fill(child.pid);
      let callCount = 0;
      const identify = (pid: number): ProcessIdentity | undefined => {
        callCount += 1;
        // On iteration 7 (calls 13 & 14), call 13 is before, call 14 is after inside catch block
        if (callCount >= 14) {
          return { pid, parent: 1, group: pid, birth: "different-birth" };
        }
        return { pid, parent: 1, group: pid, birth: "fixed-birth" };
      };

      expect(() => scanDarwinTokenOwners(pids, "token", identify)).toThrow(
        /process identity changed during ownership-token scan/,
      );
    } finally {
      Buffer.prototype.readBigUInt64LE = origRead;
      child.kill();
    }
  });

  test("skips pid when processHasToken throws but process exited afterwards", () => {
    const child = Bun.spawn(["sleep", "10"]);
    const origRead = Buffer.prototype.readBigUInt64LE;
    Buffer.prototype.readBigUInt64LE = function () {
      return 10_000_000n;
    };
    try {
      const pids = Array(8).fill(child.pid);
      let callCount = 0;
      const identify = (pid: number): ProcessIdentity | undefined => {
        callCount += 1;
        // On iteration 7 (calls 13 & 14), call 14 is after inside catch block
        if (callCount >= 14) return undefined;
        return { pid, parent: 1, group: pid, birth: "fixed-birth" };
      };

      const result = scanDarwinTokenOwners(pids, "token", identify);
      expect(result).toEqual([]);
    } finally {
      Buffer.prototype.readBigUInt64LE = origRead;
      child.kill();
    }
  });
});

describe("processHasToken", () => {
  test("returns false for empty token", () => {
    expect(processHasToken(process.pid, "", { bytes: 0 })).toBe(false);
  });

  test("returns false for current process when token does not match", () => {
    const budget = { bytes: 0 };
    expect(processHasToken(process.pid, "nonexistent-token-abc-123", budget)).toBe(false);
    expect(budget.bytes).toBeGreaterThan(0);
  });

  test("throws HarnessError when scan budget is exceeded", () => {
    const exhaustedBudget = { bytes: 64 * 1024 * 1024 + 1 };
    expect(() => processHasToken(process.pid, "token", exhaustedBudget)).toThrow(
      "ownership-token environment scan is too large",
    );
  });
});
