import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  loadWatchdogStore,
  registerWatchdog,
  resolveWatchdogStorePath,
  saveWatchdogStore,
  type WatchdogStore,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("WatchdogManager - Store Lifecycle & Resolution", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("resolves store path for directory or explicit json file", () => {
    const dir = "/virtual/watchdog/store-resolve-path";
    expect(resolveWatchdogStorePath(dir)).toBe(join(dir, "watchdogs.json"));
    expect(resolveWatchdogStorePath(join(dir, "custom.json"))).toBe(join(dir, "custom.json"));
  });

  test("loads default store when file does not exist", () => {
    const dir = "/virtual/watchdog/store-load-default";
    const store = loadWatchdogStore(dir);
    expect(store.schema).toBe("harness.watchdog_store");
    expect(store.version).toBe(1);
    expect(store.watchdogs).toEqual([]);
    expect(typeof store.updated_at).toBe("string");
  });

  test("saves and reloads store durably", () => {
    const dir = "/virtual/watchdog/store-save-reload";
    const store: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [
        {
          id: "wd-test-1",
          generation: 1,
          pulse_id: "p-100",
          phase: "autonomous-loop",
          run_id: "run-1",
          run_root: dir,
          pid: 1111,
          ppid: 2222,
          agent_id: "agent-1",
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
          metadata: { note: "test-save" },
        },
      ],
    };

    const vfs = getVirtualAuthorityFS();
    saveWatchdogStore(store, dir);
    const persistedBeforeLoad = vfs.readFileSync(join(dir, "watchdogs.json"), "utf8");
    const loaded = loadWatchdogStore(dir);
    expect(loaded.watchdogs.length).toBe(1);
    expect(loaded.watchdogs[0]?.id).toBe("wd-test-1");
    expect(loaded.watchdogs[0]?.status).toBe("active");
    expect(loaded.watchdogs[0]?.metadata).toEqual({ note: "test-save" });
    expect(vfs.readFileSync(join(dir, "watchdogs.json"), "utf8")).toBe(persistedBeforeLoad);
  });

  test("throws HarnessError when loading a corrupted store", () => {
    const vfs = getVirtualAuthorityFS();
    const dir = "/virtual/watchdog/store-corrupt";
    vfs.mkdirSync(dir, { recursive: true });
    const storePath = join(dir, "watchdogs.json");
    vfs.writeFileSync(storePath, "INVALID_JSON_CONTENT");

    expect(() => loadWatchdogStore(dir)).toThrow(HarnessError);
  });

  test("refuses a symlinked watchdog store without touching its external target", async () => {
    if (process.platform === "win32") return;
    const vfs = getVirtualAuthorityFS();
    const dir = "/virtual/watchdog/store-symlinked";
    const externalDir = "/virtual/watchdog/store-symlinked-ext";
    const external = join(externalDir, "outside.json");
    const bytes = JSON.stringify({
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [],
    });
    vfs.mkdirSync(externalDir, { recursive: true });
    vfs.writeFileSync(external, bytes);
    const linkPath = join(dir, "watchdogs.json");
    vfs.mkdirSync(dir, { recursive: true });
    const { symlinkSync } = await import("node:fs");
    symlinkSync(external, linkPath);

    expect(() => loadWatchdogStore(dir)).toThrow(HarnessError);
    expect(() => registerWatchdog({ id: "must-not-write" }, dir)).toThrow(HarnessError);
    expect(vfs.readFileSync(external, "utf8")).toBe(bytes);
  });
});
