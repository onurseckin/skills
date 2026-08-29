import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadWatchdogStore,
  saveWatchdogStore,
  syncWatchdogStore,
} from "../../../olt/scripts/src/watchdog/index.ts";
import {
  createDefaultWatchdogStore,
  type WatchdogRecord,
  type WatchdogStore,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";

describe("watchdog-store-sync File-Backed Synchronization", () => {
  let scratchRoot: string;

  beforeEach(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), "watchdog-store-sync-test-"));
  });

  afterEach(() => {
    if (scratchRoot) {
      rmSync(scratchRoot, { recursive: true, force: true });
    }
  });

  it("loads default store when target store file does not exist", () => {
    const storePath = join(scratchRoot, "nested", "watchdogs.json");
    const store = loadWatchdogStore(storePath);
    expect(store.schema).toBe("harness.watchdog_store");
    expect(store.version).toBe(1);
    expect(store.watchdogs).toEqual([]);
  });

  it("saves and loads watchdog store accurately", () => {
    const storePath = join(scratchRoot, "watchdogs.json");
    const record: WatchdogRecord = {
      id: "wd-gen1-test-001",
      generation: 1,
      pulse_id: "pulse-001",
      phase: "phase-alpha",
      run_id: "run-001",
      run_root: scratchRoot,
      pid: 12345,
      ppid: 1,
      agent_id: "agent-001",
      started_at: "2026-08-29T10:00:00.000Z",
      last_heartbeat_at: "2026-08-29T10:01:00.000Z",
      heartbeat_cadence_ms: 180_000,
      timeout_ms: 360_000,
      status: "active",
      terminated_at: null,
      termination_reason: null,
    };

    const initialStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-29T10:01:00.000Z",
      watchdogs: [record],
    };

    saveWatchdogStore(initialStore, storePath);
    const loaded = loadWatchdogStore(storePath);

    expect(loaded.version).toBe(1);
    expect(loaded.watchdogs.length).toBe(1);
    expect(loaded.watchdogs[0]?.id).toBe("wd-gen1-test-001");
    expect(loaded.watchdogs[0]?.status).toBe("active");
  });

  it("synchronizes in-memory store with file-backed disk store", () => {
    const storePath = join(scratchRoot, "watchdogs.json");

    const recordA: WatchdogRecord = {
      id: "wd-gen1-node-a",
      generation: 1,
      pulse_id: "pulse-a",
      phase: "phase-1",
      run_id: "run-a",
      run_root: scratchRoot,
      pid: 1001,
      ppid: 1,
      agent_id: "agent-a",
      started_at: "2026-08-29T10:00:00.000Z",
      last_heartbeat_at: "2026-08-29T10:01:00.000Z",
      heartbeat_cadence_ms: 180_000,
      timeout_ms: 360_000,
      status: "active",
      terminated_at: null,
      termination_reason: null,
    };

    const storeA: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-29T10:01:00.000Z",
      watchdogs: [recordA],
    };

    syncWatchdogStore(storeA, storePath);
    expect(storeA.watchdogs.length).toBe(1);
    expect(storeA.watchdogs[0]?.id).toBe("wd-gen1-node-a");

    const recordB: WatchdogRecord = {
      id: "wd-gen1-node-b",
      generation: 1,
      pulse_id: "pulse-b",
      phase: "phase-1",
      run_id: "run-b",
      run_root: scratchRoot,
      pid: 1002,
      ppid: 1,
      agent_id: "agent-b",
      started_at: "2026-08-29T10:02:00.000Z",
      last_heartbeat_at: "2026-08-29T10:03:00.000Z",
      heartbeat_cadence_ms: 180_000,
      timeout_ms: 360_000,
      status: "active",
      terminated_at: null,
      termination_reason: null,
    };

    const storeB: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-29T10:03:00.000Z",
      watchdogs: [recordB],
    };

    syncWatchdogStore(storeB, storePath);
    expect(storeB.watchdogs.length).toBe(2);
    expect(storeB.watchdogs.map((w) => w.id)).toEqual(["wd-gen1-node-a", "wd-gen1-node-b"]);

    syncWatchdogStore(storeA, storePath);
    expect(storeA.watchdogs.length).toBe(2);
    expect(storeA.watchdogs.map((w) => w.id)).toEqual(["wd-gen1-node-a", "wd-gen1-node-b"]);
  });

  it("updates existing record when in-memory record has newer heartbeat or terminal status", () => {
    const storePath = join(scratchRoot, "watchdogs.json");

    const recordInitial: WatchdogRecord = {
      id: "wd-gen1-node-c",
      generation: 1,
      pulse_id: "pulse-c",
      phase: "phase-1",
      run_id: "run-c",
      run_root: scratchRoot,
      pid: 1003,
      ppid: 1,
      agent_id: "agent-c",
      started_at: "2026-08-29T10:00:00.000Z",
      last_heartbeat_at: "2026-08-29T10:01:00.000Z",
      heartbeat_cadence_ms: 180_000,
      timeout_ms: 360_000,
      status: "active",
      terminated_at: null,
      termination_reason: null,
    };

    const store = createDefaultWatchdogStore();
    (store as { watchdogs: readonly WatchdogRecord[] }).watchdogs = [recordInitial];
    syncWatchdogStore(store, storePath);

    const recordUpdated: WatchdogRecord = {
      ...recordInitial,
      last_heartbeat_at: "2026-08-29T10:05:00.000Z",
      status: "terminated",
      terminated_at: "2026-08-29T10:05:00.000Z",
      termination_reason: "graceful_shutdown",
    };

    const updaterStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-29T10:05:00.000Z",
      watchdogs: [recordUpdated],
    };

    syncWatchdogStore(updaterStore, storePath);

    const loaded = loadWatchdogStore(storePath);
    expect(loaded.watchdogs.length).toBe(1);
    expect(loaded.watchdogs[0]?.status).toBe("terminated");
    expect(loaded.watchdogs[0]?.terminated_at).toBe("2026-08-29T10:05:00.000Z");
    expect(loaded.watchdogs[0]?.termination_reason).toBe("graceful_shutdown");
  });
});

describe("watchdog-store-sync Invariants & Cleanliness", () => {
  it("verifies zero any and zero suppressions in watchdog-store-sync.ts", () => {
    const syncPath = join(__dirname, "../../../olt/scripts/src/watchdog/autonomic-watchdog/watchdog-store-sync.ts");
    const content = readFileSync(syncPath, "utf8");

    expect(content).not.toMatch(new RegExp(":\\s*any\\b"));
    expect(content).not.toMatch(new RegExp("as\\s+any\\b"));
    expect(content).not.toMatch(new RegExp("<\\s*any\\s*>"));
    expect(content.includes("@ts-ignore")).toBe(false);
    expect(content.includes("@ts-expect-error")).toBe(false);
    expect(content.includes("@ts-nocheck")).toBe(false);
    expect(content.includes("eslint-disable")).toBe(false);
    expect(content.includes("oxlint-disable")).toBe(false);
  });
});
