import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "node:path";
import {
  resolveCanonicalWatchdogStorePath,
  resolveWatchdogStorePath,
  loadMindWatchdogStore,
  saveMindWatchdogStore,
  auditProcessLiveness,
  createDefaultWatchdogStore,
  CANONICAL_WATCHDOG_FILE,
  DEFAULT_WATCHDOG_FILE,
} from "../../../olt/scripts/src/mind/watchdog-manager.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("mind/watchdog-manager", () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = scratchRoot(import.meta.path, "mind-watchdog-manager-test");
  });

  it("exports constants", () => {
    expect(CANONICAL_WATCHDOG_FILE).toBe("olt/watchdogs.json");
    expect(DEFAULT_WATCHDOG_FILE).toBe("olt/watchdogs.json");
  });

  it("resolves canonical and custom watchdog store paths", () => {
    const custom = join(scratchDir, "custom-watchdogs.json");
    expect(resolveWatchdogStorePath(custom)).toBe(custom);

    const canonicalWithRoot = resolveCanonicalWatchdogStorePath(scratchDir);
    expect(canonicalWithRoot).toBe(join(scratchDir, ".olt", "watchdogs.json"));

    const defaultPath = resolveWatchdogStorePath();
    expect(defaultPath).toContain("watchdogs.json");
  });

  it("loads and saves mind watchdog store", () => {
    const targetFile = join(scratchDir, "test-watchdogs.json");
    const baseStore = createDefaultWatchdogStore();
    const store = {
      ...baseStore,
      watchdogs: [
                {
          id: "watch-01",
          generation: 1,
          pulse_id: "pulse-01",
          phase: "active",
          run_id: "run-01",
          run_root: null,
          pid: process.pid,
          ppid: process.ppid,
          agent_id: "mind-1",
          started_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
          heartbeat_cadence_ms: 2_000,
          timeout_ms: 10_000,
          status: "active" as const,
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };

    saveMindWatchdogStore(store, targetFile);
    const loaded = loadMindWatchdogStore(targetFile);

    expect(loaded.watchdogs.length).toBe(1);
    expect(loaded.watchdogs[0]?.id).toBe("watch-01");

    // Also test default target parameter in loadMindWatchdogStore and saveMindWatchdogStore
    const loadedDefault = loadMindWatchdogStore();
    expect(loadedDefault.schema).toBe("harness.watchdog_store");
  });

  it("audits process liveness accurately", () => {
    const livePid = process.pid;
    const now = Date.now();

    const liveRecent = auditProcessLiveness(livePid, now, 60_000);
    expect(liveRecent.isAlive).toBe(true);
    expect(liveRecent.isFrozen).toBe(false);

    const liveFrozen = auditProcessLiveness(livePid, now - 100_000, 60_000);
    expect(liveFrozen.isAlive).toBe(true);
    expect(liveFrozen.isFrozen).toBe(true);

    const deadPid = 9999999;
    const deadAudit = auditProcessLiveness(deadPid, now, 60_000);
    expect(deadAudit.isAlive).toBe(false);
    expect(deadAudit.isFrozen).toBe(false);
  });
});
