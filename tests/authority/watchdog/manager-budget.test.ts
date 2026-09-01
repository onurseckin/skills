import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  registerWatchdog,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("WatchdogManager - Registration & Default Timing Budgets", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("registerWatchdog applies default cadence and timeout when omitted", () => {
    const dir = "/virtual/watchdog/budget-defaults";
    const reg = registerWatchdog(
      {
        pulse_id: "pulse-default",
        phase: "loop",
        generation: 1,
      },
      dir,
    );

    expect(reg.watchdog.heartbeat_cadence_ms).toBe(DEFAULT_HEARTBEAT_CADENCE_MS);
    expect(reg.watchdog.timeout_ms).toBe(DEFAULT_WATCHDOG_TIMEOUT_MS);
    expect(reg.watchdog.pid).toBe(process.pid);
    expect(reg.watchdog.status).toBe("active");
  });

  test("registerWatchdog records custom metadata and custom timings", () => {
    const dir = "/virtual/watchdog/budget-custom";
    const reg = registerWatchdog(
      {
        pulse_id: "pulse-custom",
        phase: "planning",
        generation: 2,
        heartbeat_cadence_ms: 30_000,
        timeout_ms: 90_000,
        metadata: { note: "custom-watchdog-budget" },
      },
      dir,
    );

    expect(reg.watchdog.generation).toBe(2);
    expect(reg.watchdog.heartbeat_cadence_ms).toBe(30_000);
    expect(reg.watchdog.timeout_ms).toBe(90_000);
    expect(reg.watchdog.metadata?.note).toBe("custom-watchdog-budget");
  });
});
