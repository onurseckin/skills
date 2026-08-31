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
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_RETRY_INTERVAL_MS,
  DEFAULT_STALE_THRESHOLD_MS,
  acquireMailboxLock,
  delay,
  isProcessAlive,
  parseLockPayload,
  readHolderPid,
  reclaimStaleLocks,
  releaseMailboxLock,
  withExclusiveLock,
  withExclusiveLockAsync,
} from "../../../olt/scripts/src/communication/locking/index.ts";

describe("SafeLock Advisory File Locking Engine", () => {
  let tempDir: string;
  let locksDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "safelock-test-"));
    locksDir = join(tempDir, ".locks");
    mkdirSync(locksDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("constants and helpers", () => {
    it("exports standard configuration values and delay works with negative/zero/positive", () => {
      expect(DEFAULT_LOCK_TIMEOUT_MS).toBe(10_000);
      expect(DEFAULT_STALE_THRESHOLD_MS).toBe(10_000);
      expect(DEFAULT_RETRY_INTERVAL_MS).toBe(25);
      delay(0);
      delay(-10);
      const start = performance.now();
      delay(15);
      expect(performance.now() - start).toBeGreaterThanOrEqual(10);
    });

    it("isProcessAlive detects running, dead, and invalid PIDs", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
      expect(isProcessAlive(0)).toBe(false);
      expect(isProcessAlive(-1)).toBe(false);
      expect(isProcessAlive(Number.NaN)).toBe(false);
      expect(isProcessAlive(1.5)).toBe(false);
      expect(isProcessAlive(99_999_999)).toBe(false);
    });

    it("parseLockPayload parses valid payload and rejects invalid inputs and JSON parse errors", () => {
      const valid = JSON.stringify({
        pid: 12345,
        holder: "agent-a",
        created_at: "2026-08-29T00:00:00.000Z",
      });
      expect(parseLockPayload(valid)).toEqual({
        pid: 12345,
        holder: "agent-a",
        created_at: "2026-08-29T00:00:00.000Z",
      });
      expect(parseLockPayload("")).toBeNull();
      expect(parseLockPayload("invalid json")).toBeNull();
      expect(parseLockPayload("{ invalid json syntax }")).toBeNull();
      expect(parseLockPayload(JSON.stringify({ pid: "not-a-number" }))).toBeNull();
      expect(parseLockPayload(JSON.stringify({ pid: 1.5, holder: "a", created_at: "now" }))).toBeNull();
      expect(parseLockPayload(JSON.stringify({ pid: 1, holder: 123, created_at: "now" }))).toBeNull();
      expect(parseLockPayload(JSON.stringify({ pid: 1, holder: "a", created_at: 123 }))).toBeNull();
    });
  });

  describe("acquireMailboxLock and releaseMailboxLock", () => {
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

    it("throws INTEGRITY when openSync fails", () => {
      const dirAsLockPath = join(locksDir, "directory-path");
      mkdirSync(dirAsLockPath);
      expect(() => acquireMailboxLock(dirAsLockPath, "agent-fail")).toThrow(HarnessError);
    });

    it("fails closed on invalid arguments with HarnessError", () => {
      const validPath = join(locksDir, "valid.lock");
      expect(() => acquireMailboxLock("", "agent-1")).toThrow(HarnessError);
      expect(() => acquireMailboxLock(123 as unknown as string, "agent-1")).toThrow(HarnessError);
      expect(() => acquireMailboxLock(validPath, "")).toThrow(HarnessError);
      expect(() => acquireMailboxLock(validPath, null as unknown as string)).toThrow(HarnessError);
      expect(() => acquireMailboxLock(validPath, "agent-1", { timeoutMs: -1 })).toThrow(HarnessError);
      expect(() => acquireMailboxLock(validPath, "agent-1", { timeoutMs: Infinity })).toThrow(HarnessError);
      expect(() => acquireMailboxLock(validPath, "agent-1", { staleThresholdMs: Number.NaN })).toThrow(HarnessError);
      expect(() => acquireMailboxLock(validPath, "agent-1", { retryMs: -5 })).toThrow(HarnessError);
    });

    it("releaseMailboxLock handles unacquired, null, and closed descriptors safely", () => {
      expect(() =>
        releaseMailboxLock({ acquired: false, lockFd: null, lockPath: "/none", holderPid: null }),
      ).not.toThrow();
      expect(() =>
        releaseMailboxLock({ acquired: true, lockFd: -1, lockPath: "/none", holderPid: null }),
      ).not.toThrow();

      // Test release error branch when fd is already closed
      const filePath = join(locksDir, "closed-fd.lock");
      const fd = openSync(filePath, "w");
      closeSync(fd);
      expect(() =>
        releaseMailboxLock({ acquired: true, lockFd: fd, lockPath: filePath, holderPid: process.pid }),
      ).toThrow();
    });
  });

  describe("mutex behavior and contention", () => {
    it("prevents concurrent acquisition on the same lock path and times out", () => {
      const lockPath = join(locksDir, "mutex.lock");
      const firstResult = acquireMailboxLock(lockPath, "holder-1");
      expect(firstResult.acquired).toBe(true);

      const start = performance.now();
      const secondResult = acquireMailboxLock(lockPath, "holder-2", { timeoutMs: 60, retryMs: 10 });
      expect(performance.now() - start).toBeGreaterThanOrEqual(50);
      expect(secondResult.acquired).toBe(false);
      expect(secondResult.lockFd).toBeNull();
      expect(secondResult.holderPid).toBe(process.pid);

      releaseMailboxLock(firstResult);
      const thirdResult = acquireMailboxLock(lockPath, "holder-2", { timeoutMs: 100, retryMs: 10 });
      expect(thirdResult.acquired).toBe(true);
      releaseMailboxLock(thirdResult);
    });

    it("readHolderPid returns PID for valid lock file and null for missing or invalid files", () => {
      const validPath = join(locksDir, "valid-holder.lock");
      writeFileSync(
        validPath,
        JSON.stringify({ pid: 4321, holder: "h1", created_at: "2026-08-30T00:00:00.000Z" }),
        "utf8",
      );
      expect(readHolderPid(validPath)).toBe(4321);
      expect(readHolderPid(join(locksDir, "nonexistent.lock"))).toBeNull();

      const invalidPath = join(locksDir, "invalid-holder.lock");
      writeFileSync(invalidPath, "not json", "utf8");
      expect(readHolderPid(invalidPath)).toBeNull();
    });
  });

  describe("withExclusiveLock and withExclusiveLockAsync", () => {
    it("executes synchronous operation and guarantees release on completion", () => {
      const lockPath = join(locksDir, "sync-op.lock");
      let executed = false;
      const output = withExclusiveLock(lockPath, "sync-agent", () => {
        executed = true;
        return 42;
      });
      expect(executed).toBe(true);
      expect(output).toBe(42);

      const followUp = acquireMailboxLock(lockPath, "sync-agent");
      expect(followUp.acquired).toBe(true);
      releaseMailboxLock(followUp);
    });

    it("guarantees lock release when synchronous operation throws", () => {
      const lockPath = join(locksDir, "throw-op.lock");
      expect(() =>
        withExclusiveLock(lockPath, "failing-agent", () => {
          throw new Error("simulated failure");
        }),
      ).toThrow("simulated failure");

      const followUp = acquireMailboxLock(lockPath, "recovery-agent");
      expect(followUp.acquired).toBe(true);
      releaseMailboxLock(followUp);
    });

    it("throws LOCK_TIMEOUT HarnessError when lock cannot be acquired synchronously", () => {
      const lockPath = join(locksDir, "timeout-op.lock");
      const blocker = acquireMailboxLock(lockPath, "blocker-agent");
      expect(blocker.acquired).toBe(true);
      try {
        expect(() =>
          withExclusiveLock(lockPath, "waiting-agent", () => "never", {
            timeoutMs: 40,
            retryMs: 10,
          }),
        ).toThrow(HarnessError);
      } finally {
        releaseMailboxLock(blocker);
      }
    });

    it("withExclusiveLockAsync runs async operations, handles errors, and handles timeout", async () => {
      const lockPath = join(locksDir, "async-op.lock");
      const result = await withExclusiveLockAsync(lockPath, "async-agent", async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return "async-success";
      });
      expect(result).toBe("async-success");

      await expect(
        withExclusiveLockAsync(lockPath, "async-agent", async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error("async failure");
        }),
      ).rejects.toThrow("async failure");

      const blocker = acquireMailboxLock(lockPath, "async-blocker");
      try {
        await expect(
          withExclusiveLockAsync(
            lockPath,
            "async-waiter",
            async () => "never",
            { timeoutMs: 30, retryMs: 10 },
          ),
        ).rejects.toThrow(HarnessError);
      } finally {
        releaseMailboxLock(blocker);
      }

      const followUp = acquireMailboxLock(lockPath, "async-agent");
      expect(followUp.acquired).toBe(true);
      releaseMailboxLock(followUp);
    });
  });

  describe("reclaimStaleLocks", () => {
    it("reclaims stale locks from dead processes older than threshold", () => {
      const staleLockPath = join(locksDir, "dead-agent.lock");
      const pastDate = new Date(Date.now() - 25_000).toISOString();
      writeFileSync(
        staleLockPath,
        JSON.stringify({ pid: 99_999_999, holder: "dead-agent", created_at: pastDate }),
        "utf8",
      );
      const reclaimed = reclaimStaleLocks(locksDir, 10_000);
      expect(reclaimed).toContain(staleLockPath);
      expect(existsSync(staleLockPath)).toBe(false);
    });

    it("reclaims unparseable stale lock files based on file mtime", () => {
      const staleUnparseable = join(locksDir, "corrupted-stale.lock");
      writeFileSync(staleUnparseable, "not-json-content", "utf8");
      const pastTime = new Date(Date.now() - 30_000);
      const { utimesSync } = require("node:fs");
      utimesSync(staleUnparseable, pastTime, pastTime);

      const reclaimed = reclaimStaleLocks(locksDir, 10_000);
      expect(reclaimed).toContain(staleUnparseable);
      expect(existsSync(staleUnparseable)).toBe(false);
    });

    it("ignores non-lock files, subdirectories ending in .lock, and alive PIDs", () => {
      const notLockFile = join(locksDir, "ignored.txt");
      writeFileSync(notLockFile, "test", "utf8");
      const subDirLock = join(locksDir, "nested.lock");
      mkdirSync(subDirLock);

      const activeLockPath = join(locksDir, "living-agent.lock");
      const pastDate = new Date(Date.now() - 25_000).toISOString();
      writeFileSync(
        activeLockPath,
        JSON.stringify({ pid: process.pid, holder: "living-agent", created_at: pastDate }),
        "utf8",
      );

      const reclaimed = reclaimStaleLocks(locksDir, 10_000);
      expect(reclaimed).toEqual([]);
      expect(existsSync(activeLockPath)).toBe(true);
      expect(existsSync(notLockFile)).toBe(true);
    });

    it("does not reclaim locks younger than staleThresholdMs even if PID is dead", () => {
      const freshLockPath = join(locksDir, "fresh-dead.lock");
      const freshDate = new Date(Date.now() - 1_000).toISOString();
      writeFileSync(
        freshLockPath,
        JSON.stringify({ pid: 99_999_999, holder: "fresh-agent", created_at: freshDate }),
        "utf8",
      );
      const reclaimed = reclaimStaleLocks(locksDir, 10_000);
      expect(reclaimed).toEqual([]);
      expect(existsSync(freshLockPath)).toBe(true);
    });

    it("never breaks or unlinks a lock actively held via flock even if stale timestamp", () => {
      const activeLockPath = join(locksDir, "flocked-agent.lock");
      const activeAcquisition = acquireMailboxLock(activeLockPath, "flocked-holder");
      try {
        const pastDate = new Date(Date.now() - 25_000).toISOString();
        writeFileSync(
          activeLockPath,
          JSON.stringify({ pid: 99_999_999, holder: "flocked-holder", created_at: pastDate }),
          "utf8",
        );
        const reclaimed = reclaimStaleLocks(locksDir, 10_000);
        expect(reclaimed).toEqual([]);
        expect(existsSync(activeLockPath)).toBe(true);
      } finally {
        releaseMailboxLock(activeAcquisition);
      }
    });

    it("validates arguments fail-closed with HarnessError and returns empty array on missing dir or file", () => {
      expect(reclaimStaleLocks(join(tempDir, "does-not-exist"))).toEqual([]);
      const filePathAsDir = join(tempDir, "file-not-dir");
      writeFileSync(filePathAsDir, "content", "utf8");
      expect(reclaimStaleLocks(filePathAsDir)).toEqual([]);
      expect(() => reclaimStaleLocks("", 10_000)).toThrow(HarnessError);
      expect(() => reclaimStaleLocks(null as unknown as string, 10_000)).toThrow(HarnessError);
      expect(() => reclaimStaleLocks(locksDir, -1)).toThrow(HarnessError);
      expect(() => reclaimStaleLocks(locksDir, Number.NaN)).toThrow(HarnessError);
    });
  });

  describe("architecture invariants and code quality", () => {
    it("ensures source file and index facade are within line budget and have zero suppressions", () => {
      const srcPath = join(process.cwd(), "olt/scripts/src/communication/locking/safe-lock.ts");
      const indexPath = join(process.cwd(), "olt/scripts/src/communication/locking/index.ts");
      const src = readFileSync(srcPath, "utf8");
      const idx = readFileSync(indexPath, "utf8");
      expect(src.split("\n").length).toBeLessThanOrEqual(300);
      expect(idx.split("\n").length).toBeLessThanOrEqual(300);
      expect(src).not.toContain("@ts-ignore");
      expect(idx).not.toContain("export *");
    });
  });
});
