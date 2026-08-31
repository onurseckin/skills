import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_RETRY_INTERVAL_MS,
  DEFAULT_STALE_THRESHOLD_MS,
  acquireMailboxLock,
  acquireMailboxLockAsync,
  delay,
  getInMemoryLock,
  isInMemoryLocking,
  isProcessAlive,
  parseLockPayload,
  readHolderPid,
  releaseMailboxLock,
  removeInMemoryLock,
  resetInMemoryLocks,
  seedInMemoryLock,
  setInMemoryLocking,
  withExclusiveLock,
  withExclusiveLockAsync,
} from "../../../../olt/scripts/src/communication/locking/safe-lock.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("SafeLock Advisory Locking Engine (Disk and In-Memory)", () => {
  let tempDir: string;
  let locksDir: string;

  beforeEach(() => {
    setInMemoryLocking(false);
    resetInMemoryLocks();
    tempDir = mkdtempSync(join(tmpdir(), "safelock-test-"));
    locksDir = join(tempDir, ".locks");
    mkdirSync(locksDir, { recursive: true });
  });

  afterEach(() => {
    setInMemoryLocking(false);
    resetInMemoryLocks();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("constants and validation helpers", () => {
    it("exports standard configuration values and delay handles positive/zero/negative", () => {
      expect(DEFAULT_LOCK_TIMEOUT_MS).toBe(10_000);
      expect(DEFAULT_STALE_THRESHOLD_MS).toBe(10_000);
      expect(DEFAULT_RETRY_INTERVAL_MS).toBe(25);
      delay(0);
      delay(-5);
      const start = performance.now();
      delay(15);
      expect(performance.now() - start).toBeGreaterThanOrEqual(10);
    });

    it("isProcessAlive detects running, dead, and invalid PIDs", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
      for (const pid of [0, -1, Number.NaN, 1.5, 99_999_999]) {
        expect(isProcessAlive(pid)).toBe(false);
      }
    });

    it("parseLockPayload parses valid payload and rejects invalid inputs and malformed JSON", () => {
      const validPayload = { pid: 12345, holder: "agent-a", created_at: "2026-08-29T00:00:00.000Z" };
      expect(parseLockPayload(JSON.stringify(validPayload))).toEqual(validPayload);
      const invalids = [
        "",
        "invalid json",
        "{ invalid json }",
        JSON.stringify({ pid: "not-a-number" }),
        JSON.stringify({ pid: 1.5, holder: "a", created_at: "now" }),
        JSON.stringify({ pid: 1, holder: 123, created_at: "now" }),
        JSON.stringify({ pid: 1, holder: "a", created_at: 123 }),
      ];
      for (const invalid of invalids) expect(parseLockPayload(invalid)).toBeNull();
    });

    it("fails closed on invalid arguments with HarnessError", () => {
      const validPath = join(locksDir, "valid.lock");
      const badCalls = [
        () => acquireMailboxLock("", "agent-1"),
        () => acquireMailboxLock(123 as unknown as string, "agent-1"),
        () => acquireMailboxLock(validPath, ""),
        () => acquireMailboxLock(validPath, null as unknown as string),
        () => acquireMailboxLock(validPath, "agent-1", { timeoutMs: -1 }),
        () => acquireMailboxLock(validPath, "agent-1", { timeoutMs: Infinity }),
        () => acquireMailboxLock(validPath, "agent-1", { staleThresholdMs: Number.NaN }),
        () => acquireMailboxLock(validPath, "agent-1", { retryMs: -5 }),
      ];
      for (const call of badCalls) expect(call).toThrow(HarnessError);
    });
  });

  describe("physical disk lock acquisition and release", () => {
    it("successfully acquires lock and writes structured payload to disk", () => {
      const lockPath = join(locksDir, "agent-1.lock");
      const result = acquireMailboxLock(lockPath, "agent-1");
      expect(result.acquired).toBe(true);
      expect(typeof result.lockFd).toBe("number");
      expect(result.lockFd).toBeGreaterThan(0);
      expect(result.lockPath).toBe(lockPath);
      expect(result.holderPid).toBe(process.pid);
      expect(existsSync(lockPath)).toBe(true);

      const payload = parseLockPayload(readFileSync(lockPath, "utf8"));
      expect(payload?.pid).toBe(process.pid);
      expect(payload?.holder).toBe("agent-1");
      releaseMailboxLock(result);

      withExclusiveLock(lockPath, "agent-1-reenter", () => {
        expect(existsSync(lockPath)).toBe(true);
      });
    });

    it("auto-creates non-existent parent directory when acquiring lock", () => {
      const nestedLockPath = join(tempDir, "deep", "nested", "locks", "worker.lock");
      const result = acquireMailboxLock(nestedLockPath, "nested-worker");
      expect(result.acquired).toBe(true);
      expect(existsSync(nestedLockPath)).toBe(true);
      releaseMailboxLock(result);
    });

    it("throws INTEGRITY when mkdirSync fails during parent directory creation", () => {
      const blockingFilePath = join(tempDir, "blocker-file");
      writeFileSync(blockingFilePath, "not-a-dir", "utf8");
      const impossibleLockPath = join(blockingFilePath, "child", "lock.lock");
      expect(() => acquireMailboxLock(impossibleLockPath, "agent-fail")).toThrow(HarnessError);
    });

    it("throws INTEGRITY when openSync fails on directory path", () => {
      const dirAsLockPath = join(locksDir, "directory-path");
      mkdirSync(dirAsLockPath);
      expect(() => acquireMailboxLock(dirAsLockPath, "agent-fail")).toThrow(HarnessError);
    });

    it("prevents concurrent acquisition on disk and handles release safely", () => {
      const lockPath = join(locksDir, "mutex.lock");
      const firstResult = acquireMailboxLock(lockPath, "holder-1");
      expect(firstResult.acquired).toBe(true);

      const secondResult = acquireMailboxLock(lockPath, "holder-2", { timeoutMs: 60, retryMs: 10 });
      expect(secondResult.acquired).toBe(false);
      expect(secondResult.holderPid).toBe(process.pid);

      releaseMailboxLock(firstResult);

      const thirdResult = acquireMailboxLock(lockPath, "holder-2", { timeoutMs: 100, retryMs: 10 });
      expect(thirdResult.acquired).toBe(true);
      releaseMailboxLock(thirdResult);
    });

    it("readHolderPid returns PID for valid disk lock file and null for missing or invalid files", () => {
      const validPath = join(locksDir, "valid-holder.lock");
      const payload = { pid: 4321, holder: "h1", created_at: "2026-08-30T00:00:00.000Z" };
      writeFileSync(validPath, JSON.stringify(payload), "utf8");
      expect(readHolderPid(validPath)).toBe(4321);
      expect(readHolderPid(join(locksDir, "nonexistent.lock"))).toBeNull();
      const invalidPath = join(locksDir, "invalid-holder.lock");
      writeFileSync(invalidPath, "not json", "utf8");
      expect(readHolderPid(invalidPath)).toBeNull();
    });

    it("handles unacquired, null, and closed descriptors safely on release", () => {
      expect(() =>
        releaseMailboxLock({ acquired: false, lockFd: null, lockPath: "/none", holderPid: null }),
      ).not.toThrow();
      expect(() =>
        releaseMailboxLock({ acquired: true, lockFd: -1, lockPath: "/none", holderPid: null }),
      ).not.toThrow();

      const filePath = join(locksDir, "closed-fd.lock");
      const fd = openSync(filePath, "w");
      closeSync(fd);
      expect(() =>
        releaseMailboxLock({ acquired: true, lockFd: fd, lockPath: filePath, holderPid: process.pid }),
      ).toThrow();
    });
  });

  describe("in-memory zero-disk lock acquisition and release", () => {
    beforeEach(() => setInMemoryLocking(true));

    it("acquires in-memory lock without creating physical files on disk", () => {
      expect(isInMemoryLocking()).toBe(true);
      const lockPath = "/virtual/locks/in-mem-agent.lock";
      const result = acquireMailboxLock(lockPath, "mem-worker-1");
      expect(result.acquired).toBe(true);
      expect(result.lockFd).toBeGreaterThanOrEqual(100_000);
      expect(result.holderPid).toBe(process.pid);
      expect(existsSync(lockPath)).toBe(false);

      const memRecord = getInMemoryLock(lockPath);
      expect(memRecord).not.toBeNull();
      expect(memRecord?.holder).toBe("mem-worker-1");
      expect(memRecord?.pid).toBe(process.pid);
      expect(readHolderPid(lockPath)).toBe(process.pid);

      releaseMailboxLock(result);
      expect(getInMemoryLock(lockPath)).toBeNull();
    });

    it("prevents concurrent in-memory acquisition on same lock path and times out", () => {
      const lockPath = "/virtual/locks/contended.lock";
      const res1 = acquireMailboxLock(lockPath, "agent-first");
      expect(res1.acquired).toBe(true);

      const start = performance.now();
      const res2 = acquireMailboxLock(lockPath, "agent-second", { timeoutMs: 40, retryMs: 10 });
      expect(performance.now() - start).toBeGreaterThanOrEqual(30);
      expect(res2.acquired).toBe(false);
      expect(res2.holderPid).toBe(process.pid);

      releaseMailboxLock(res1);
      const res3 = acquireMailboxLock(lockPath, "agent-second", { timeoutMs: 50, retryMs: 10 });
      expect(res3.acquired).toBe(true);
      releaseMailboxLock(res3);
    });

    it("supports seedInMemoryLock, getInMemoryLock, removeInMemoryLock, and resetInMemoryLocks", () => {
      const path1 = "/mem/agent1.lock";
      const path2 = "/mem/agent2.lock";
      const fd1 = seedInMemoryLock(path1, {
        pid: 8888,
        holder: "seeded-agent",
        created_at: "2026-08-31T00:00:00.000Z",
      });
      expect(fd1).toBeGreaterThanOrEqual(100_000);
      expect(readHolderPid(path1)).toBe(8888);
      expect(getInMemoryLock(path1)?.holder).toBe("seeded-agent");
      expect(removeInMemoryLock(path1)).toBe(true);
      expect(getInMemoryLock(path1)).toBeNull();

      seedInMemoryLock(path2, { pid: 9999, holder: "agent-2", created_at: "2026-08-31T00:00:00.000Z" });
      resetInMemoryLocks();
      expect(getInMemoryLock(path2)).toBeNull();
    });

    it("executes withExclusiveLock and withExclusiveLockAsync in in-memory mode", async () => {
      const lockPath = "/virtual/locks/exclusive.lock";
      let ranSync = false;
      const syncVal = withExclusiveLock(lockPath, "sync-agent", () => {
        ranSync = true;
        return 999;
      });
      expect(ranSync).toBe(true);
      expect(syncVal).toBe(999);
      expect(getInMemoryLock(lockPath)).toBeNull();

      const asyncVal = await withExclusiveLockAsync(lockPath, "async-agent", async () => "async-ok");
      expect(asyncVal).toBe("async-ok");
      expect(getInMemoryLock(lockPath)).toBeNull();

      const blocker = acquireMailboxLock(lockPath, "blocker");
      expect(() =>
        withExclusiveLock(lockPath, "blocked", () => "nope", { timeoutMs: 20, retryMs: 5 }),
      ).toThrow(HarnessError);
      await expect(
        withExclusiveLockAsync(lockPath, "blocked", async () => "nope", { timeoutMs: 20, retryMs: 5 }),
      ).rejects.toThrow(HarnessError);
      releaseMailboxLock(blocker);
    });

    it("executes acquireMailboxLockAsync in in-memory mode", async () => {
      const lockPath = "/virtual/locks/async-direct.lock";
      const res1 = await acquireMailboxLockAsync(lockPath, "async-1");
      expect(res1.acquired).toBe(true);
      expect(res1.lockFd).toBeGreaterThanOrEqual(100_000);

      const res2 = await acquireMailboxLockAsync(lockPath, "async-2", { timeoutMs: 25, retryMs: 5 });
      expect(res2.acquired).toBe(false);

      releaseMailboxLock(res1);
      const res3 = await acquireMailboxLockAsync(lockPath, "async-2", { timeoutMs: 50, retryMs: 5 });
      expect(res3.acquired).toBe(true);
      releaseMailboxLock(res3);
    });
  });
});
