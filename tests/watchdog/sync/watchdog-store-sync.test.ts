import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  loadWatchdogStore,
  saveWatchdogStore,
  syncWatchdogStore,
} from "../../../olt/scripts/src/watchdog/index.ts";
import type {
  WatchdogRecord,
  WatchdogStore,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";

describe("watchdog-store-sync File-Backed Synchronization", () => {
  it("synchronizes in-memory changes with disk state preserving latest timestamps and statuses", () => {
    const root = scratchRoot(import.meta.path, "watchdog-sync-test");
    const storePath = join(root, "watchdogs.json");

    const recordA: WatchdogRecord = {
      id: "wd-gen1-nodeA",
      generation: 1,
      pulse_id: "pulse-001",
      phase: "phase-init",
      run_id: "run-001",
      run_root: root,
      pid: 1111,
      ppid: 1,
      agent_id: "agent-nodeA",
      started_at: "2026-08-20T10:00:00.000Z",
      last_heartbeat_at: "2026-08-20T10:01:00.000Z",
      heartbeat_cadence_ms: 60_000,
      timeout_ms: 120_000,
      status: "active",
      terminated_at: null,
      termination_reason: null,
    };

    const diskStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-20T10:01:00.000Z",
      watchdogs: [recordA],
    };
    saveWatchdogStore(diskStore, storePath);

    const recordAUpdated: WatchdogRecord = {
      ...recordA,
      last_heartbeat_at: "2026-08-20T10:02:00.000Z",
      status: "active",
    };

    const recordBNew: WatchdogRecord = {
      id: "wd-gen1-nodeB",
      generation: 1,
      pulse_id: "pulse-002",
      phase: "phase-run",
      run_id: "run-001",
      run_root: root,
      pid: 2222,
      ppid: 1,
      agent_id: "agent-nodeB",
      started_at: "2026-08-20T10:01:30.000Z",
      last_heartbeat_at: "2026-08-20T10:01:30.000Z",
      heartbeat_cadence_ms: 60_000,
      timeout_ms: 120_000,
      status: "active",
      terminated_at: null,
      termination_reason: null,
    };

    const memoryStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-20T10:02:00.000Z",
      watchdogs: [recordAUpdated, recordBNew],
    };

    syncWatchdogStore(memoryStore, storePath);

    const loadedStore = loadWatchdogStore(storePath);
    expect(loadedStore.watchdogs.length).toBe(2);

    const loadedA = loadedStore.watchdogs.find((w) => w.id === "wd-gen1-nodeA");
    expect(loadedA?.last_heartbeat_at).toBe("2026-08-20T10:02:00.000Z");

    const loadedB = loadedStore.watchdogs.find((w) => w.id === "wd-gen1-nodeB");
    expect(loadedB?.agent_id).toBe("agent-nodeB");
  });

  it("prioritizes terminated status when record timestamps are equal", () => {
    const root = scratchRoot(import.meta.path, "watchdog-status-merge");
    const storePath = join(root, "watchdogs.json");

    const recActive: WatchdogRecord = {
      id: "wd-merge-1",
      generation: 1,
      pulse_id: "pulse-1",
      phase: "phase-1",
      run_id: "run-1",
      run_root: root,
      pid: 3333,
      ppid: 1,
      agent_id: "agent-1",
      started_at: "2026-08-20T10:00:00.000Z",
      last_heartbeat_at: "2026-08-20T10:05:00.000Z",
      heartbeat_cadence_ms: 60_000,
      timeout_ms: 120_000,
      status: "active",
      terminated_at: null,
      termination_reason: null,
    };

    saveWatchdogStore(
      { schema: "harness.watchdog_store", version: 1, updated_at: "2026-08-20T10:00:00.000Z", watchdogs: [recActive] },
      storePath,
    );

    const recTerminated: WatchdogRecord = {
      ...recActive,
      status: "terminated",
      terminated_at: "2026-08-20T10:05:00.000Z",
      termination_reason: "task completed",
    };

    syncWatchdogStore(
      { schema: "harness.watchdog_store", version: 1, updated_at: "2026-08-20T10:05:00.000Z", watchdogs: [recTerminated] },
      storePath,
    );

    const loaded = loadWatchdogStore(storePath);
    expect(loaded.watchdogs[0]?.status).toBe("terminated");
  });
});
