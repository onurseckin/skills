import { expect, test, describe, beforeEach, afterEach, spyOn } from "bun:test";
import {
  acquireTestLock,
  isProcessAlive,
  type TestLockData,
} from "../../../scripts/testing/test-mutex.ts";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LOCK_DIR = ".olt/.locks";
const BROAD_LOCK_FILE = join(LOCK_DIR, "broad-test.lock");

describe("test-mutex", () => {
  let release: (() => void) | undefined;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
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
    rmSync(LOCK_DIR, { recursive: true, force: true });
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("Targeted runs bypass broad lock", () => {
    release = acquireTestLock(false, ["tests/unit/scripts/test-mutex.test.ts"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(false);
    // calling release for targeted run is no-op
    expect(() => release?.()).not.toThrow();
  });

  test("Broad run creates lock and can be released cleanly", () => {
    release = acquireTestLock(true, ["tests"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData: TestLockData = JSON.parse(
      readFileSync(BROAD_LOCK_FILE, "utf-8"),
    ) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
    expect(lockData.scope).toBe("broad");

    release();
    expect(existsSync(BROAD_LOCK_FILE)).toBe(false);

    // Calling release a second time should be idempotent (released = true)
    expect(() => release?.()).not.toThrow();
  });

  test("Release does not unlink if lock file is owned by another PID", () => {
    release = acquireTestLock(true, ["tests"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);

    // Overwrite lock with another PID
    const otherLock: TestLockData = {
      pid: 123456,
      scope: "broad",
      args: ["tests"],
      startedAt: new Date().toISOString(),
    };
    writeFileSync(BROAD_LOCK_FILE, JSON.stringify(otherLock));

    // Release should check pid and not unlink
    release();
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);
  });

  test("Release handles missing or corrupt lock file gracefully", () => {
    release = acquireTestLock(true, ["tests"]);
    // Delete lock file before release
    rmSync(BROAD_LOCK_FILE, { force: true });
    expect(() => release?.()).not.toThrow();

    // With corrupt JSON
    const release2 = acquireTestLock(true, ["tests"]);
    writeFileSync(BROAD_LOCK_FILE, "invalid json");
    expect(() => release2()).not.toThrow();
  });

  test("Concurrent broad run is blocked with exit code 1", () => {
    mkdirSync(LOCK_DIR, { recursive: true });
    const fakeLock: TestLockData = {
      pid: process.pid, // currently running process is definitely alive
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

    // Should not throw, should overwrite with new lock
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

  test("Process signal handlers (SIGINT, SIGTERM, uncaughtException, exit) trigger cleanup and appropriate exit codes", () => {
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

    // Test SIGINT handler
    if (typeof newSigintHandler === "function") {
      expect(() => {
        (newSigintHandler as () => void)();
      }).toThrow("process.exit called with 130");
    }

    // Clean lock and re-acquire for SIGTERM handler
    rmSync(LOCK_DIR, { recursive: true, force: true });
    release = acquireTestLock(true, ["tests"]);
    if (typeof newSigtermHandler === "function") {
      expect(() => {
        (newSigtermHandler as () => void)();
      }).toThrow("process.exit called with 143");
    }

    // Clean lock and re-acquire for uncaughtException handler
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

    // Clean lock and re-acquire for exit handler
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
});
