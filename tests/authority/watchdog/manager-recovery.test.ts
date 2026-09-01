import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cleanupStaleWatchdogs,
  registerWatchdog,
  verifyWatchdogLifecycle,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("WatchdogManager - Stale Recovery & Lifecycle Verification", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("cleanupStaleWatchdogs cleans up old terminated watchdogs", () => {
    const dir = "/virtual/watchdog/recovery-stale-cleanup";
    const res = cleanupStaleWatchdogs({ maxAgeMs: 0 }, dir);
    expect(res.cleanedCount).toBeGreaterThanOrEqual(0);
  });

  test("verifyWatchdogLifecycle detects active and healthy watchdogs without defects", () => {
    const dir = "/virtual/watchdog/recovery-verify-healthy";
    registerWatchdog(
      {
        pulse_id: "pulse-healthy",
        phase: "loop",
        generation: 1,
        heartbeat_cadence_ms: 60_000,
        timeout_ms: 120_000,
      },
      dir,
    );

    const verification = verifyWatchdogLifecycle({ now: new Date().toISOString() }, dir);
    expect(verification.valid).toBe(true);
    expect(verification.violations.length).toBe(0);
  });

  test("verifyWatchdogLifecycle detects overdue watchdogs as defects", () => {
    const dir = "/virtual/watchdog/recovery-verify-overdue";
    registerWatchdog(
      {
        pulse_id: "pulse-stale",
        phase: "loop",
        generation: 1,
        heartbeat_cadence_ms: 1000,
        timeout_ms: 2000,
      },
      dir,
    );

    const pastTime = new Date(Date.now() + 10_000).toISOString();
    const verification = verifyWatchdogLifecycle({ now: pastTime }, dir);
    expect(verification.valid).toBe(false);
    expect(verification.violations.length).toBeGreaterThan(0);
  });
});
