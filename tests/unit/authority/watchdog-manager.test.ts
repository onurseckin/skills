import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  cleanupPreviousPhaseWatchdogs,
  cleanupStaleWatchdogs,
  createDefaultWatchdogStore,
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
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
  type WatchdogRecord,
  type WatchdogStore,
} from "../../../olt/scripts/src/authority/watchdog-manager.ts";
import {
  watchdogCleanupCommand,
  watchdogPhaseCleanupCommand,
  watchdogStatusCommand,
  watchdogVerifyCommand,
} from "../../../olt/scripts/src/cli/commands/watchdog-ops.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("WatchdogManager - Store Lifecycle & Resolution", () => {
  test("resolves store path for directory or explicit json file", () => {
    const dir = scratchRoot(import.meta.path, "resolve-path");
    expect(resolveWatchdogStorePath(dir)).toBe(join(dir, "watchdogs.json"));
    expect(resolveWatchdogStorePath(join(dir, "custom.json"))).toBe(join(dir, "custom.json"));
  });

  test("loads default store when file does not exist", () => {
    const dir = scratchRoot(import.meta.path, "load-default");
    const store = loadWatchdogStore(dir);
    expect(store.schema).toBe("harness.watchdog_store");
    expect(store.version).toBe(1);
    expect(store.watchdogs).toEqual([]);
    expect(typeof store.updated_at).toBe("string");
  });

  test("saves and reloads store durably", () => {
    const dir = scratchRoot(import.meta.path, "save-reload");
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
  });

  test("throws HarnessError when loading a corrupted store", () => {
    const dir = scratchRoot(import.meta.path, "corrupt-store");
    const storePath = join(dir, "watchdogs.json");
    writeFileSync(storePath, "INVALID_JSON_CONTENT", "utf8");

    expect(() => loadWatchdogStore(dir)).toThrow(HarnessError);
  });

  test("refuses a symlinked watchdog store without touching its external target", () => {
    const dir = scratchRoot(import.meta.path, "symlinked-store");
    const external = join(
      scratchRoot(import.meta.path, "symlinked-store-external"),
      "outside.json",
    );
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
  });

  test("refuses a symlinked watchdog parent without touching its external store", () => {
    const externalDir = scratchRoot(import.meta.path, "symlinked-parent-external");
    const linkedParent = join(scratchRoot(import.meta.path, "symlinked-parent"), "linked");
    const externalStore = join(externalDir, "watchdogs.json");
    const bytes = JSON.stringify({
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [],
    });
    writeFileSync(externalStore, bytes, "utf8");
    symlinkSync(externalDir, linkedParent);

    expect(() => loadWatchdogStore(linkedParent)).toThrow(HarnessError);
    expect(() => registerWatchdog({ id: "must-not-write-parent" }, linkedParent)).toThrow(
      HarnessError,
    );
    expect(readFileSync(externalStore, "utf8")).toBe(bytes);
  });

  test("rejects malformed persisted stores without normalizing them", () => {
    const validRecord = {
      id: "wd-strict-1",
      generation: 1,
      pulse_id: null,
      phase: "loop",
      run_id: null,
      run_root: null,
      pid: 100,
      ppid: 1,
      agent_id: null,
      started_at: "2026-08-21T20:00:00.000Z",
      last_heartbeat_at: "2026-08-21T20:00:00.000Z",
      heartbeat_cadence_ms: 180_000,
      timeout_ms: 360_000,
      status: "active",
      terminated_at: null,
      termination_reason: null,
      metadata: { source: "test" },
    };
    const malformedStores: readonly [string, Record<string, unknown>][] = [
      [
        "wrong-schema",
        { schema: "wrong", version: 1, updated_at: validRecord.started_at, watchdogs: [] },
      ],
      [
        "wrong-version",
        {
          schema: "harness.watchdog_store",
          version: 2,
          updated_at: validRecord.started_at,
          watchdogs: [],
        },
      ],
      [
        "invalid-updated-at",
        { schema: "harness.watchdog_store", version: 1, updated_at: "not-a-date", watchdogs: [] },
      ],
      [
        "missing-watchdogs",
        { schema: "harness.watchdog_store", version: 1, updated_at: validRecord.started_at },
      ],
      [
        "wrong-watchdogs",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: {},
        },
      ],
      [
        "blank-id",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, id: "" }],
        },
      ],
      [
        "bad-generation",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, generation: 0 }],
        },
      ],
      [
        "blank-phase",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, phase: "" }],
        },
      ],
      [
        "bad-pid",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, pid: 0 }],
        },
      ],
      [
        "bad-ppid",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, ppid: 0 }],
        },
      ],
      [
        "bad-started-at",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, started_at: "not-a-date" }],
        },
      ],
      [
        "bad-status",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, status: "healthy" }],
        },
      ],
      [
        "bad-heartbeat",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, last_heartbeat_at: "not-a-date" }],
        },
      ],
      [
        "bad-cadence",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, heartbeat_cadence_ms: 0 }],
        },
      ],
      [
        "bad-timeout",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, timeout_ms: 0 }],
        },
      ],
      [
        "bad-nullable",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, run_id: 1 }],
        },
      ],
      [
        "bad-termination-time",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, terminated_at: "not-a-date" }],
        },
      ],
      [
        "bad-metadata",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [{ ...validRecord, metadata: [] }],
        },
      ],
      [
        "duplicate-id",
        {
          schema: "harness.watchdog_store",
          version: 1,
          updated_at: validRecord.started_at,
          watchdogs: [validRecord, { ...validRecord }],
        },
      ],
    ];

    for (const [label, malformed] of malformedStores) {
      const dir = scratchRoot(import.meta.path, `strict-store-${label}`);
      const storePath = join(dir, "watchdogs.json");
      const bytes = JSON.stringify(malformed, null, 2) + "\n";
      writeFileSync(storePath, bytes, "utf8");

      try {
        loadWatchdogStore(dir);
        throw new Error(`expected ${label} to fail`);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).code).toBe("INTEGRITY");
      }
      expect(readFileSync(storePath, "utf8")).toBe(bytes);
    }
  });

  test("adapts only a fully valid legacy singleton and rejects malformed legacy data", () => {
    const record = {
      id: "wd-legacy-strict",
      generation: 1,
      pulse_id: null,
      phase: "loop",
      run_id: null,
      run_root: null,
      pid: 101,
      ppid: 1,
      agent_id: null,
      started_at: "2026-08-21T20:00:00.000Z",
      last_heartbeat_at: "2026-08-21T20:00:00.000Z",
      heartbeat_cadence_ms: 180_000,
      timeout_ms: 360_000,
      status: "active",
      terminated_at: null,
      termination_reason: null,
    };
    const validDir = scratchRoot(import.meta.path, "strict-legacy-valid");
    writeFileSync(
      join(validDir, "watchdogs.json"),
      JSON.stringify({
        schema: "harness.watchdog_store",
        version: 1,
        updated_at: record.started_at,
        active_watchdog: record,
      }),
      "utf8",
    );
    expect(loadWatchdogStore(validDir).watchdogs).toEqual([record]);

    const malformedDir = scratchRoot(import.meta.path, "strict-legacy-invalid");
    writeFileSync(
      join(malformedDir, "watchdogs.json"),
      JSON.stringify({
        schema: "harness.watchdog_store",
        version: 1,
        updated_at: record.started_at,
        active_watchdog: { ...record, pid: 0 },
      }),
      "utf8",
    );
    expect(() => loadWatchdogStore(malformedDir)).toThrow(HarnessError);
  });

  test("rejects present-invalid API now values before heartbeat mutation while omitted now defaults", () => {
    const dir = scratchRoot(import.meta.path, "strict-api-now");
    const initial = registerWatchdog({ id: "wd-now", now: "2026-08-21T20:00:00.000Z" }, dir);
    const storePath = join(dir, "watchdogs.json");
    const before = readFileSync(storePath, "utf8");

    try {
      heartbeatWatchdog("wd-now", { now: "not-a-date" }, dir);
      throw new Error("expected invalid now to fail");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INVALID_ARGUMENT");
    }
    expect(readFileSync(storePath, "utf8")).toBe(before);

    const absentStoreDir = scratchRoot(import.meta.path, "strict-api-now-register");
    try {
      registerWatchdog({ now: "not-a-date" }, absentStoreDir);
      throw new Error("expected invalid now to fail registration");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INVALID_ARGUMENT");
    }
    expect(() => readFileSync(join(absentStoreDir, "watchdogs.json"), "utf8")).toThrow();

    const omittedNow = registerWatchdog({ id: "wd-now-default", generation: 2 }, dir);
    expect(Number.isFinite(Date.parse(omittedNow.watchdog.last_heartbeat_at))).toBe(true);
    expect(initial.watchdog.id).toBe("wd-now");
  });

  test("refuses an invalid persisted heartbeat before a mutator can write it as fresh", () => {
    const dir = scratchRoot(import.meta.path, "strict-invalid-heartbeat-mutation");
    const storePath = join(dir, "watchdogs.json");
    const bytes = JSON.stringify({
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [
        {
          id: "wd-invalid-heartbeat",
          generation: 1,
          pulse_id: null,
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 100,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "not-a-date",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    });
    writeFileSync(storePath, bytes, "utf8");

    expect(() => heartbeatWatchdog("wd-invalid-heartbeat", {}, dir)).toThrow(HarnessError);
    expect(readFileSync(storePath, "utf8")).toBe(bytes);
  });
});

