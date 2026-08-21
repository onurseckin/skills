import { describe, expect, test } from "bun:test";
import {
  processHasToken,
  scanDarwinTokenOwners,
} from "../../orchestrating-long-tasks/scripts/src/runner/darwin-token-owners.ts";
import type { ProcessIdentity } from "../../orchestrating-long-tasks/scripts/src/runner/process-identity.ts";

const sampleIdentity: ProcessIdentity = {
  pid: 1234,
  parent: 1,
  group: 1234,
  birth: "2026-08-14T00:00:00.000Z",
};

describe("darwin-token-owners", () => {
  test("returns false or empty when token is empty", () => {
    const budget = { bytes: 0 };
    expect(processHasToken(process.pid, "", budget)).toBe(false);
    expect(scanDarwinTokenOwners([process.pid], "", () => sampleIdentity)).toEqual([]);
  });

  test("skips process.pid and missing pids", () => {
    const res = scanDarwinTokenOwners([process.pid, 999999], "some-token", (pid) =>
      pid === 999999 ? undefined : sampleIdentity,
    );
    expect(res).toEqual([]);
  });

  test("identifies spawned child process with ownership token", async () => {
    const token = "test-token-darwin-ownership-123";
    const proc = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 5000)"], {
      env: {
        ...process.env,
        HARNESS_INTERNAL_OWNERSHIP_TOKEN: token,
      },
    });

    try {
      const identify = (pid: number): ProcessIdentity | undefined => {
        if (pid === proc.pid) {
          return {
            pid: proc.pid,
            parent: process.pid,
            group: proc.pid,
            birth: "2026-08-14T00:00:00.000Z",
          };
        }
        return undefined;
      };

      const budget = { bytes: 0 };
      const has = processHasToken(proc.pid, token, budget);
      expect(has).toBe(true);
      expect(budget.bytes).toBeGreaterThan(0);

      const owners = scanDarwinTokenOwners([proc.pid], token, identify);
      expect(owners.length).toBe(1);
      expect(owners[0].pid).toBe(proc.pid);

      const noOwners = scanDarwinTokenOwners([proc.pid], "different-token", identify);
      expect(noOwners).toEqual([]);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("throws when budget is exhausted in processHasToken", () => {
    const budget = { bytes: 65 * 1024 * 1024 };
    expect(() => processHasToken(process.pid, "token", budget)).toThrow(
      "ownership-token environment scan is too large",
    );
  });

  test("returns false for non-existent pid in processHasToken", () => {
    const budget = { bytes: 0 };
    expect(processHasToken(999999, "token", budget)).toBe(false);
  });

  test("throws when process identity changes after scan", () => {
    let callCount = 0;
    const identify = (pid: number): ProcessIdentity | undefined => {
      callCount += 1;
      return {
        pid,
        parent: 1,
        group: pid,
        birth: `2026-08-14T00:00:0${callCount}.000Z`,
      };
    };

    expect(() => scanDarwinTokenOwners([12345], "token", identify)).toThrow(
      "process identity changed during ownership-token scan",
    );
  });

  test("handles catch block in scanDarwinTokenOwners when budget exceeds limit", async () => {
    const proc = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 5000)"]);
    try {
      const budget = { bytes: 0 };
      processHasToken(proc.pid, "token", budget);
      const b = budget.bytes;
      const N = Math.floor((64 * 1024 * 1024) / b) + 1;
      const pids = new Array(N).fill(proc.pid);

      // Case 1: same identity on error -> rethrows budget error
      expect(() =>
        scanDarwinTokenOwners(pids, "token", (pid) => ({
          pid,
          parent: 1,
          group: pid,
          birth: "fixed-birth",
        })),
      ).toThrow("ownership-token environment scan is too large");

      // Case 2: changed identity on error -> throws identity changed error
      let calls = 0;
      expect(() =>
        scanDarwinTokenOwners(pids, "token", (pid) => {
          calls += 1;
          if (calls === (N - 1) * 2 + 2) {
            return { pid, parent: 1, group: pid, birth: "birth-mutated" };
          }
          return { pid, parent: 1, group: pid, birth: "birth-original" };
        }),
      ).toThrow("process identity changed");

      // Case 3: after disappears on error -> continues
      let count3 = 0;
      const res = scanDarwinTokenOwners(pids, "token", (pid) => {
        count3 += 1;
        if (count3 >= (N - 1) * 2 + 2) {
          return undefined;
        }
        return { pid, parent: 1, group: pid, birth: "b" };
      });
      expect(Array.isArray(res)).toBe(true);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
