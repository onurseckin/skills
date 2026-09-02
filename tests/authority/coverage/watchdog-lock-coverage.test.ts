import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeSync } from "node:fs";
import { join } from "node:path";
import {
  acquireExclusiveLock,
  activeWatchdogAuthorityPaths,
  activeWatchdogLockParents,
  activeWatchdogLockPaths,
  assertCurrentLockAuthority,
  assertRealDirectory,
  delay,
  openVerifiedParent,
  requiredNoFollowFlag,
  sameInode,
  setWatchdogLockTimingForTesting,
  watchdogAuthorityRoot,
  withWatchdogStoreLock,
} from "../../../olt/scripts/src/authority/watchdog/lock.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("WatchdogLock Comprehensive Coverage", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  it("validates timing configurator error conditions and restore callback", () => {
    expect(() => setWatchdogLockTimingForTesting(-10, 5)).toThrow(HarnessError);
    expect(() => setWatchdogLockTimingForTesting(100, -1)).toThrow(HarnessError);
    expect(() => setWatchdogLockTimingForTesting(NaN, 5)).toThrow(HarnessError);

    const restore = setWatchdogLockTimingForTesting(50, 5);
    expect(typeof restore).toBe("function");
    restore();
  });

  it("checks requiredNoFollowFlag, delay, and sameInode comparator", () => {
    const flag = requiredNoFollowFlag();
    expect(typeof flag).toBe("number");
    expect(flag).toBeGreaterThan(0);

    const start = performance.now();
    delay(5);
    expect(performance.now() - start).toBeGreaterThanOrEqual(2);

    expect(sameInode({ dev: 100, ino: 200 }, { dev: 100, ino: 200 })).toBe(true);
    expect(sameInode({ dev: 100, ino: 200 }, { dev: 101, ino: 200 })).toBe(false);
    expect(sameInode({ dev: 100, ino: 200 }, { dev: 100, ino: 201 })).toBe(false);
  });

  it("assertRealDirectory validates directories and rejects files/missing paths", () => {
    const vfs = getVirtualAuthorityFS();
    const testDir = "/virtual/watchdog/real-dir-check";
    vfs.mkdirSync(testDir, { recursive: true });

    const stats = assertRealDirectory(testDir, "test directory");
    expect(stats.isDirectory()).toBe(true);

    const filePath = join(testDir, "sample.txt");
    vfs.writeFileSync(filePath, "data");
    expect(() => assertRealDirectory(filePath, "file as dir")).toThrow(HarnessError);
    expect(() => assertRealDirectory(join(testDir, "phantom"), "missing dir")).toThrow(
      HarnessError,
    );
  });

  it("openVerifiedParent handles creation and directory verification", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/watchdog/parent-open";
    const nonExistent = join(sandbox, "not-here");

    expect(() => openVerifiedParent(nonExistent, false)).toThrow(HarnessError);

    const opened = openVerifiedParent(nonExistent, true);
    expect(opened.descriptor).toBeGreaterThan(0);
    expect(opened.metadata.isDirectory()).toBe(true);
    closeSync(opened.descriptor);
  });

  it("resolves watchdogAuthorityRoot for .olt paths, subdirs, and missing ancestors", () => {
    const vfs = getVirtualAuthorityFS();
    const root = "/virtual/watchdog/auth-root-test";
    const oltDir = join(root, ".olt");
    vfs.mkdirSync(oltDir, { recursive: true });

    const storeInOlt = join(oltDir, "watchdogs.json");
    expect(watchdogAuthorityRoot(storeInOlt)).toBe(root);

    const deepDir = join(root, "subdir", "deep");
    vfs.mkdirSync(deepDir, { recursive: true });
    const storeInDeep = join(deepDir, "store.json");
    expect(watchdogAuthorityRoot(storeInDeep)).toBe(deepDir);

    const nonExistent = join(root, "uncreated", "dir", "file.json");
    expect(watchdogAuthorityRoot(nonExistent)).toBe(root);
  });

  it("handles acquireExclusiveLock with timeout handling", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/watchdog/exclusive-flock";
    vfs.mkdirSync(sandbox, { recursive: true });
    const opened = openVerifiedParent(sandbox, false);

    expect(() => acquireExclusiveLock(opened.descriptor, sandbox)).not.toThrow();
    closeSync(opened.descriptor);
  });

  it("executes operations with withWatchdogStoreLock and asserts lock authority", () => {
    const vfs = getVirtualAuthorityFS();
    const root = "/virtual/watchdog/with-lock-test";
    const oltDir = join(root, ".olt");
    vfs.mkdirSync(oltDir, { recursive: true });
    const storeFile = join(oltDir, "watchdogs.json");

    expect(() => assertCurrentLockAuthority(storeFile)).toThrow(HarnessError);

    let executed = false;
    const result = withWatchdogStoreLock(storeFile, () => {
      executed = true;
      assertCurrentLockAuthority(storeFile);
      return "operation-success";
    });

    expect(executed).toBe(true);
    expect(result).toBe("operation-success");
    expect(activeWatchdogLockPaths.size).toBe(0);
  });

  it("handles concurrent collision and mutation failure in withWatchdogStoreLock", () => {
    const vfs = getVirtualAuthorityFS();
    const root = "/virtual/watchdog/collision-test";
    const oltDir = join(root, ".olt");
    vfs.mkdirSync(oltDir, { recursive: true });
    const storeFile = join(oltDir, "watchdogs.json");

    expect(() => {
      withWatchdogStoreLock(storeFile, () => {
        withWatchdogStoreLock(storeFile, () => "nested");
      });
    }).toThrow(HarnessError);

    expect(() => {
      withWatchdogStoreLock(storeFile, () => {
        throw new Error("Simulated mutation failure");
      });
    }).toThrow("Simulated mutation failure");
  });

  it("detects modified lock authority and handles root matching parent", () => {
    const vfs = getVirtualAuthorityFS();
    const root = "/virtual/watchdog/same-root-parent";
    vfs.mkdirSync(root, { recursive: true });
    const storeFile = join(root, "direct-store.json");

    const res = withWatchdogStoreLock(storeFile, () => {
      assertCurrentLockAuthority(storeFile);
      return 12345;
    });
    expect(res).toBe(12345);

    activeWatchdogLockParents.set(root, { dev: 9999, ino: 8888 });
    activeWatchdogAuthorityPaths.set(root, root);
    expect(() => assertCurrentLockAuthority(storeFile)).toThrow(HarnessError);
    activeWatchdogLockParents.delete(root);
    activeWatchdogAuthorityPaths.delete(root);
  });
});
