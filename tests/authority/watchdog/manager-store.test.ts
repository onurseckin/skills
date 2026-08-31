import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadWatchdogStore,
  registerWatchdog,
  resolveWatchdogStorePath,
  saveWatchdogStore,
  type WatchdogStore,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("WatchdogManager - Store Lifecycle & Resolution", () => {
  test("resolves store path for directory or explicit json file", () => {
    const dir = mkdtempSync(join(tmpdir(), "resolve-path-"));
    try {
      expect(resolveWatchdogStorePath(dir)).toBe(join(dir, "watchdogs.json"));
      expect(resolveWatchdogStorePath(join(dir, "custom.json"))).toBe(join(dir, "custom.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loads default store when file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "load-default-"));
    try {
      const store = loadWatchdogStore(dir);
      expect(store.schema).toBe("harness.watchdog_store");
      expect(store.version).toBe(1);
      expect(store.watchdogs).toEqual([]);
      expect(typeof store.updated_at).toBe("string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("saves and reloads store durably", () => {
    const dir = mkdtempSync(join(tmpdir(), "save-reload-"));
    try {
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

      saveWatchdogStore(store, dir);
      const persistedBeforeLoad = readFileSync(join(dir, "watchdogs.json"), "utf8");
      const loaded = loadWatchdogStore(dir);
      expect(loaded.watchdogs.length).toBe(1);
      expect(loaded.watchdogs[0]?.id).toBe("wd-test-1");
      expect(loaded.watchdogs[0]?.status).toBe("active");
      expect(loaded.watchdogs[0]?.metadata).toEqual({ note: "test-save" });
      expect(readFileSync(join(dir, "watchdogs.json"), "utf8")).toBe(persistedBeforeLoad);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws HarnessError when loading a corrupted store", () => {
    const dir = mkdtempSync(join(tmpdir(), "corrupt-store-"));
    try {
      const storePath = join(dir, "watchdogs.json");
      writeFileSync(storePath, "INVALID_JSON_CONTENT", "utf8");

      expect(() => loadWatchdogStore(dir)).toThrow(HarnessError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses a symlinked watchdog store without touching its external target", () => {
    if (process.platform === "win32") return;
    const dir = mkdtempSync(join(tmpdir(), "symlinked-store-"));
    const externalDir = mkdtempSync(join(tmpdir(), "symlinked-store-ext-"));
    try {
      const external = join(externalDir, "outside.json");
      const bytes = JSON.stringify({
        schema: "harness.watchdog_store",
        version: 1,
        updated_at: "2026-08-21T20:00:00.000Z",
        watchdogs: [],
      });
      writeFileSync(external, bytes, "utf8");
      symlinkSync(external, join(dir, "watchdogs.json"));

      expect(() => loadWatchdogStore(dir)).toThrow(HarnessError);
      expect(() => registerWatchdog({ id: "must-not-write" }, dir)).toThrow(HarnessError);
      expect(readFileSync(external, "utf8")).toBe(bytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(externalDir, { recursive: true, force: true });
    }
  });
});