describe("WatchdogManager - Registration & Single Active Invariant", () => {
  test("fails a same-process nested mutation and recovers for the next mutation", () => {
    const dir = scratchRoot(import.meta.path, "same-process-reentry");
    const metadata = Object.defineProperty({}, "nested", {
      enumerable: true,
      get(): string {
        registerWatchdog({ id: "wd-nested", generation: 2 }, dir);
        return "unreachable";
      },
    });

    expect(() => registerWatchdog({ id: "wd-outer", metadata }, dir)).toThrow(HarnessError);
    const recovered = registerWatchdog({ id: "wd-recovered", generation: 1 }, dir);
    expect(recovered.watchdog.id).toBe("wd-recovered");
    expect(loadWatchdogStore(dir).watchdogs.map((watchdog) => watchdog.id)).toEqual([
      "wd-recovered",
    ]);
  });

  test("times out without changing bytes while another process owns the parent inode", async () => {
    const dir = scratchRoot(import.meta.path, "lock-timeout");
    const ready = join(dir, "holder-ready");
    const flockUrl = new URL("../../../olt/scripts/src/platform/index.ts", import.meta.url).href;
    const script = `
      import { closeSync, constants, openSync, writeFileSync } from "node:fs";
      import { releaseFlock, tryExclusiveFlock } from ${JSON.stringify(flockUrl)};
      const descriptor = openSync(${JSON.stringify(dir)}, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      if (!tryExclusiveFlock(descriptor)) process.exit(31);
      writeFileSync(${JSON.stringify(ready)}, "ready");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      releaseFlock(descriptor);
      closeSync(descriptor);
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let attempt = 0; attempt < 100 && !existsSync(ready); attempt += 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    expect(existsSync(ready)).toBe(true);
    const restore = setWatchdogLockTimingForTesting(25, 1);
    try {
      expect(() => registerWatchdog({ id: "wd-blocked" }, dir)).toThrow(HarnessError);
    } finally {
      restore();
    }
    expect(existsSync(join(dir, "watchdogs.json"))).toBe(false);
    expect(await child.exited).toBe(0);
  });

  test("repository-root lock prevents split authority after the .olt parent is replaced", async () => {
    const repositoryRoot = scratchRoot(import.meta.path, "root-authority-replacement");
    const oltDir = join(repositoryRoot, ".olt");
    const displacedOltDir = join(repositoryRoot, ".olt-displaced");
    const ready = join(repositoryRoot, "root-holder-ready");
    mkdirSync(oltDir, { recursive: true });
    const initialBytes = JSON.stringify({
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [],
    });
    writeFileSync(join(oltDir, "watchdogs.json"), initialBytes, "utf8");
    const flockUrl = new URL("../../../olt/scripts/src/platform/index.ts", import.meta.url).href;
    const script = `
      import { closeSync, constants, openSync, writeFileSync } from "node:fs";
      import { releaseFlock, tryExclusiveFlock } from ${JSON.stringify(flockUrl)};
      const descriptor = openSync(${JSON.stringify(repositoryRoot)}, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      if (!tryExclusiveFlock(descriptor)) process.exit(31);
      writeFileSync(${JSON.stringify(ready)}, "ready");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      releaseFlock(descriptor);
      closeSync(descriptor);
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let attempt = 0; attempt < 100 && !existsSync(ready); attempt += 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    expect(existsSync(ready)).toBe(true);
    renameSync(oltDir, displacedOltDir);
    mkdirSync(oltDir, { recursive: true });
    writeFileSync(join(oltDir, "watchdogs.json"), initialBytes, "utf8");
    const replacementBytes = readFileSync(join(oltDir, "watchdogs.json"), "utf8");

    const restore = setWatchdogLockTimingForTesting(25, 1);
    try {
      expect(() => registerWatchdog({ id: "wd-split-refused" }, oltDir)).toThrow(HarnessError);
    } finally {
      restore();
    }
    expect(readFileSync(join(oltDir, "watchdogs.json"), "utf8")).toBe(replacementBytes);
    expect(readFileSync(join(displacedOltDir, "watchdogs.json"), "utf8")).toBe(initialBytes);
    expect(await child.exited).toBe(0);

    expect(registerWatchdog({ id: "wd-after-root-release" }, oltDir).watchdog.id).toBe(
      "wd-after-root-release",
    );
  });

  test("releases a crashed child holder before the next mutation", async () => {
    const dir = scratchRoot(import.meta.path, "crash-release");
    const flockUrl = new URL("../../../olt/scripts/src/platform/index.ts", import.meta.url).href;
    const script = `
      import { constants, openSync } from "node:fs";
      import { tryExclusiveFlock } from ${JSON.stringify(flockUrl)};
      const descriptor = openSync(${JSON.stringify(dir)}, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      if (!tryExclusiveFlock(descriptor)) process.exit(31);
      process.exit(0);
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(0);

    expect(registerWatchdog({ id: "wd-after-crash" }, dir).watchdog.id).toBe("wd-after-crash");
  });

  test("serializes two child registrations without losing either generation", async () => {
    const dir = scratchRoot(import.meta.path, "cross-process-register");
    const start = join(dir, "start");
    const moduleUrl = new URL(
      "../../../olt/scripts/src/authority/watchdog-manager.ts",
      import.meta.url,
    ).href;
    const childScript = (id: string, generation: number): string => `
      import { existsSync, writeFileSync } from "node:fs";
      import { registerWatchdog } from ${JSON.stringify(moduleUrl)};
      writeFileSync(${JSON.stringify(join(dir, `ready-${id}`))}, "ready");
      while (!existsSync(${JSON.stringify(start)}))
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      registerWatchdog({ id: ${JSON.stringify(id)}, generation: ${generation} }, ${JSON.stringify(dir)});
    `;
    const children = [
      Bun.spawn([process.execPath, "--eval", childScript("wd-child-a", 1)], {
        stdout: "pipe",
        stderr: "pipe",
      }),
      Bun.spawn([process.execPath, "--eval", childScript("wd-child-b", 2)], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    ];
    for (
      let attempt = 0;
      attempt < 100 &&
      (!existsSync(join(dir, "ready-wd-child-a")) || !existsSync(join(dir, "ready-wd-child-b")));
      attempt += 1
    ) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    writeFileSync(start, "go");
    expect(await Promise.all(children.map((child) => child.exited))).toEqual([0, 0]);

    const store = loadWatchdogStore(dir);
    expect(store.watchdogs.map((watchdog) => watchdog.id).sort()).toEqual([
      "wd-child-a",
      "wd-child-b",
    ]);
    expect(store.watchdogs.filter((watchdog) => watchdog.status === "active")).toHaveLength(2);
  });

  test("serializes same-generation child registrations into one active and one superseded watchdog", async () => {
    const dir = scratchRoot(import.meta.path, "cross-process-same-generation");
    const start = join(dir, "start");
    const moduleUrl = new URL(
      "../../../olt/scripts/src/authority/watchdog-manager.ts",
      import.meta.url,
    ).href;
    const childScript = (id: string): string => `
      import { existsSync, writeFileSync } from "node:fs";
      import { registerWatchdog } from ${JSON.stringify(moduleUrl)};
      writeFileSync(${JSON.stringify(join(dir, `ready-${id}`))}, "ready");
      while (!existsSync(${JSON.stringify(start)}))
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      registerWatchdog({ id: ${JSON.stringify(id)}, generation: 1 }, ${JSON.stringify(dir)});
    `;
    const children = [
      Bun.spawn([process.execPath, "--eval", childScript("wd-same-a")], {
        stdout: "pipe",
        stderr: "pipe",
      }),
      Bun.spawn([process.execPath, "--eval", childScript("wd-same-b")], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    ];
    for (
      let attempt = 0;
      attempt < 100 &&
      (!existsSync(join(dir, "ready-wd-same-a")) || !existsSync(join(dir, "ready-wd-same-b")));
      attempt += 1
    ) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    writeFileSync(start, "go");
    expect(await Promise.all(children.map((child) => child.exited))).toEqual([0, 0]);

    const store = loadWatchdogStore(dir);
    expect(store.watchdogs).toHaveLength(2);
    expect(store.watchdogs.filter((watchdog) => watchdog.status === "active")).toHaveLength(1);
    expect(store.watchdogs.filter((watchdog) => watchdog.status === "terminated")).toHaveLength(1);
  });

  test("registers a watchdog with default cadence and timeout", () => {
    const dir = scratchRoot(import.meta.path, "reg-defaults");
    const result = registerWatchdog(
      {
        generation: 1,
        now: "2026-08-21T21:00:00.000Z",
      },
      dir,
    );

    expect(result.watchdog.id).toMatch(/^wd-gen1-/);
    expect(result.watchdog.generation).toBe(1);
    expect(result.watchdog.heartbeat_cadence_ms).toBe(DEFAULT_HEARTBEAT_CADENCE_MS);
    expect(result.watchdog.timeout_ms).toBe(DEFAULT_WATCHDOG_TIMEOUT_MS);
    expect(result.watchdog.status).toBe("active");
    expect(result.watchdog.started_at).toBe("2026-08-21T21:00:00.000Z");
    expect(result.watchdog.last_heartbeat_at).toBe("2026-08-21T21:00:00.000Z");
    expect(result.supersededWatchdogs).toEqual([]);
    expect(result.store.watchdogs.length).toBe(1);
  });

  test("enforces max 1 active watchdog per generation (supersedes prior active monitor)", () => {
    const dir = scratchRoot(import.meta.path, "single-active-gen");

    const first = registerWatchdog(
      {
        id: "wd-gen1-first",
        generation: 1,
        now: "2026-08-21T21:00:00.000Z",
      },
      dir,
    );
    expect(first.watchdog.status).toBe("active");
    expect(first.supersededWatchdogs.length).toBe(0);

    const second = registerWatchdog(
      {
        id: "wd-gen1-second",
        generation: 1,
        now: "2026-08-21T21:01:00.000Z",
      },
      dir,
    );

    expect(second.watchdog.status).toBe("active");
    expect(second.supersededWatchdogs.length).toBe(1);
    expect(second.supersededWatchdogs[0]?.id).toBe("wd-gen1-first");
    expect(second.supersededWatchdogs[0]?.status).toBe("terminated");
    expect(second.supersededWatchdogs[0]?.termination_reason).toBe("superseded_by_new_watchdog");

    const store = loadWatchdogStore(dir);
    const activeMonitors = store.watchdogs.filter(
      (w) => w.status === "active" && w.generation === 1,
    );
    expect(activeMonitors.length).toBe(1);
    expect(activeMonitors[0]?.id).toBe("wd-gen1-second");
  });

  test("supports multi-generation active watchdogs simultaneously", () => {
    const dir = scratchRoot(import.meta.path, "multi-gen");

    const gen1 = registerWatchdog({ id: "wd-gen1", generation: 1 }, dir);
    const gen2 = registerWatchdog({ id: "wd-gen2", generation: 2 }, dir);
    const gen3 = registerWatchdog({ id: "wd-gen3", generation: 3 }, dir);

    expect(gen1.watchdog.status).toBe("active");
    expect(gen2.watchdog.status).toBe("active");
    expect(gen3.watchdog.status).toBe("active");

    const store = loadWatchdogStore(dir);
    const activeMonitors = store.watchdogs.filter((w) => w.status === "active");
    expect(activeMonitors.length).toBe(3);
  });

  test("supersedes prior watchdog when pulse_id matches", () => {
    const dir = scratchRoot(import.meta.path, "pulse-match");

    registerWatchdog({ id: "wd-pulse-a", generation: 1, pulse_id: "pulse-99" }, dir);
    const result = registerWatchdog({ id: "wd-pulse-b", generation: 2, pulse_id: "pulse-99" }, dir);

    expect(result.supersededWatchdogs.length).toBe(1);
    expect(result.supersededWatchdogs[0]?.id).toBe("wd-pulse-a");
    expect(result.supersededWatchdogs[0]?.status).toBe("terminated");
  });

  test("auto-cleans stale watchdog during registration if heartbeat is overdue", () => {
    const dir = scratchRoot(import.meta.path, "auto-clean-reg");

    // Seed an old watchdog
    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T18:00:00.000Z",
      watchdogs: [
        {
          id: "wd-gen1-ancient",
          generation: 1,
          pulse_id: null,
          phase: "autonomous-loop",
          run_id: null,
          run_root: null,
          pid: 100,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T18:00:00.000Z",
          last_heartbeat_at: "2026-08-21T18:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    // Register at 20:00:00 (2 hours later)
    registerWatchdog(
      {
        id: "wd-gen1-fresh",
        generation: 1,
        now: "2026-08-21T20:00:00.000Z",
      },
      dir,
    );

    const store = loadWatchdogStore(dir);
    const ancient = store.watchdogs.find((w) => w.id === "wd-gen1-ancient");
    expect(ancient?.status).toBe("stale");
    expect(ancient?.termination_reason).toBe("heartbeat_timeout");
  });
});

describe("WatchdogManager - Heartbeat & Termination", () => {
  test("heartbeat updates last_heartbeat_at and recovers stale status", () => {
    const dir = scratchRoot(import.meta.path, "heartbeat-ok");

    registerWatchdog(
      {
        id: "wd-hb-1",
        generation: 1,
        now: "2026-08-21T20:00:00.000Z",
      },
      dir,
    );

    const updated = heartbeatWatchdog(
      "wd-hb-1",
      {
        now: "2026-08-21T20:03:00.000Z",
        phase: "validation-phase",
        metadata: { pulse: 2 },
      },
      dir,
    );

    expect(updated.last_heartbeat_at).toBe("2026-08-21T20:03:00.000Z");
    expect(updated.phase).toBe("validation-phase");
    expect(updated.metadata).toEqual({ pulse: 2 });
    expect(updated.status).toBe("active");
  });

  test("heartbeat throws NOT_FOUND for unknown watchdog id", () => {
    const dir = scratchRoot(import.meta.path, "heartbeat-not-found");
    expect(() => heartbeatWatchdog("wd-unknown", {}, dir)).toThrow(HarnessError);
  });

  test("heartbeat throws INVALID_STATE on terminated watchdog", () => {
    const dir = scratchRoot(import.meta.path, "heartbeat-terminated");
    registerWatchdog({ id: "wd-term-1" }, dir);
    terminateWatchdog("wd-term-1", { reason: "closed" }, dir);

    expect(() => heartbeatWatchdog("wd-term-1", {}, dir)).toThrow(HarnessError);
  });

  test("terminateWatchdog transitions status to terminated and is idempotent", () => {
    const dir = scratchRoot(import.meta.path, "terminate-ok");
    registerWatchdog({ id: "wd-term-2" }, dir);

    const term1 = terminateWatchdog(
      "wd-term-2",
      { reason: "job_done", now: "2026-08-21T21:00:00.000Z" },
      dir,
    );
    expect(term1.status).toBe("terminated");
    expect(term1.termination_reason).toBe("job_done");
    expect(term1.terminated_at).toBe("2026-08-21T21:00:00.000Z");

    const term2 = terminateWatchdog("wd-term-2", { reason: "repeat" }, dir);
    expect(term2.status).toBe("terminated");
  });

  test("terminateWatchdog throws NOT_FOUND for unknown id", () => {
    const dir = scratchRoot(import.meta.path, "term-not-found");
    expect(() => terminateWatchdog("wd-nonexistent", {}, dir)).toThrow(HarnessError);
  });
});

describe("WatchdogManager - Stale Cleanup & Filtering", () => {
  test("cleanupStaleWatchdogs marks expired monitors as stale", () => {
    const dir = scratchRoot(import.meta.path, "cleanup-stale");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T18:00:00.000Z",
      watchdogs: [
        {
          id: "wd-stale-1",
          generation: 1,
          pulse_id: "p-1",
          phase: "autonomous-loop",
          run_id: null,
          run_root: null,
          pid: 1234,
          ppid: 1,
          agent_id: "agent-a",
          started_at: "2026-08-21T18:00:00.000Z",
          last_heartbeat_at: "2026-08-21T18:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
        {
          id: "wd-fresh-1",
          generation: 1,
          pulse_id: "p-2",
          phase: "autonomous-loop",
          run_id: null,
          run_root: null,
          pid: 5678,
          ppid: 1,
          agent_id: "agent-b",
          started_at: "2026-08-21T19:59:00.000Z",
          last_heartbeat_at: "2026-08-21T19:59:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    // Dry run
    const dryRun = cleanupStaleWatchdogs(
      {
        now: "2026-08-21T20:00:00.000Z",
        dryRun: true,
      },
      dir,
    );
    expect(dryRun.cleanedCount).toBe(1);
    expect(dryRun.cleanedWatchdogs[0]?.id).toBe("wd-stale-1");
    expect(dryRun.dryRun).toBe(true);

    // Verify store was not mutated by dry run
    const storeAfterDry = loadWatchdogStore(dir);
    expect(storeAfterDry.watchdogs.find((w) => w.id === "wd-stale-1")?.status).toBe("active");

    // Live cleanup
    const live = cleanupStaleWatchdogs(
      {
        now: "2026-08-21T20:00:00.000Z",
        dryRun: false,
      },
      dir,
    );
    expect(live.cleanedCount).toBe(1);
    expect(live.activeCount).toBe(1);

    const storeAfterLive = loadWatchdogStore(dir);
    const staleWd = storeAfterLive.watchdogs.find((w) => w.id === "wd-stale-1");
    expect(staleWd?.status).toBe("stale");
    expect(staleWd?.termination_reason).toBe("stale_cadence_exceeded");
  });

  test("listWatchdogs filters accurately across various dimensions", () => {
    const dir = scratchRoot(import.meta.path, "list-filter");

    registerWatchdog({ id: "wd-g1-a", generation: 1, phase: "phase-a" }, dir);
    registerWatchdog({ id: "wd-g1-b", generation: 1, phase: "phase-b" }, dir);
    registerWatchdog({ id: "wd-g2-a", generation: 2, phase: "phase-a" }, dir);

    // Filter by generation
    const gen2List = listWatchdogs({ generation: 2 }, dir);
    expect(gen2List.length).toBe(1);
    expect(gen2List[0]?.id).toBe("wd-g2-a");

    // Filter by phase
    const phaseAList = listWatchdogs({ phase: "phase-a" }, dir);
    expect(phaseAList.length).toBe(2);

    // Filter by status array
    const activeList = listWatchdogs({ status: ["active"] }, dir);
    expect(activeList.length).toBe(2); // wd-g1-a was superseded by wd-g1-b, so wd-g1-b & wd-g2-a are active
  });
});

describe("WatchdogManager - ASCII Rendering", () => {
  test("renders empty state table when no watchdogs exist", () => {
    const rendered = renderAsciiWatchdogTable([]);
    expect(rendered).toContain("┌─");
    expect(rendered).toContain("No registered watchdog monitors found matching criteria");
    expect(rendered).toContain("└─");
  });

  test("renders populated ASCII table with status glyphs and timestamps", () => {
    const watchdogs: WatchdogRecord[] = [
      {
        id: "wd-gen1-test12345",
        generation: 1,
        pulse_id: "P-01",
        phase: "autonomous-loop",
        run_id: "run-1",
        run_root: null,
        pid: 12345,
        ppid: 1,
        agent_id: "orch-lead",
        started_at: "2026-08-21T20:00:00.000Z",
        last_heartbeat_at: "2026-08-21T20:00:00.000Z",
        heartbeat_cadence_ms: 180_000,
        timeout_ms: 360_000,
        status: "active",
        terminated_at: null,
        termination_reason: null,
      },
      {
        id: "wd-gen1-stale9999",
        generation: 1,
        pulse_id: null,
        phase: "review",
        run_id: "run-1",
        run_root: null,
        pid: 9999,
        ppid: 1,
        agent_id: "coord-1",
        started_at: "2026-08-21T18:00:00.000Z",
        last_heartbeat_at: "2026-08-21T18:00:00.000Z",
        heartbeat_cadence_ms: 180_000,
        timeout_ms: 360_000,
        status: "stale",
        terminated_at: null,
        termination_reason: "heartbeat_timeout",
      },
      {
        id: "wd-gen1-term7777",
        generation: 1,
        pulse_id: null,
        phase: "complete",
        run_id: "run-1",
        run_root: null,
        pid: 7777,
        ppid: 1,
        agent_id: "coord-2",
        started_at: "2026-08-21T18:00:00.000Z",
        last_heartbeat_at: "2026-08-21T18:00:00.000Z",
        heartbeat_cadence_ms: 180_000,
        timeout_ms: 360_000,
        status: "terminated",
        terminated_at: "2026-08-21T19:00:00.000Z",
        termination_reason: "done",
      },
      {
        id: "wd-gen1-orphan8888",
        generation: 1,
        pulse_id: null,
        phase: "unknown",
        run_id: null,
        run_root: null,
        pid: 8888,
        ppid: 1,
        agent_id: null,
        started_at: "2026-08-21T18:00:00.000Z",
        last_heartbeat_at: "2026-08-21T18:00:00.000Z",
        heartbeat_cadence_ms: 180_000,
        timeout_ms: 360_000,
        status: "orphaned",
        terminated_at: null,
        termination_reason: "lost",
      },
    ];

    const rendered = renderAsciiWatchdogTable(watchdogs, { now: "2026-08-21T20:01:00.000Z" });
    expect(rendered).toContain("Watchdog ID");
    expect(rendered).toContain("Gen / Pulse");
    expect(rendered).toContain("Phase");
    expect(rendered).toContain("Status");
    expect(rendered).toContain("PID");
    expect(rendered).toContain("[ACTIVE 🟢]");
    expect(rendered).toContain("[STALE ⚠️]");
    expect(rendered).toContain("[TERMINATED ⏹️]");
    expect(rendered).toContain("[ORPHANED ❌]");
    expect(rendered).toContain("180s");
    expect(rendered).toContain("12345");
  });
});

describe("CLI Commands - watchdog:status and watchdog:cleanup", () => {
  test("watchdogStatusCommand returns structured summary and markdown", () => {
    const dir = scratchRoot(import.meta.path, "cli-status");

    registerWatchdog({ id: "wd-cli-1", generation: 1, phase: "init" }, dir);
    registerWatchdog({ id: "wd-cli-2", generation: 2, phase: "execute" }, dir);

    const result = watchdogStatusCommand({
      run: dir,
    });

    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Watchdog Lifecycle & Cadence Status");
    expect(String(result.markdown)).toContain("Total Registered Monitors");

    const summary = result.summary as {
      total: number;
      active_count: number;
      by_generation: Record<string, number>;
    };
    expect(summary.total).toBe(2);
    expect(summary.active_count).toBe(2);
    expect(summary.by_generation["gen-1"]).toBe(1);
    expect(summary.by_generation["gen-2"]).toBe(1);
  });

  test("watchdogStatusCommand filters by status and generation", () => {
    const dir = scratchRoot(import.meta.path, "cli-status-filter");

    registerWatchdog({ id: "wd-filt-1", generation: 1 }, dir);
    registerWatchdog({ id: "wd-filt-2", generation: 2 }, dir);

    const result = watchdogStatusCommand({
      run: dir,
      generation: "2",
      "filter-status": "active",
    });

    const watchdogs = result.watchdogs as unknown as WatchdogRecord[];
    expect(watchdogs.length).toBe(1);
    expect(watchdogs[0]?.id).toBe("wd-filt-2");
  });

  test("watchdogStatusCommand throws on invalid filter-status or unknown flag", () => {
    const dir = scratchRoot(import.meta.path, "cli-status-errors");

    expect(() =>
      watchdogStatusCommand({
        run: dir,
        "filter-status": "invalid_status",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      watchdogStatusCommand({
        run: dir,
        unknown_option: "bad",
      }),
    ).toThrow(HarnessError);
  });

  test("watchdogCleanupCommand executes cleanup and returns report", () => {
    const dir = scratchRoot(import.meta.path, "cli-cleanup");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T18:00:00.000Z",
      watchdogs: [
        {
          id: "wd-stale-cli",
          generation: 1,
          pulse_id: null,
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 101,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T18:00:00.000Z",
          last_heartbeat_at: "2026-08-21T18:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    const result = watchdogCleanupCommand({
      run: dir,
      now: "2026-08-21T21:00:00.000Z",
    });

    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Watchdog Stale Cleanup Engine");
    expect(result.cleaned_count).toBe(1);
    expect(result.remaining_active).toBe(0);
  });

  test("watchdogCleanupCommand handles phase cleanup via --phase flag", () => {
    const dir = scratchRoot(import.meta.path, "cli-cleanup-phase");

    registerWatchdog({ id: "wd-p1", generation: 1, phase: "planning" }, dir);
    registerWatchdog({ id: "wd-p2", generation: 2, phase: "execution" }, dir);

    const result = watchdogCleanupCommand({
      run: dir,
      phase: "planning",
      generation: "1",
    });

    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Watchdog Phase Cleanup Engine");
    expect(result.cleaned_count).toBe(1);
    expect(result.remaining_active).toBe(1); // wd-p2 in gen 2 is still active
  });

  test("watchdogPhaseCleanupCommand executes phase termination", () => {
    const dir = scratchRoot(import.meta.path, "cli-phase-cleanup");

    registerWatchdog({ id: "wd-pc-1", generation: 1, phase: "analysis" }, dir);
    registerWatchdog({ id: "wd-pc-2", generation: 2, phase: "analysis" }, dir);

    const result = watchdogPhaseCleanupCommand({
      run: dir,
      phase: "analysis",
      generation: "1",
    });

    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Watchdog Automatic Phase Cleanup Engine");
    expect(result.terminated_count).toBe(1);
    expect(result.remaining_active).toBe(1);
  });

  test("watchdogPhaseCleanupCommand executes rollover cleanup with --current-phase", () => {
    const dir = scratchRoot(import.meta.path, "cli-rollover-cleanup");

    registerWatchdog({ id: "wd-prev-1", generation: 1, phase: "planning" }, dir);
    registerWatchdog({ id: "wd-curr-1", generation: 2, phase: "execution" }, dir);

    const result = watchdogPhaseCleanupCommand({
      run: dir,
      "current-phase": "execution",
    });

    expect(result.terminated_count).toBe(1);
    expect(result.remaining_active).toBe(1);
    const terminated = result.terminated_watchdogs as unknown as WatchdogRecord[];
    expect(terminated[0]?.id).toBe("wd-prev-1");
  });

  test("watchdogVerifyCommand audits lifecycle invariants and detects violations", () => {
    const dir = scratchRoot(import.meta.path, "cli-verify");

    // Seed multiple active in same gen to create a violation
    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [
        {
          id: "wd-v1",
          generation: 1,
          pulse_id: "p1",
          phase: "exec",
          run_id: null,
          run_root: null,
          pid: 10,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
        {
          id: "wd-v2",
          generation: 1,
          pulse_id: "p2",
          phase: "exec",
          run_id: null,
          run_root: null,
          pid: 11,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    const result = watchdogVerifyCommand({
      run: dir,
      generation: "1",
      now: "2026-08-21T20:01:00.000Z",
    });

    expect(result.valid).toBe(false);
    expect((result.violations as unknown as string[]).length).toBeGreaterThan(0);
    expect(String(result.markdown)).toContain("FAILED ❌");
  });
});

describe("WatchdogManager - Phase Cleanup & Automatic Rollover", () => {
  test("terminatePhaseWatchdogs terminates monitors matching target phase", () => {
    const dir = scratchRoot(import.meta.path, "phase-clean-target");

    registerWatchdog({ id: "wd-plan-1", generation: 1, phase: "planning" }, dir);
    registerWatchdog({ id: "wd-exec-1", generation: 2, phase: "execution" }, dir);

    const result = terminatePhaseWatchdogs({ phase: "planning" }, dir);
    expect(result.terminatedCount).toBe(1);
    expect(result.terminatedWatchdogs[0]?.id).toBe("wd-plan-1");
    expect(result.terminatedWatchdogs[0]?.status).toBe("terminated");
    expect(result.terminatedWatchdogs[0]?.termination_reason).toBe("phase_completed_planning");
    expect(result.activeCount).toBe(1);

    const store = loadWatchdogStore(dir);
    const planWd = store.watchdogs.find((w) => w.id === "wd-plan-1");
    expect(planWd?.status).toBe("terminated");
  });

  test("terminatePhaseWatchdogs supports dry run without mutating store", () => {
    const dir = scratchRoot(import.meta.path, "phase-clean-dry");

    registerWatchdog({ id: "wd-dry-1", generation: 1, phase: "review" }, dir);

    const dryResult = terminatePhaseWatchdogs({ phase: "review", dryRun: true }, dir);
    expect(dryResult.terminatedCount).toBe(1);
    expect(dryResult.dryRun).toBe(true);

    const store = loadWatchdogStore(dir);
    expect(store.watchdogs.find((w) => w.id === "wd-dry-1")?.status).toBe("active");
  });

  test("terminatePhaseWatchdogs respects generation, pulse_id, and excludeId", () => {
    const dir = scratchRoot(import.meta.path, "phase-clean-filters");

    registerWatchdog({ id: "wd-g1-p1", generation: 1, pulse_id: "p1", phase: "task" }, dir);
    registerWatchdog({ id: "wd-g2-p2", generation: 2, pulse_id: "p2", phase: "task" }, dir);
    registerWatchdog({ id: "wd-g3-p3", generation: 3, pulse_id: "p3", phase: "task" }, dir);

    const result = terminatePhaseWatchdogs(
      {
        phase: "task",
        generation: 2,
        pulse_id: "p2",
        excludeId: "wd-nonexistent",
      },
      dir,
    );

    expect(result.terminatedCount).toBe(1);
    expect(result.terminatedWatchdogs[0]?.id).toBe("wd-g2-p2");
    expect(result.activeCount).toBe(2);
  });

  test("cleanupPreviousPhaseWatchdogs terminates legacy phase monitors on rollover", () => {
    const dir = scratchRoot(import.meta.path, "rollover-clean");

    registerWatchdog({ id: "wd-old-plan", generation: 1, phase: "planning" }, dir);
    registerWatchdog({ id: "wd-old-exec", generation: 1, phase: "execution" }, dir);
    registerWatchdog({ id: "wd-new-val", generation: 2, phase: "validation" }, dir);

    const result = cleanupPreviousPhaseWatchdogs(
      {
        currentPhase: "validation",
        generation: 1,
      },
      dir,
    );

    expect(result.terminatedCount).toBe(1); // in gen 1, wd-old-plan was superseded by wd-old-exec, so only wd-old-exec was active
    expect(result.terminatedWatchdogs[0]?.id).toBe("wd-old-exec");
    expect(result.terminatedWatchdogs[0]?.status).toBe("terminated");
    expect(result.activeCount).toBe(1); // wd-new-val in gen 2 is active
  });
});

describe("WatchdogManager - Lifecycle Invariant Verification", () => {
  test("verifyWatchdogLifecycle passes when invariants are satisfied", () => {
    const dir = scratchRoot(import.meta.path, "verify-pass");

    registerWatchdog({ id: "wd-ok-1", generation: 1, pulse_id: "p-1" }, dir);
    registerWatchdog({ id: "wd-ok-2", generation: 2, pulse_id: "p-2" }, dir);

    const result = verifyWatchdogLifecycle({}, dir);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.activeCount).toBe(2);
  });

  test("verifyWatchdogLifecycle detects multiple active monitors in same generation", () => {
    const dir = scratchRoot(import.meta.path, "verify-multi-active-gen");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [
        {
          id: "wd-conflict-1",
          generation: 1,
          pulse_id: "p1",
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 1,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
        {
          id: "wd-conflict-2",
          generation: 1,
          pulse_id: "p2",
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 2,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    const result = verifyWatchdogLifecycle({}, dir);
    expect(result.valid).toBe(false);
    expect(
      result.violations.some((v) => v.includes("Multiple active watchdogs found in generation 1")),
    ).toBe(true);
    expect(result.violationDetails.some((d) => d.rule === "single_active_per_generation")).toBe(
      true,
    );
  });

  test("verifyWatchdogLifecycle detects multiple active monitors with same pulse_id", () => {
    const dir = scratchRoot(import.meta.path, "verify-multi-active-pulse");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [
        {
          id: "wd-pulse-dup1",
          generation: 1,
          pulse_id: "shared-pulse-123",
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 1,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
        {
          id: "wd-pulse-dup2",
          generation: 2,
          pulse_id: "shared-pulse-123",
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 2,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    const result = verifyWatchdogLifecycle({}, dir);
    expect(result.valid).toBe(false);
    expect(
      result.violations.some((v) =>
        v.includes("Multiple active watchdogs found for pulse 'shared-pulse-123'"),
      ),
    ).toBe(true);
    expect(result.violationDetails.some((d) => d.rule === "single_active_per_pulse")).toBe(true);
  });

  test("verifyWatchdogLifecycle detects overdue heartbeat timeout", () => {
    const dir = scratchRoot(import.meta.path, "verify-overdue-hb");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T18:00:00.000Z",
      watchdogs: [
        {
          id: "wd-overdue-1",
          generation: 1,
          pulse_id: null,
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 1,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T18:00:00.000Z",
          last_heartbeat_at: "2026-08-21T18:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    const result = verifyWatchdogLifecycle({ now: "2026-08-21T21:00:00.000Z" }, dir);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes("heartbeat is overdue"))).toBe(true);
    expect(result.violationDetails.some((d) => d.rule === "heartbeat_timeout_exceeded")).toBe(true);
  });

  test("covers remaining edge cases: default resolution, read errors, legacy store, metadata merge, and glyphs", () => {
    // 1. resolveWatchdogStorePath with undefined
    const defaultPath = resolveWatchdogStorePath();
    expect(defaultPath).toBeDefined();
    expect(typeof defaultPath).toBe("string");

    // 2. parseTimestamp edge cases
    const nowFromInvalid = parseTimestamp("not-a-valid-date");
    expect(Number.isFinite(nowFromInvalid)).toBe(true);

    // 3. createDefaultWatchdogStore with explicit vs default timestamp
    const storeWithIso = createDefaultWatchdogStore("2026-08-24T12:00:00.000Z");
    expect(storeWithIso.updated_at).toBe("2026-08-24T12:00:00.000Z");

    // 4. loadWatchdogStore read error (target file is a directory where readFileSync fails)
    const dir = scratchRoot(import.meta.path, "read-err");
    mkdirSync(join(dir, "watchdogs.json"), { recursive: true });
    expect(() => loadWatchdogStore(dir)).toThrow(HarnessError);

    // 5. loadWatchdogStore legacy active_watchdog format
    const legacyDir = scratchRoot(import.meta.path, "legacy-store");
    const legacyFile = join(legacyDir, "watchdogs.json");
    writeFileSync(
      legacyFile,
      JSON.stringify({
        schema: "harness.watchdog_store",
        version: 1,
        updated_at: "2026-08-21T18:00:00.000Z",
        active_watchdog: {
          id: "wd-legacy-1",
          generation: 1,
          pulse_id: null,
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 1,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T18:00:00.000Z",
          last_heartbeat_at: "2026-08-21T18:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      }),
      "utf8",
    );
    const loadedLegacy = loadWatchdogStore(legacyDir);
    expect(loadedLegacy.watchdogs.length).toBe(1);
    expect(loadedLegacy.watchdogs[0]?.id).toBe("wd-legacy-1");

    // 6. saveWatchdogStore creates missing nested directory
    const nestedDir = join(scratchRoot(import.meta.path, "nested-save"), "sub1", "sub2");
    saveWatchdogStore(storeWithIso, join(nestedDir, "watchdogs.json"));
    expect(loadWatchdogStore(nestedDir).watchdogs).toEqual([]);

    // 7. terminateWatchdog merges existing metadata with termination metadata
    const metaDir = scratchRoot(import.meta.path, "meta-merge");
    const regResult = registerWatchdog(
      {
        id: "wd-meta-1",
        generation: 1,
        phase: "loop",
        metadata: { initialKey: "initialVal" },
      },
      metaDir,
    );
    const termResult = terminateWatchdog(
      "wd-meta-1",
      {
        reason: "finished",
        metadata: { finalKey: "finalVal" },
      },
      metaDir,
    );
    expect(termResult.metadata).toEqual({
      initialKey: "initialVal",
      finalKey: "finalVal",
    });

    // 8. listWatchdogs with single status string that filters out non-matching
    const listMatches = listWatchdogs({ status: "active" }, metaDir);
    expect(listMatches.length).toBe(0);
    const listTerminated = listWatchdogs({ status: "terminated" }, metaDir);
    expect(listTerminated.length).toBe(1);

    // 9. cleanupStaleWatchdogs retains active non-expired watchdog
    const cleanupDir = scratchRoot(import.meta.path, "cleanup-non-expired");
    registerWatchdog(
      {
        id: "wd-active-fresh",
        generation: 1,
        phase: "loop",
        now: "2026-08-24T12:00:00.000Z",
      },
      cleanupDir,
    );
    registerWatchdog(
      {
        id: "wd-active-old",
        generation: 2,
        phase: "loop",
        now: "2026-08-24T10:00:00.000Z",
      },
      cleanupDir,
    );
    const cleanupRes = cleanupStaleWatchdogs({ now: "2026-08-24T12:01:00.000Z" }, cleanupDir);
    expect(cleanupRes.activeCount).toBe(1);
    expect(cleanupRes.cleanedCount).toBe(1);

    // 10. renderAsciiWatchdogTable handles terminated and orphaned glyphs
    const records: WatchdogRecord[] = [
      {
        id: "wd-active",
        generation: 1,
        pulse_id: "p1",
        phase: "phase1",
        run_id: null,
        run_root: null,
        pid: 100,
        ppid: 10,
        agent_id: null,
        started_at: "2026-08-24T12:00:00.000Z",
        last_heartbeat_at: "2026-08-24T12:00:00.000Z",
        heartbeat_cadence_ms: 180_000,
        timeout_ms: 360_000,
        status: "active",
        terminated_at: null,
        termination_reason: null,
      },
      {
        id: "wd-stale",
        generation: 1,
        pulse_id: null,
        phase: "phase2",
        run_id: null,
        run_root: null,
        pid: 101,
        ppid: 10,
        agent_id: null,
        started_at: "2026-08-24T12:00:00.000Z",
        last_heartbeat_at: "2026-08-24T12:00:00.000Z",
        heartbeat_cadence_ms: 180_000,
        timeout_ms: 360_000,
        status: "stale",
        terminated_at: null,
        termination_reason: "timeout",
      },
      {
        id: "wd-terminated",
        generation: 1,
        pulse_id: null,
        phase: "phase3",
        run_id: null,
        run_root: null,
        pid: 102,
        ppid: 10,
        agent_id: null,
        started_at: "2026-08-24T12:00:00.000Z",
        last_heartbeat_at: "2026-08-24T12:00:00.000Z",
        heartbeat_cadence_ms: 180_000,
        timeout_ms: 360_000,
        status: "terminated",
        terminated_at: "2026-08-24T12:05:00.000Z",
        termination_reason: "done",
      },
      {
        id: "wd-orphaned",
        generation: 1,
        pulse_id: null,
        phase: "phase4",
        run_id: null,
        run_root: null,
        pid: 103,
        ppid: 10,
        agent_id: null,
        started_at: "2026-08-24T12:00:00.000Z",
        last_heartbeat_at: "2026-08-24T12:00:00.000Z",
        heartbeat_cadence_ms: 180_000,
        timeout_ms: 360_000,
        status: "orphaned",
        terminated_at: null,
        termination_reason: "missing_parent",
      },
    ];
    const tableStr = renderAsciiWatchdogTable(records);
    expect(tableStr).toContain("[ACTIVE 🟢]");
    expect(tableStr).toContain("[STALE ⚠️]");
    expect(tableStr).toContain("[TERMINATED ⏹️]");
    expect(tableStr).toContain("[ORPHANED ❌]");

    // Filter by run_id, agent_id, and scalar status
    const filterEdgeDir = scratchRoot(import.meta.path, "watchdog-filter-edge");
    registerWatchdog({ id: "wd-edge-1", run_id: "run-a", agent_id: "agent-x" }, filterEdgeDir);
    registerWatchdog({ id: "wd-edge-2", run_id: "run-b", agent_id: "agent-y" }, filterEdgeDir);

    const filteredRun = listWatchdogs({ run_id: "run-a" }, filterEdgeDir);
    expect(filteredRun.length).toBe(1);

    const filteredAgent = listWatchdogs({ agent_id: "agent-y" }, filterEdgeDir);
    expect(filteredAgent.length).toBe(1);

    const filteredScalarStatus = listWatchdogs({ status: "stale" }, filterEdgeDir);
    expect(filteredScalarStatus.length).toBe(0);
  });
});

describe("Invariants & Cleanliness Audit", () => {
  test("zero TypeScript any and zero suppressions across watchdog files", () => {
    const sourceFiles = [
      join(__dirname, "../../../olt/scripts/src/authority/watchdog-manager.ts"),
      join(__dirname, "../../../olt/scripts/src/engine/runner/watchdog.ts"),
      join(__dirname, "../../../olt/scripts/src/orchestrator/watchdog.ts"),
      join(__dirname, "../../../olt/scripts/src/cli/commands/watchdog-ops.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
