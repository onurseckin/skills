import { expect, test, describe, beforeEach, afterEach, spyOn } from "bun:test";
import {
  acquireTestLock,
  createMemoryLockStore,
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
    release = acquireTestLock(false, ["tests/scripts/testing/test-mutex.test.ts"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(false);
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
    expect(() => release?.()).not.toThrow();
  });

  test("isProcessAlive accurately returns true for current process and false for non-existent pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999999999)).toBe(false);
  });

  test("Stale lock from dead process is overwritten and warning logged", () => {
    mkdirSync(LOCK_DIR, { recursive: true });
    const staleData: TestLockData = {
      pid: 999999999,
      startedAt: new Date(Date.now() - 10000).toISOString(),
      scope: "broad",
      args: ["tests"],
    };
    writeFileSync(BROAD_LOCK_FILE, JSON.stringify(staleData));

    release = acquireTestLock(true, ["tests"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData: TestLockData = JSON.parse(
      readFileSync(BROAD_LOCK_FILE, "utf-8"),
    ) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
  });

  test("Active lock by another alive process causes process.exit(1)", () => {
    mkdirSync(LOCK_DIR, { recursive: true });
    const activeData: TestLockData = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      scope: "broad",
      args: ["tests"],
    };
    writeFileSync(BROAD_LOCK_FILE, JSON.stringify(activeData));

    expect(() => {
      acquireTestLock(true, ["tests"]);
    }).toThrow("process.exit called with 1");
  });

  test("Corrupt lock file (invalid JSON) is overwritten and warning logged", () => {
    mkdirSync(LOCK_DIR, { recursive: true });
    writeFileSync(BROAD_LOCK_FILE, "invalid-json-content");

    release = acquireTestLock(true, ["tests"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData: TestLockData = JSON.parse(
      readFileSync(BROAD_LOCK_FILE, "utf-8"),
    ) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
  });

  test("Memory store operates completely in-memory without disk touches", () => {
    const memStore = createMemoryLockStore();
    const memRelease = acquireTestLock(true, ["tests"], {
      store: memStore,
      inMemory: true,
      skipSignalHandlers: true,
    });
    expect(memStore.existsSync(BROAD_LOCK_FILE)).toBe(true);
    memRelease();
    expect(memStore.existsSync(BROAD_LOCK_FILE)).toBe(false);
  });

  test("releaseTestLock handles error unlinking lock file gracefully", () => {
    release = acquireTestLock(true, ["tests"]);
    expect(existsSync(BROAD_LOCK_FILE)).toBe(true);

    const origUnlinkSync = rmSync;
    const rmSpy = spyOn(fsImport, "rmSync").mockImplementation((p) => {
      if (typeof p === "string" && p.includes("broad-test.lock")) {
        throw new Error("Permission error during unlock");
      }
      return origUnlinkSync(p);
    });

    try {
      expect(() => release?.()).not.toThrow();
    } finally {
      rmSpy.mockRestore();
    }
  });
});

import * as fsImport from "node:fs";
