import { describe, expect, test } from "bun:test";
import {
  processHasToken,
  scanDarwinTokenOwners,
} from "../../../olt/scripts/src/engine/runner/darwin-token-owners.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/process-identity.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

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
    const pids = Array(40000).fill(process.ppid);
    const identify = (pid: number): ProcessIdentity | undefined => ({
      pid,
      parent: 1,
      group: pid,
      birth: "1000",
    });

    expect(() => scanDarwinTokenOwners(pids, "token", identify)).toThrow(
      "ownership-token environment scan is too large",
    );
  });

  test("throws identity changed when processHasToken throws and identity changed", () => {
    const probe = { bytes: 0 };
    processHasToken(process.ppid, "probe", probe);
    const maxCalls = Math.floor((64 * 1024 * 1024) / (probe.bytes || 1));
    const pids = Array(maxCalls + 10).fill(process.ppid);
    let isBefore = false;
    let iteration = 0;
    const identify = (pid: number): ProcessIdentity | undefined => {
      isBefore = !isBefore;
      if (isBefore) {
        iteration += 1;
        return { pid, parent: 1, group: pid, birth: "fixed-birth" };
      }
      // This is "after"
      if (iteration > maxCalls) {
        return { pid, parent: 1, group: pid, birth: "different-birth" };
      }
      return { pid, parent: 1, group: pid, birth: "fixed-birth" };
    };

    expect(() => scanDarwinTokenOwners(pids, "token", identify)).toThrow(
      /process identity changed during ownership-token scan/,
    );
  });

  test("skips pid when processHasToken throws but process exited afterwards", () => {
    const probe = { bytes: 0 };
    processHasToken(process.ppid, "probe", probe);
    const maxCalls = Math.floor((64 * 1024 * 1024) / (probe.bytes || 1));
    const pids = Array(maxCalls + 10).fill(process.ppid);
    let isBefore = false;
    let iteration = 0;
    const identify = (pid: number): ProcessIdentity | undefined => {
      isBefore = !isBefore;
      if (isBefore) {
        iteration += 1;
        return { pid, parent: 1, group: pid, birth: "fixed-birth" };
      }
      // This is "after"
      if (iteration > maxCalls) return undefined;
      return { pid, parent: 1, group: pid, birth: "fixed-birth" };
    };

    const result = scanDarwinTokenOwners(pids, "token", identify);
    expect(result).toEqual([]);
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
