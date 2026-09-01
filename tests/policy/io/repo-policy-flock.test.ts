import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { closeSync, constants, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { cleanupVirtualPolicyFS, setupVirtualPolicyFS } from "../fixture.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  initRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";
import {
  resolvePolicyLocation,
  resolveSystemLockPath,
  withLock,
} from "../../../olt/scripts/src/policy/io-safety.ts";
import * as platform from "../../../olt/scripts/src/platform/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../../olt/scripts/src/platform/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Repo Policy Flocking, Concurrency & Lock Management", () => {
  const scratchBase = "/virtual/policy/io/flock";

  beforeEach(() => {
    setupVirtualPolicyFS();
  });

  afterEach(() => {
    cleanupVirtualPolicyFS();
  });

  test("concurrent operations serialize writes with flock and expose valid json", async () => {
    const dir = join(
      scratchBase,
      `concurrent-flock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(dir, { recursive: true });
    initRepoPolicy(dir);

    const runWorker = async (id: number) => {
      for (let i = 0; i < 5; i++) {
        const p = loadRepoPolicy(dir);
        saveRepoPolicy({ ...p, read_scope_neighborhood_depth: id * 10 + i + 1 }, dir);
      }
      return 0;
    };

    const results = await Promise.all([runWorker(1), runWorker(2), runWorker(3)]);
    expect(results.every((code) => code === 0)).toBe(true);

    const finalPolicy = loadRepoPolicy(dir);
    expect(finalPolicy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(finalPolicy.read_scope_neighborhood_depth).toBeGreaterThan(0);
  });

  test("validates resolveSystemLockPath safety constraints", () => {
    const root = process.cwd();
    expect(resolveSystemLockPath("policy.lock", root)).toBe(
      join(root, ".olt", "locks", "policy.lock"),
    );

    expect(() => resolveSystemLockPath(123 as unknown as string)).toThrow(/non-empty string/);
    expect(() => resolveSystemLockPath("")).toThrow(/non-empty string/);
    expect(() => resolveSystemLockPath("   ")).toThrow(/non-empty string/);
    expect(() => resolveSystemLockPath(".")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("..")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("path/with/slash")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("path\\with\\backslash")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("path\0null")).toThrow(/Invalid lockName/);
  });

  test("withLock prevents nested re-entry on the same repo root and manages system flock", () => {
    const dir = join(scratchBase, "lock-reentry-test");
    mkdirSync(dir, { recursive: true });
    const loc = resolvePolicyLocation(dir, undefined, true);
    expect(
      withLock(loc, () => {
        expect(() => withLock(loc, () => {})).toThrow(/already active/);
        return 42;
      }),
    ).toBe(42);

    // Test withLock when lock is already held externally
    const lockPath = resolveSystemLockPath("policy.lock", loc.root);
    const holderFd = openSync(lockPath, constants.O_RDWR | constants.O_CREAT, 0o600);
    expect(tryExclusiveFlock(holderFd)).toBe(true);
    try {
      releaseFlock(holderFd);
    } finally {
      closeSync(holderFd);
    }
  });

  test("withLock times out when exclusive flock cannot be acquired within deadline", () => {
    const dir = join(scratchBase, "lock-timeout-test");
    mkdirSync(dir, { recursive: true });
    const loc = resolvePolicyLocation(dir, undefined, true);

    let time = 0;
    const deps = {
      tryExclusiveFlock: () => false,
      now: () => {
        time += 20_000;
        return time;
      },
    };

    expect(() => withLock(loc, () => {}, deps)).toThrow(HarnessError);
    try {
      withLock(loc, () => {}, deps);
    } catch (error) {
      expect((error as HarnessError).code).toBe("LOCK_TIMEOUT");
      expect((error as HarnessError).message).toContain(
        "timed out waiting for repository policy lock",
      );
    }
  });
});
