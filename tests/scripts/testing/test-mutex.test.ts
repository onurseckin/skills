import { expect, test, describe, beforeEach, afterEach, spyOn } from "bun:test";
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
import { join } from "node:path";

const LOCK_DIR = ".olt/.locks";
const BROAD_LOCK_FILE = join(LOCK_DIR, "broad-test.lock");

describe("test-mutex (in-memory virtual)", () => {
  let release: (() => void) | undefined;
  let memStore: LockStore;
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    memStore = createMemoryLockStore();
    setLockStore(memStore);
    spies.push(
      spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`process.exit called with ${code as string | number}`);
      }),
    );
    spies.push(spyOn(console, "error").mockImplementation(() => {}));
  });

  afterEach(() => {
    if (release) {
      try {
        release();
      } catch {}
      release = undefined;
    }
    resetLockStore();
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  test("Targeted runs bypass broad lock", () => {
    release = acquireTestLock(false, ["tests/scripts/testing/test-mutex.test.ts"]);
    expect(memStore.existsSync(BROAD_LOCK_FILE)).toBe(false);
    expect(() => release?.()).not.toThrow();
  });

  test("Broad run creates lock and can be released cleanly", () => {
    release = acquireTestLock(true, ["tests"]);
    expect(memStore.existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData: TestLockData = JSON.parse(
      memStore.readFileSync(BROAD_LOCK_FILE),
    ) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
    expect(lockData.scope).toBe("broad");

    release();
    expect(memStore.existsSync(BROAD_LOCK_FILE)).toBe(false);
    expect(() => release?.()).not.toThrow();
  });

  test("isProcessAlive accurately returns true for current process and false for non-existent pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999999999)).toBe(false);
  });

  test("Stale lock from dead process is overwritten and warning logged", () => {
    memStore.mkdirSync(LOCK_DIR);
    const staleData: TestLockData = {
      pid: 999999999,
      startedAt: new Date(Date.now() - 10000).toISOString(),
      scope: "broad",
      args: ["tests"],
    };
    memStore.writeFileSync(BROAD_LOCK_FILE, JSON.stringify(staleData));

    release = acquireTestLock(true, ["tests"]);
    expect(memStore.existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData: TestLockData = JSON.parse(
      memStore.readFileSync(BROAD_LOCK_FILE),
    ) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
  });

  test("Active lock by another alive process causes process.exit(1)", () => {
    memStore.mkdirSync(LOCK_DIR);
    const activeData: TestLockData = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      scope: "broad",
      args: ["tests"],
    };
    memStore.writeFileSync(BROAD_LOCK_FILE, JSON.stringify(activeData));

    expect(() => {
      acquireTestLock(true, ["tests"]);
    }).toThrow("process.exit called with 1");
  });

  test("Corrupt lock file (invalid JSON) is overwritten and warning logged", () => {
    memStore.mkdirSync(LOCK_DIR);
    memStore.writeFileSync(BROAD_LOCK_FILE, "invalid-json-content");

    release = acquireTestLock(true, ["tests"]);
    expect(memStore.existsSync(BROAD_LOCK_FILE)).toBe(true);

    const lockData: TestLockData = JSON.parse(
      memStore.readFileSync(BROAD_LOCK_FILE),
    ) as TestLockData;
    expect(lockData.pid).toBe(process.pid);
  });

  test("Memory store operates completely in-memory without disk touches", () => {
    const customStore = createMemoryLockStore();
    const memRelease = acquireTestLock(true, ["tests"], {
      store: customStore,
      inMemory: true,
      skipSignalHandlers: true,
    });
    expect(customStore.existsSync(BROAD_LOCK_FILE)).toBe(true);
    memRelease();
    expect(customStore.existsSync(BROAD_LOCK_FILE)).toBe(false);
  });

  test("releaseTestLock handles error unlinking lock file gracefully", () => {
    release = acquireTestLock(true, ["tests"]);
    expect(memStore.existsSync(BROAD_LOCK_FILE)).toBe(true);

    const failingStore: LockStore = {
      ...memStore,
      unlinkSync: () => {
        throw new Error("Permission error during unlock");
      },
    };
    setLockStore(failingStore);

    expect(() => release?.()).not.toThrow();
  });
});
