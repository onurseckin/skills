import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import {
  acquireTestLock,
  createMemoryLockStore,
  getActiveLockStore,
  isProcessAlive,
  resetLockStore,
  setLockStore,
  type LockStore,
  type TestLockData,
} from "../../../scripts/testing/test-mutex.ts";

const LOCK_DIR = ".olt/.locks";
const BROAD_LOCK_FILE = join(LOCK_DIR, "broad-test.lock");

describe("test-mutex", () => {
  let release: (() => void) | undefined;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let memStore: LockStore;

  beforeEach(() => {
    memStore = createMemoryLockStore();
    setLockStore(memStore);
    exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit called with ${code as string | number}`);
    });
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (release) {
      try {
        release();
      } catch {}
      release = undefined;
    }
    resetLockStore();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("Targeted runs bypass broad lock", () => {
    release = acquireTestLock(false, ["tests/testing/locks/test-mutex.test.ts"]);
    expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(false);
    expect(() => release?.()).not.toThrow();
  });

  test("Broad run creates lock and can be released cleanly", () => {
    release = acquireTestLock(true, ["tests"]);
    expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData = JSON.parse(
      getActiveLockStore().readFileSync(BROAD_LOCK_FILE),
    ) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
    expect(lockData.scope).toBe("broad");

    release();
    expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(false);
    expect(() => release?.()).not.toThrow();
  });

  test("Release does not unlink if lock file is owned by another PID", () => {
    release = acquireTestLock(true, ["tests"]);
    expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

    // Tamper with the lock file so it's owned by a different PID
    const foreignLock: TestLockData = {
      pid: 99999999,
      command: "foreign bun test",
      startedAt: new Date().toISOString(),
      scope: "broad",
      targets: ["tests"],
    };
    getActiveLockStore().writeFileSync(BROAD_LOCK_FILE, JSON.stringify(foreignLock));

    release();
    // File should still exist because we don't own it
    expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);
  });

  test("Release handles missing or corrupt lock file gracefully", () => {
    release = acquireTestLock(true, ["tests"]);

    // Delete the file before release
    getActiveLockStore().unlinkSync(BROAD_LOCK_FILE);
    expect(() => release?.()).not.toThrow();

    // Re-acquire and corrupt the file
    release = acquireTestLock(true, ["tests"]);
    getActiveLockStore().writeFileSync(BROAD_LOCK_FILE, "not valid json {{{");
    expect(() => release?.()).not.toThrow();
  });

  test("Concurrent broad run is blocked with exit code 1", () => {
    // Acquire first lock
    release = acquireTestLock(true, ["tests"]);
    expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

    // Second broad acquisition should fail and attempt process.exit(1)
    expect(() => {
      acquireTestLock(true, ["tests"]);
    }).toThrow("process.exit called with 1");

    expect(errorSpy).toHaveBeenCalled();
  });

  test("Stale lock from dead PID is reclaimed automatically", () => {
    // Write a lock file with a non-existent PID
    const staleLock: TestLockData = {
      pid: 99999999,
      command: "stale bun test",
      startedAt: new Date(Date.now() - 60000).toISOString(),
      scope: "broad",
      targets: ["tests"],
    };
    getActiveLockStore().mkdirSync(LOCK_DIR);
    getActiveLockStore().writeFileSync(BROAD_LOCK_FILE, JSON.stringify(staleLock));

    // Acquisition should reclaim the stale lock rather than exiting
    release = acquireTestLock(true, ["tests"]);
    expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData = JSON.parse(
      getActiveLockStore().readFileSync(BROAD_LOCK_FILE),
    ) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
  });

  test("Corrupt lock file (invalid JSON) is reclaimed automatically", () => {
    getActiveLockStore().mkdirSync(LOCK_DIR);
    getActiveLockStore().writeFileSync(BROAD_LOCK_FILE, "CORRUPT_DATA");

    release = acquireTestLock(true, ["tests"]);
    expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData = JSON.parse(
      getActiveLockStore().readFileSync(BROAD_LOCK_FILE),
    ) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
  });

  test("Process signal handlers trigger cleanup and appropriate exit codes", () => {
    const listeners: Record<string, () => void> = {};
    const processOnSpy = spyOn(process, "on").mockImplementation(((
      event: string,
      listener: () => void,
    ) => {
      listeners[event] = listener;
      return process;
    }) as unknown as typeof process.on);

    release = acquireTestLock(true, ["tests"]);
    expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

    expect(listeners["SIGINT"]).toBeDefined();
    expect(listeners["SIGTERM"]).toBeDefined();
    expect(listeners["exit"]).toBeDefined();

    // Trigger SIGINT handler
    expect(() => {
      listeners["SIGINT"]!();
    }).toThrow("process.exit called with 130");

    expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(false);

    processOnSpy.mockRestore();
  });

  test("isProcessAlive correctly checks process health", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(99999999)).toBe(false);
  });

  test("In-memory mode operates with zero disk I/O", () => {
    const localMemStore = createMemoryLockStore();
    setLockStore(localMemStore);

    // Acquire lock in memory
    release = acquireTestLock(true, ["tests"]);
    expect(localMemStore.existsSync(BROAD_LOCK_FILE)).toBe(true);

    const data = JSON.parse(localMemStore.readFileSync(BROAD_LOCK_FILE)) as TestLockData;
    expect(data.pid).toBe(process.pid);
    expect(data.scope).toBe("broad");

    // Second acquisition in memory fails
    expect(() => {
      acquireTestLock(true, ["tests"]);
    }).toThrow("process.exit called with 1");

    release();
    expect(localMemStore.existsSync(BROAD_LOCK_FILE)).toBe(false);
  });

  test("In-memory lock handles missing file on read and reclaim of dead PID", () => {
    const localMemStore = createMemoryLockStore();
    setLockStore(localMemStore);

    // Read on missing file should throw ENOENT in memStore
    expect(() => localMemStore.readFileSync("/nonexistent/file.lock")).toThrow();

    // Dead PID stale lock recovery in memory
    const staleLock: TestLockData = {
      pid: 99999999,
      command: "stale in-memory bun test",
      startedAt: new Date(Date.now() - 60000).toISOString(),
      scope: "broad",
      targets: ["tests"],
    };
    localMemStore.mkdirSync(LOCK_DIR);
    localMemStore.writeFileSync(BROAD_LOCK_FILE, JSON.stringify(staleLock));

    release = acquireTestLock(true, ["tests"]);
    expect(localMemStore.existsSync(BROAD_LOCK_FILE)).toBe(true);
    const data = JSON.parse(localMemStore.readFileSync(BROAD_LOCK_FILE)) as TestLockData;
    expect(data.pid).toBe(process.pid);
  });
});
