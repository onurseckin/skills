import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadWatchdogStore,
  saveWatchdogStore,
} from "../../../olt/scripts/src/watchdog/index.ts";
import type {
  WatchdogRecord,
  WatchdogStore,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";

describe("WatchdogStore CRUD & Schema Validation", () => {
  it("loads default empty store when target file does not exist", () => {
    const root = scratchRoot(import.meta.path, "store-crud-missing");
    const storePath = join(root, "nested", "watchdogs.json");
    const store = loadWatchdogStore(storePath);

    expect(store.schema).toBe("harness.watchdog_store");
    expect(store.version).toBe(1);
    expect(store.watchdogs).toEqual([]);
  });

  it("saves and loads store records accurately across full property sets", () => {
    const root = scratchRoot(import.meta.path, "store-crud-roundtrip");
    const storePath = join(root, "watchdogs.json");

    const record: WatchdogRecord = {
      id: "wd-gen1-test-001",
      generation: 1,
      pulse_id: "pulse-001",
      phase: "phase-alpha",
      run_id: "run-001",
      run_root: root,
      pid: 12345,
      ppid: 1,
      agent_id: "agent-001",
      started_at: "2026-08-20T10:00:00.000Z",
      last_heartbeat_at: "2026-08-20T10:01:00.000Z",
      heartbeat_cadence_ms: 180_000,
      timeout_ms: 360_000,
      status: "active",
      terminated_at: null,
      termination_reason: null,
    };

    const initialStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-20T10:01:00.000Z",
      watchdogs: [record],
    };

    saveWatchdogStore(initialStore, storePath);
    const loadedStore = loadWatchdogStore(storePath);

    expect(loadedStore.schema).toBe("harness.watchdog_store");
    expect(loadedStore.version).toBe(1);
    expect(loadedStore.watchdogs.length).toBe(1);
    expect(loadedStore.watchdogs[0]?.id).toBe("wd-gen1-test-001");
    expect(loadedStore.watchdogs[0]?.agent_id).toBe("agent-001");
  });

  it("throws HarnessError when store file contains corrupted JSON", () => {
    const root = scratchRoot(import.meta.path, "store-crud-corrupt");
    const storePath = join(root, "corrupt-watchdogs.json");
    writeFileSync(storePath, "{ invalid json content ...", "utf-8");

    expect(() => loadWatchdogStore(storePath)).toThrow("corrupted watchdog store JSON");
  });
});
