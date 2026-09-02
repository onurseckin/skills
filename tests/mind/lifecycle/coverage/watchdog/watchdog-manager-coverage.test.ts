import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_WATCHDOG_FILE,
  DEFAULT_WATCHDOG_FILE,
  auditProcessLiveness,
  createDefaultWatchdogStore,
  loadMindWatchdogStore,
  resolveCanonicalWatchdogStorePath,
  resolveWatchdogStorePath,
  saveMindWatchdogStore,
  type WatchdogRecord,
  type WatchdogStore,
} from "../../../../../olt/scripts/src/mind/lifecycle/watchdog/watchdog-manager.ts";

describe("Watchdog Manager Coverage Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "watchdog-mgr-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const mkRecord = (id: string, pid: number = process.pid): WatchdogRecord => ({
    id,
    generation: 1,
    pulse_id: "pulse-1",
    phase: "execution",
    run_id: "run-1",
    run_root: "/runs/run-1",
    pid,
    ppid: process.ppid,
    agent_id: "agent-1",
    started_at: "2026-09-01T10:00:00.000Z",
    last_heartbeat_at: "2026-09-01T10:05:00.000Z",
    heartbeat_cadence_ms: 5000,
    timeout_ms: 30000,
    status: "active",
    terminated_at: null,
    termination_reason: null,
  });

  it("exports constants and generates default store structure", () => {
    expect(CANONICAL_WATCHDOG_FILE).toBe(".olt/watchdogs.json");
    expect(DEFAULT_WATCHDOG_FILE).toBe(".olt/watchdogs.json");

    const store = createDefaultWatchdogStore();
    expect(store.schema).toBe("harness.watchdog_store");
    expect(store.version).toBe("1.0.0");
    expect(store.watchdogs).toEqual([]);
    expect(Number.isFinite(Date.parse(store.last_updated))).toBe(true);
  });

  it("resolves store paths correctly for canonical, custom, empty, and default paths", () => {
    const canonical = resolveCanonicalWatchdogStorePath(tempDir);
    expect(canonical).toContain("watchdogs.json");

    const custom = resolveWatchdogStorePath(join(tempDir, "custom.json"));
    expect(custom).toBe(join(tempDir, "custom.json"));

    const empty = resolveWatchdogStorePath("");
    expect(empty).toContain(DEFAULT_WATCHDOG_FILE);

    const whitespace = resolveWatchdogStorePath("   ");
    expect(whitespace).toContain(DEFAULT_WATCHDOG_FILE);

    const def = resolveWatchdogStorePath(undefined);
    expect(def).toContain(DEFAULT_WATCHDOG_FILE);
  });

  it("loads watchdog store from non-existent, invalid, and corrupted files", () => {
    const nonExistent = join(tempDir, "missing.json");
    expect(loadMindWatchdogStore(nonExistent).watchdogs).toEqual([]);

    const invalidJsonPath = join(tempDir, "corrupted.json");
    writeFileSync(invalidJsonPath, "{ not-json");
    expect(loadMindWatchdogStore(invalidJsonPath).watchdogs).toEqual([]);

    const noWatchdogsKeyPath = join(tempDir, "no-watchdogs.json");
    writeFileSync(noWatchdogsKeyPath, JSON.stringify({ foo: "bar" }));
    expect(loadMindWatchdogStore(noWatchdogsKeyPath).watchdogs).toEqual([]);

    const primitiveJsonPath = join(tempDir, "primitive.json");
    writeFileSync(primitiveJsonPath, "12345");
    expect(loadMindWatchdogStore(primitiveJsonPath).watchdogs).toEqual([]);
  });

  it("loads valid store and roundtrips via saveMindWatchdogStore with various parameter orders", () => {
    const targetPath1 = join(tempDir, "nested", "sub", "store1.json");
    const testStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: "1.0.0",
      last_updated: "2026-09-01T12:00:00.000Z",
      watchdogs: [mkRecord("wd-1")],
    };

    saveMindWatchdogStore(testStore, targetPath1);
    expect(existsSync(targetPath1)).toBe(true);
    const loaded1 = loadMindWatchdogStore(targetPath1);
    expect(loaded1.watchdogs).toHaveLength(1);
    expect(loaded1.watchdogs[0].id).toBe("wd-1");

    const targetPath2 = join(tempDir, "store2.json");
    saveMindWatchdogStore(targetPath2, testStore);
    const loaded2 = loadMindWatchdogStore(targetPath2);
    expect(loaded2.watchdogs[0].id).toBe("wd-1");

    const targetPath3 = join(tempDir, "store3.json");
    saveMindWatchdogStore(null, targetPath3);
    const loaded3 = loadMindWatchdogStore(targetPath3);
    expect(loaded3.watchdogs).toEqual([]);
  });

  it("audits process liveness correctly for dead, alive, healthy, and frozen states", () => {
    const deadPid = 999999999;
    const deadResult = auditProcessLiveness(deadPid, Date.now() - 100000);
    expect(deadResult.isAlive).toBe(false);
    expect(deadResult.isFrozen).toBe(false);

    const aliveNoHeartbeat = auditProcessLiveness(process.pid);
    expect(aliveNoHeartbeat.isAlive).toBe(true);
    expect(aliveNoHeartbeat.isFrozen).toBe(false);

    const aliveRecent = auditProcessLiveness(process.pid, Date.now() - 5000, 60000);
    expect(aliveRecent.isAlive).toBe(true);
    expect(aliveRecent.isFrozen).toBe(false);

    const aliveFrozenDefault = auditProcessLiveness(process.pid, Date.now() - 70000);
    expect(aliveFrozenDefault.isAlive).toBe(true);
    expect(aliveFrozenDefault.isFrozen).toBe(true);

    const aliveFrozenCustom = auditProcessLiveness(process.pid, Date.now() - 10000, 5000);
    expect(aliveFrozenCustom.isAlive).toBe(true);
    expect(aliveFrozenCustom.isFrozen).toBe(true);
  });
});
