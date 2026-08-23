import { expect, test, describe, beforeEach, afterEach, spyOn } from "bun:test";
import { acquireTestLock, isProcessAlive, TestLockData } from "../../../scripts/test-mutex.ts";
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
      throw new Error(`process.exit called with ${code as string}`);
    });
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (release) {
      release();
      release = undefined;
    }
    rmSync(LOCK_DIR, { recursive: true, force: true });
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("Targeted runs bypass broad lock", () => {
    release = acquireTestLock(false, ["tests/unit/scripts/test-mutex.test.ts"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(false);
  });

  test("Broad run creates lock and can be released", () => {
    release = acquireTestLock(true, ["tests"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData: TestLockData = JSON.parse(
      readFileSync(BROAD_LOCK_FILE, "utf-8"),
    ) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
    expect(lockData.scope).toBe("broad");

    release();
    expect(existsSync(BROAD_LOCK_FILE)).toBe(false);
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
    const deadPid = 999999; // Assume not alive
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

  test("isProcessAlive works", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999999)).toBe(false);
  });
});
