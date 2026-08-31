import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  acquireTestLock,
  createMemoryLockStore,
  getActiveLockStore,
  isProcessAlive,
  resetLockStore,
  setLockStore,
  type TestLockData,
} from "../../scripts/testing/test-mutex.ts";

const LOCK_DIR = ".olt/.locks";
const BROAD_LOCK_FILE = join(LOCK_DIR, "broad-test.lock");

describe("test-mutex", () => {
  let release: (() => void) | undefined;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetLockStore();
    rmSync(LOCK_DIR, { recursive: true, force: true });
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
    rmSync(LOCK_DIR, { recursive: true, force: true });
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("Targeted runs bypass broad lock", () => {
    release = acquireTestLock(false, ["tests/unit/testing/test-mutex.test.ts"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(false);
    expect(() => release?.()).not.toThrow();
  });

  test("Broad run creates lock and can be released cleanly", () => {
    release = acquireTestLock(true, ["tests"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData = JSON.parse(readFileSync(BROAD_LOCK_FILE, "utf-8")) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
    expect(lockData.scope).toBe("broad");

    release();
    expect(existsSync(BROAD_LOCK_FILE)).toBe(false);
    expect(() => release?.()).not.toThrow();
  });

  test("Release does not unlink if lock file is owned by another PID", () => {
    release = acquireTestLock(true, ["tests"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);

    const otherLock: TestLockData = {
      pid: 123456,
      scope: "broad",
      args: ["tests"],
      startedAt: new Date().toISOString(),
    };
    writeFileSync(BROAD_LOCK_FILE, JSON.stringify(otherLock));

    release();
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);
  });

  test("Release handles missing or corrupt lock file gracefully", () => {
    release = acquireTestLock(true, ["tests"]);
    rmSync(BROAD_LOCK_FILE, { force: true });
    expect(() => release?.()).not.toThrow();

    const release2 = acquireTestLock(true, ["tests"]);
    writeFileSync(BROAD_LOCK_FILE, "invalid json");
    expect(() => release2()).not.toThrow();
  });

  test("Concurrent broad run is blocked with exit code 1", () => {
    mkdirSync(LOCK_DIR, { recursive: true });
    const fakeLock: TestLockData = {
      pid: process.pid,
      scope: "broad",
      args: ["tests"],
      startedAt: new Date().toISOString(),
    };
    writeFileSync(BROAD_LOCK_FILE, JSON.stringify(fakeLock));

    expect(() => acquireTestLock(true, ["tests"])).toThrow("process.exit called with 1");
    expect(errorSpy).toHaveBeenCalled();
  });

  test("Stale lock from dead PID is reclaimed automatically", () => {
    mkdirSync(LOCK_DIR, { recursive: true });
    const deadPid = 999999;
    const fakeLock: TestLockData = {
      pid: deadPid,
      scope: "broad",
      args: ["tests"],
      startedAt: new Date().toISOString(),
    };
    writeFileSync(BROAD_LOCK_FILE, JSON.stringify(fakeLock));

    release = acquireTestLock(true, ["tests"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);
    const newLock = JSON.parse(readFileSync(BROAD_LOCK_FILE, "utf-8")) as TestLockData;
    expect(newLock.pid).toBe(process.pid);
  });

  test("Corrupt lock file (invalid JSON) is reclaimed automatically", () => {
    mkdirSync(LOCK_DIR, { recursive: true });
    writeFileSync(BROAD_LOCK_FILE, "MALFORMED_JSON_CONTENT{{{");

    release = acquireTestLock(true, ["tests"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);
    const newLock = JSON.parse(readFileSync(BROAD_LOCK_FILE, "utf-8")) as TestLockData;
    expect(newLock.pid).toBe(process.pid);
  });

  test("Process signal handlers trigger cleanup and appropriate exit codes", () => {
    release = acquireTestLock(true, ["tests"]);

    const sigintListeners = process.rawListeners("SIGINT");
    const sigtermListeners = process.rawListeners("SIGTERM");
    const uncaughtListeners = process.rawListeners("uncaughtException");
    const exitListeners = process.rawListeners("exit");

    const newSigintHandler = sigintListeners[sigintListeners.length - 1];
    const newSigtermHandler = sigtermListeners[sigtermListeners.length - 1];
    const newUncaughtHandler = uncaughtListeners[uncaughtListeners.length - 1];
    const newExitHandler = exitListeners[exitListeners.length - 1];

    expect(typeof newSigintHandler).toBe("function");
    expect(typeof newSigtermHandler).toBe("function");
    expect(typeof newUncaughtHandler).toBe("function");
    expect(typeof newExitHandler).toBe("function");

    if (typeof newSigintHandler === "function") {
      expect(() => {
        (newSigintHandler as () => void)();
      }).toThrow("process.exit called with 130");
    }

    rmSync(LOCK_DIR, { recursive: true, force: true });
    release = acquireTestLock(true, ["tests"]);
    if (typeof newSigtermHandler === "function") {
      expect(() => {
        (newSigtermHandler as () => void)();
      }).toThrow("process.exit called with 143");
    }

    rmSync(LOCK_DIR, { recursive: true, force: true });
    release = acquireTestLock(true, ["tests"]);
    const uncaughtListenersUpdated = process.rawListeners("uncaughtException");
    const latestUncaughtHandler = uncaughtListenersUpdated[uncaughtListenersUpdated.length - 1];
    if (typeof latestUncaughtHandler === "function") {
      const testErr = new Error("Test uncaught exception");
      expect(() => {
        (latestUncaughtHandler as (err: Error) => void)(testErr);
      }).toThrow("process.exit called with 1");
      expect(errorSpy).toHaveBeenCalledWith(testErr);
    }

    rmSync(LOCK_DIR, { recursive: true, force: true });
    release = acquireTestLock(true, ["tests"]);
    if (typeof newExitHandler === "function") {
      expect(() => {
        (newExitHandler as () => void)();
      }).not.toThrow();
    }
  });

  test("isProcessAlive correctly checks process health", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999999)).toBe(false);
  });

  test("In-memory mode operates with zero disk I/O", () => {
    const memStore = createMemoryLockStore();
    setLockStore(memStore);
    expect(getActiveLockStore().isMemory).toBe(true);

    release = acquireTestLock(true, ["tests"], { skipSignalHandlers: true });
    expect(existsSync(BROAD_LOCK_FILE)).toBe(false);
    expect(memStore.existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData = JSON.parse(memStore.readFileSync(BROAD_LOCK_FILE)) as TestLockData;
    expect(lockData.pid).toBe(process.pid);

    release();
    expect(memStore.existsSync(BROAD_LOCK_FILE)).toBe(false);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(false);
  });

  test("In-memory lock handles missing file on read and reclaim of dead PID", () => {
    const memStore = createMemoryLockStore({
      [BROAD_LOCK_FILE]: JSON.stringify({
        pid: 999999,
        scope: "broad",
        args: ["tests"],
        startedAt: new Date().toISOString(),
      }),
    });

    expect(() => memStore.readFileSync("/nonexistent")).toThrow("ENOENT");
    release = acquireTestLock(true, ["tests"], { store: memStore, skipSignalHandlers: true });
    const lockData = JSON.parse(memStore.readFileSync(BROAD_LOCK_FILE)) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
  });
});
