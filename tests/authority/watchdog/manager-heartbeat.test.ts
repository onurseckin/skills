import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  heartbeatWatchdog,
  registerWatchdog,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";

describe("WatchdogManager - Heartbeat Processing", () => {
  test("heartbeatWatchdog touches heartbeat and updates timestamp", () => {
    const dir = mkdtempSync(join(tmpdir(), "heartbeat-test-"));
    try {
      const reg = registerWatchdog(
        {
          pulse_id: "pulse-1",
          phase: "execution",
          generation: 1,
          agent_id: "agent-1",
          heartbeat_cadence_ms: 10_000,
          timeout_ms: 20_000,
        },
        dir,
      );

      const beforeHeartbeat = reg.watchdog.last_heartbeat_at;
      const updated = heartbeatWatchdog(
        reg.watchdog.id,
        { now: new Date(Date.now() + 1000).toISOString() },
        dir,
      );

      expect(updated.id).toBe(reg.watchdog.id);
      expect(updated.status).toBe("active");
      expect(new Date(updated.last_heartbeat_at).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeHeartbeat).getTime(),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("heartbeatWatchdog throws when watchdog is not found", () => {
    const dir = mkdtempSync(join(tmpdir(), "heartbeat-not-found-"));
    try {
      expect(() => heartbeatWatchdog("non-existent-id", {}, dir)).toThrow("watchdog not found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
