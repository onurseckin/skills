import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  registerWatchdog,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";

describe("WatchdogManager - Registration & Default Timing Budgets", () => {
  test("registerWatchdog applies default cadence and timeout when omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "budget-defaults-"));
    try {
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("registerWatchdog records custom metadata and custom timings", () => {
    const dir = mkdtempSync(join(tmpdir(), "budget-custom-"));
    try {
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
