import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefaultWatchdogStore,
  saveWatchdogStore,
  setWatchdogLockTimingForTesting,
  withWatchdogStoreLock,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
import { openVerifiedParent } from "../../../olt/scripts/src/authority/watchdog/lock.ts";

describe("WatchdogManager - Concurrency & Lock Exclusivity", () => {
  test("openVerifiedParent opens real directory descriptor cleanly", () => {
    const dir = mkdtempSync(join(tmpdir(), "lock-parent-"));
    try {
      const sub = join(dir, "store-dir");
      mkdirSync(sub);
      const parent = openVerifiedParent(sub, false);
      expect(parent.descriptor).toBeGreaterThan(0);
      expect(parent.metadata.isDirectory()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("withWatchdogStoreLock acquires lock and executes callback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lock-callback-"));
    try {
      const storeFile = join(dir, "watchdogs.json");
      saveWatchdogStore(createDefaultWatchdogStore(), storeFile);

      let executed = false;
      await withWatchdogStoreLock(storeFile, async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
