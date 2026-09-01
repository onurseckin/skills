import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createDefaultWatchdogStore,
  saveWatchdogStore,
  setWatchdogLockTimingForTesting,
  withWatchdogStoreLock,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
import { openVerifiedParent } from "../../../olt/scripts/src/authority/watchdog/lock.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("WatchdogManager - Concurrency & Lock Exclusivity", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("openVerifiedParent opens real directory descriptor cleanly", () => {
    const dir = "/virtual/watchdog/concurrency-parent";
    const sub = join(dir, "store-dir");
    mkdirSync(sub, { recursive: true });
    const parent = openVerifiedParent(sub, false);
    expect(parent.descriptor).toBeGreaterThan(0);
    expect(parent.metadata.isDirectory()).toBe(true);
  });

  test("withWatchdogStoreLock acquires lock and executes callback", async () => {
    const dir = "/virtual/watchdog/concurrency-callback";
    const storeFile = join(dir, "watchdogs.json");
    saveWatchdogStore(createDefaultWatchdogStore(), storeFile);

    let executed = false;
    await withWatchdogStoreLock(storeFile, async () => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  test("setWatchdogLockTimingForTesting rejects negative durations and restores clean callback", () => {
    expect(() => setWatchdogLockTimingForTesting(-1, 10)).toThrow(
      "must be finite and non-negative",
    );
    expect(() => setWatchdogLockTimingForTesting(100, -5)).toThrow(
      "must be finite and non-negative",
    );

    const restore = setWatchdogLockTimingForTesting(100, 10);
    expect(typeof restore).toBe("function");
    restore();
  });
});
