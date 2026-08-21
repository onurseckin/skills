import { describe, expect, test } from "bun:test";
import {
  darwinPipeHandles,
  darwinPipeOwners,
  darwinProcessIdentity,
  darwinTokenOwnerIdentities,
} from "../../orchestrating-long-tasks/scripts/src/runner/darwin-pipes.ts";

describe("darwin-pipes", () => {
  test("darwinProcessIdentity returns identity for valid process and undefined for nonexistent", () => {
    const self = darwinProcessIdentity(process.pid);
    expect(self).toBeDefined();
    expect(self?.pid).toBe(process.pid);
    expect(self?.parent).toBeGreaterThanOrEqual(0);
    expect(self?.group).toBeGreaterThanOrEqual(0);
    expect(self?.birth).toMatch(/^\d+:\d+$/);

    const nonexistent = darwinProcessIdentity(999999);
    expect(nonexistent).toBeUndefined();
  });

  test("darwinPipeHandles retrieves open handles for process or empty set for nonexistent", () => {
    const handles = darwinPipeHandles(process.pid);
    expect(handles instanceof Set).toBe(true);

    const empty = darwinPipeHandles(999999);
    expect(empty.size).toBe(0);
  });

  test("darwinPipeOwners finds pipe owners matching anchors and skips process.pid", () => {
    const emptyOwners = darwinPipeOwners(new Set());
    expect(emptyOwners.size).toBe(0);

    const selfHandles = darwinPipeHandles(process.pid);
    if (selfHandles.size > 0) {
      const owners = darwinPipeOwners(selfHandles);
      expect(owners.has(process.pid)).toBe(false);
    }
  });

  test("darwinTokenOwnerIdentities scans user processes for ownership token", async () => {
    expect(darwinTokenOwnerIdentities("")).toEqual([]);

    const token = "darwin-pipes-test-token-789";
    const proc = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 5000)"], {
      env: {
        ...process.env,
        HARNESS_INTERNAL_OWNERSHIP_TOKEN: token,
      },
    });

    try {
      const owners = darwinTokenOwnerIdentities(token);
      expect(owners.some((owner) => owner.pid === proc.pid)).toBe(true);

      const noOwners = darwinTokenOwnerIdentities("non-existent-token-xyz");
      expect(noOwners).toEqual([]);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
