import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  heartbeatWatchdog,
  registerWatchdog,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("WatchdogManager - Heartbeat Processing", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("heartbeatWatchdog touches heartbeat and updates timestamp", () => {
    const dir = "/virtual/watchdog/heartbeat-test";
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
  });

  test("heartbeatWatchdog throws when watchdog is not found", () => {
    const dir = "/virtual/watchdog/heartbeat-not-found";
    expect(() => heartbeatWatchdog("non-existent-id", {}, dir)).toThrow("watchdog not found");
  });
});
