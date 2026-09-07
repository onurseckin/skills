import { describe, expect, it } from "bun:test";
import { ensureDaemon, type EnsureDaemonPorts } from "../../src/daemon/index.ts";
import type { ChatroomPolicy } from "../../src/policy/index.ts";

const testPolicy: ChatroomPolicy = {
  runtime_command: "bun",
  harness_path: "/dummy/harness",
  notify_command: null,
  poll_interval_ms: 750,
  heartbeat_interval_ms: 5000,
  lease_ttl_ms: 120000,
  stale_after_ms: 30000,
  wedge_after_ms: 60000,
  max_spool_bytes: 33554432,
  max_spool_lines: 20000,
  spool_retention_ms: 86400000,
  respawn_budget_per_hour: 20,
  batch_size: 50,
  test_runner: null,
};

function makeLockPayloadJson(pid: number): string {
  return JSON.stringify({
    pid,
    holder: "daemon:room-1:reader-1",
    created_at: "2026-09-07T12:00:00.000Z",
  });
}

describe("ensureDaemon", () => {
  it("returns running with healthy false when heartbeat is stale", () => {
    const fixedNow = 100000;
    const staleMtime = fixedNow - 15000;
    const ports: EnsureDaemonPorts = {
      existsSync: (path: string) => path.endsWith(".lock") || path.endsWith(".health.json"),
      readFileSync: (_path: string) => makeLockPayloadJson(4242),
      statSync: (_path: string) => ({ mtimeMs: staleMtime }),
      isProcessAlive: (pid: number) => pid === 4242,
      now: () => fixedNow,
    };
    const res = ensureDaemon("room-1", "reader-1", {
      policy: testPolicy,
      ports,
    });
    expect(res.status).toBe("running");
    expect(res.pid).toBe(4242);
    expect(res.healthy).toBe(false);
    expect(res.probedMs).toBeGreaterThanOrEqual(0);
  });

  it("returns healthy false for both autoStart false and autoStart true when heartbeat is stale", () => {
    const fixedNow = 100000;
    const staleMtime = fixedNow - 15000;
    const ports: EnsureDaemonPorts = {
      existsSync: (path: string) => path.endsWith(".lock") || path.endsWith(".health.json"),
      readFileSync: (_path: string) => makeLockPayloadJson(4242),
      statSync: (_path: string) => ({ mtimeMs: staleMtime }),
      isProcessAlive: (pid: number) => pid === 4242,
      now: () => fixedNow,
    };
    const resAutoFalse = ensureDaemon("room-1", "reader-1", {
      policy: testPolicy,
      autoStart: false,
      ports,
    });
    expect(resAutoFalse.status).toBe("running");
    expect(resAutoFalse.pid).toBe(4242);
    expect(resAutoFalse.healthy).toBe(false);

    const resAutoTrue = ensureDaemon("room-1", "reader-1", {
      policy: testPolicy,
      autoStart: true,
      ports,
    });
    expect(resAutoTrue.status).toBe("running");
    expect(resAutoTrue.pid).toBe(4242);
    expect(resAutoTrue.healthy).toBe(false);
  });

  it("returns running with healthy true when heartbeat is fresh", () => {
    const fixedNow = 100000;
    const freshMtime = fixedNow - 4000;
    const ports: EnsureDaemonPorts = {
      existsSync: (path: string) => path.endsWith(".lock") || path.endsWith(".health.json"),
      readFileSync: (_path: string) => makeLockPayloadJson(4242),
      statSync: (_path: string) => ({ mtimeMs: freshMtime }),
      isProcessAlive: (pid: number) => pid === 4242,
      now: () => fixedNow,
    };
    const res = ensureDaemon("room-1", "reader-1", {
      policy: testPolicy,
      ports,
    });
    expect(res.status).toBe("running");
    expect(res.pid).toBe(4242);
    expect(res.healthy).toBe(true);
    expect(res.probedMs).toBeGreaterThanOrEqual(0);
  });

  it("returns running with healthy false when health record does not exist", () => {
    const ports: EnsureDaemonPorts = {
      existsSync: (path: string) => path.endsWith(".lock"),
      readFileSync: (_path: string) => makeLockPayloadJson(4242),
      statSync: (_path: string) => ({ mtimeMs: 0 }),
      isProcessAlive: (pid: number) => pid === 4242,
      now: () => 100000,
    };
    const res = ensureDaemon("room-1", "reader-1", {
      policy: testPolicy,
      ports,
    });
    expect(res.status).toBe("running");
    expect(res.pid).toBe(4242);
    expect(res.healthy).toBe(false);
    expect(res.probedMs).toBeGreaterThanOrEqual(0);
  });

  it("returns failed when lock does not exist and autoStart is false", () => {
    const ports: EnsureDaemonPorts = {
      existsSync: (_path: string) => false,
      readFileSync: (_path: string) => "",
      statSync: (_path: string) => ({ mtimeMs: 0 }),
      isProcessAlive: (_pid: number) => false,
      now: () => 100000,
    };
    const res = ensureDaemon("room-1", "reader-1", {
      policy: testPolicy,
      autoStart: false,
      ports,
    });
    expect(res.status).toBe("failed");
    expect(res.pid).toBeNull();
    expect(res.healthy).toBe(false);
    expect(res.probedMs).toBeGreaterThanOrEqual(0);
  });
});
