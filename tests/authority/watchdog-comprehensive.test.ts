import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  cleanupPreviousPhaseWatchdogs,
  cleanupStaleWatchdogs,
  createDefaultWatchdogStore,
  heartbeatWatchdog,
  listWatchdogs,
  loadWatchdogStore,
  parseTimestamp,
  registerWatchdog,
  renderAsciiWatchdogTable,
  resolveWatchdogStorePath,
  saveWatchdogStore,
  setWatchdogLockTimingForTesting,
  terminatePhaseWatchdogs,
  terminateWatchdog,
  verifyWatchdogLifecycle,
  withWatchdogStoreLock,
  type WatchdogRecord,
  type WatchdogStore,
} from "../../olt/scripts/src/authority/watchdog/index.ts";
import { delay, openVerifiedParent } from "../../olt/scripts/src/authority/watchdog/lock.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

describe("Authority Watchdog Store, Lock, Operations & Verification Comprehensive", () => {
  test("setWatchdogLockTimingForTesting timing boundaries and delay utility", () => {
    expect(() => setWatchdogLockTimingForTesting(-1, 10)).toThrow(
      "must be finite and non-negative",
    );
    expect(() => setWatchdogLockTimingForTesting(100, -5)).toThrow(
      "must be finite and non-negative",
    );

    const restore = setWatchdogLockTimingForTesting(500, 5);
    expect(typeof restore).toBe("function");
    restore();

    expect(() => delay(1)).not.toThrow();
  });

  test("resolveWatchdogStorePath, createDefaultWatchdogStore and parseTimestamp edge cases", () => {
    expect(createDefaultWatchdogStore().watchdogs).toEqual([]);
    expect(parseTimestamp(123456789)).toBe(123456789);
    expect(parseTimestamp(new Date("2026-08-31T00:00:00Z"))).toBe(
      new Date("2026-08-31T00:00:00Z").getTime(),
    );
    expect(parseTimestamp(undefined)).toBeGreaterThan(0);
  });

  test("watchdog store lock, openVerifiedParent and save/load validations", () => {
    const scratch = scratchRoot(import.meta.path, "watchdog-lock-test");
    const subDir = join(scratch, "nested-store");
    mkdirSync(subDir, { recursive: true });

    const parent = openVerifiedParent(subDir, false);
    expect(parent.descriptor).toBeGreaterThan(0);
    expect(parent.metadata.isDirectory()).toBe(true);

    const storeFile = join(subDir, "watchdogs.json");
    const store = createDefaultWatchdogStore();
    saveWatchdogStore(store, storeFile);
    const loaded = loadWatchdogStore(storeFile);
    expect(loaded.schema).toBe("harness.watchdog_store");
    expect(loaded.watchdogs.length).toBe(0);

    rmSync(scratch, { recursive: true, force: true });
  });

  test("registerWatchdog, heartbeatWatchdog, terminateWatchdog, listWatchdogs lifecycle", () => {
    const scratch = scratchRoot(import.meta.path, "watchdog-ops-test");
    const storePath = join(scratch, "watchdogs.json");

    // 1. Register a watchdog
    const result = registerWatchdog(
      {
        pulse_id: "pulse-gen-1",
        phase: "planning",
        generation: 1,
        agent_id: "watchdog_agent_1",
        run_root: scratch,
        pid: process.pid,
        heartbeat_cadence_ms: 60_000,
        timeout_ms: 120_000,
        metadata: { purpose: "test-lifecycle" },
      },
      storePath,
    );

    const record = result.watchdog;
    expect(record.id).toBeDefined();
    expect(record.status).toBe("active");
    expect(record.generation).toBe(1);
    expect(record.pulse_id).toBe("pulse-gen-1");
    expect(record.metadata?.purpose).toBe("test-lifecycle");

    // 2. Heartbeat watchdog
    const updated = heartbeatWatchdog(record.id, { now: new Date().toISOString() }, storePath);
    expect(updated.id).toBe(record.id);
    expect(updated.status).toBe("active");

    // Heartbeat non-existent watchdog throws
    expect(() => heartbeatWatchdog("non-existent-wd", {}, storePath)).toThrow("watchdog not found");

    // 3. List watchdogs with filters
    const all = listWatchdogs({}, storePath);
    expect(all.length).toBe(1);
    expect(listWatchdogs({ status: "active" }, storePath).length).toBe(1);
    expect(listWatchdogs({ status: "terminated" }, storePath).length).toBe(0);
    expect(listWatchdogs({ pulse_id: "pulse-gen-1" }, storePath).length).toBe(1);
    expect(listWatchdogs({ phase: "planning" }, storePath).length).toBe(1);
    expect(listWatchdogs({ generation: 1 }, storePath).length).toBe(1);

    // 4. Terminate watchdog
    const terminated = terminateWatchdog(
      record.id,
      { reason: "phase completed successfully" },
      storePath,
    );
    expect(terminated.status).toBe("terminated");
    expect(terminated.termination_reason).toBe("phase completed successfully");

    // Terminating non-existent watchdog throws
    expect(() => terminateWatchdog("non-existent-wd", {}, storePath)).toThrow("watchdog not found");

    // 5. Phase cleanup and stale cleanup
    const phase2Result = registerWatchdog(
      {
        pulse_id: "pulse-gen-1",
        phase: "planning",
        generation: 1,
        agent_id: "watchdog_agent_2",
        run_root: scratch,
        pid: process.pid,
      },
      storePath,
    );
    expect(phase2Result.watchdog.status).toBe("active");

    const phaseTerminated = terminatePhaseWatchdogs(
      { phase: "planning", reason: "advancing phase" },
      storePath,
    );
    expect(phaseTerminated.terminatedCount).toBe(1);

    const prevPhaseCleaned = cleanupPreviousPhaseWatchdogs(
      { currentPhase: "execution", pulse_id: "pulse-gen-1" },
      storePath,
    );
    expect(prevPhaseCleaned.terminatedCount).toBe(0);

    const staleCleaned = cleanupStaleWatchdogs({ maxAgeMs: 0 }, storePath);
    expect(staleCleaned.cleanedCount).toBeGreaterThanOrEqual(0);

    rmSync(scratch, { recursive: true, force: true });
  });

  test("verifyWatchdogLifecycle and renderAsciiWatchdogTable", () => {
    const scratch = scratchRoot(import.meta.path, "watchdog-verify-test");
    const storePath = join(scratch, "watchdogs.json");

    // Register active watchdog with past heartbeat (overdue)
    const store: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-31T00:00:00Z",
      watchdogs: [
        {
          id: "wd-overdue-1",
          generation: 1,
          pulse_id: "pulse-1",
          phase: "loop",
          run_id: "run-1",
          run_root: scratch,
          agent_id: "wd-agent-1",
          pid: 1234,
          ppid: 1111,
          started_at: "2026-08-31T00:00:00Z",
          last_heartbeat_at: "2026-08-31T00:00:00Z",
          heartbeat_cadence_ms: 10_000,
          timeout_ms: 20_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
        {
          id: "wd-dup-gen-1",
          generation: 1,
          pulse_id: "pulse-1",
          phase: "loop",
          run_id: "run-1",
          run_root: scratch,
          agent_id: "wd-agent-2",
          pid: 5678,
          ppid: 1111,
          started_at: "2026-08-31T00:00:00Z",
          last_heartbeat_at: "2026-08-31T00:00:00Z",
          heartbeat_cadence_ms: 10_000,
          timeout_ms: 20_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(store, storePath);

    const verification = verifyWatchdogLifecycle({ now: "2026-08-31T01:00:00Z" }, storePath);
    expect(verification.valid).toBe(false);
    expect(verification.violations.length).toBeGreaterThan(0);
    expect(verification.violationDetails.some((v) => v.rule === "heartbeat_timeout_exceeded")).toBe(
      true,
    );
    expect(
      verification.violationDetails.some((v) => v.rule === "single_active_per_generation"),
    ).toBe(true);

    // renderAsciiWatchdogTable
    expect(renderAsciiWatchdogTable([])).toContain("No registered watchdog monitors found");
    const table = renderAsciiWatchdogTable(store.watchdogs);
    expect(table).toContain("wd-overdue-1");
    expect(table).toContain("[ACTIVE 🟢]");

    rmSync(scratch, { recursive: true, force: true });
  });

  test("store and lock validation, error branches and authority roots", () => {
    const scratch = scratchRoot(import.meta.path, "watchdog-lock-root-test");

    const {
      timestampMilliseconds,
      validateWatchdogRecord,
      validateWatchdogStore,
    } = require("../../../olt/scripts/src/authority/watchdog/store.ts");

    const {
      assertRealDirectory,
      openVerifiedParent,
      watchdogAuthorityRoot,
      requiredNoFollowFlag,
      assertCurrentLockAuthority,
    } = require("../../../olt/scripts/src/authority/watchdog/lock.ts");

    // timestampMilliseconds
    expect(() => timestampMilliseconds(123, "time")).toThrow("must be a timestamp string");
    expect(() => timestampMilliseconds("", "time")).toThrow("must be a timestamp string");
    expect(() => timestampMilliseconds("   ", "time")).toThrow("must be a timestamp string");

    // validateWatchdogRecord
    expect(() => validateWatchdogRecord(null, "record")).toThrow("must be an object");
    expect(() => validateWatchdogRecord("not-obj", "record")).toThrow("must be an object");

    // validateWatchdogStore
    expect(() => validateWatchdogStore(null)).toThrow("root must be an object");
    expect(() => validateWatchdogStore("string")).toThrow("root must be an object");

    // requiredNoFollowFlag
    expect(requiredNoFollowFlag()).toBeGreaterThan(0);

    // assertRealDirectory with non-existent directory
    expect(() => assertRealDirectory(join(scratch, "non-existent-dir"), "test")).toThrow(
      "is unavailable",
    );

    // assertRealDirectory with file instead of directory
    const testFile = join(scratch, "file.txt");
    writeFileSync(testFile, "content", "utf-8");
    expect(() => assertRealDirectory(testFile, "test")).toThrow("must be a real directory");

    // openVerifiedParent with non-existent parent and create=false
    expect(() => openVerifiedParent(join(scratch, "missing-parent"), false)).toThrow(
      "watchdog store parent is unavailable",
    );

    // watchdogAuthorityRoot with .olt
    const oltStorePath = join(scratch, ".olt", "watchdogs.json");
    expect(watchdogAuthorityRoot(oltStorePath)).toBe(scratch);

    // watchdogAuthorityRoot with direct directory
    const customStorePath = join(scratch, "custom", "watchdogs.json");
    mkdirSync(join(scratch, "custom"), { recursive: true });
    expect(watchdogAuthorityRoot(customStorePath)).toBe(join(scratch, "custom"));

    // assertCurrentLockAuthority when lock is not held
    expect(() => assertCurrentLockAuthority(oltStorePath)).toThrow("has no active lock authority");

    rmSync(scratch, { recursive: true, force: true });
  });
});
