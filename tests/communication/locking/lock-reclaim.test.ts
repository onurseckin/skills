import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reclaimInMemoryStaleLocks,
  reclaimStaleLocks,
} from "../../../olt/scripts/src/communication/locking/lock-reclaim.ts";
import {
  acquireMailboxLock,
  getInMemoryLock,
  releaseMailboxLock,
  resetInMemoryLocks,
  seedInMemoryLock,
  setInMemoryLocking,
} from "../../../olt/scripts/src/communication/locking/safe-lock.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS } from "../helpers.ts";

describe("Lock Reclaim Engine (Disk and In-Memory)", () => {
  let tempDir: string;
  let locksDir: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    setInMemoryLocking(false);
    resetInMemoryLocks();
    tempDir = mkdtempSync(join(tmpdir(), "reclaim-test-"));
    locksDir = join(tempDir, ".locks");
    mkdirSync(locksDir, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualCommunicationFS();
  });

  describe("argument validation and error handling", () => {
    it("fails closed on invalid arguments with HarnessError", () => {
      expect(() => reclaimStaleLocks("", 10_000)).toThrow(HarnessError);
      expect(() => reclaimStaleLocks(null as unknown as string, 10_000)).toThrow(HarnessError);
      expect(() => reclaimStaleLocks(locksDir, -1)).toThrow(HarnessError);
      expect(() => reclaimStaleLocks(locksDir, Number.NaN)).toThrow(HarnessError);

      expect(() => reclaimInMemoryStaleLocks("", 10_000)).toThrow(HarnessError);
      expect(() => reclaimInMemoryStaleLocks(null as unknown as string, 10_000)).toThrow(
        HarnessError,
      );
      expect(() => reclaimInMemoryStaleLocks(locksDir, -1)).toThrow(HarnessError);
      expect(() => reclaimInMemoryStaleLocks(locksDir, Number.NaN)).toThrow(HarnessError);
    });

    it("returns empty array for non-existent directory or file path as directory on disk", () => {
      expect(reclaimStaleLocks(join(tempDir, "nonexistent"))).toEqual([]);
      const filePath = join(tempDir, "file-not-dir");
      writeFileSync(filePath, "file-content", "utf8");
      expect(reclaimStaleLocks(filePath)).toEqual([]);
    });
  });

  describe("physical disk stale lock reclaim", () => {
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
      utimesSync(staleUnparseable, pastTime, pastTime);

      const reclaimed = reclaimStaleLocks(locksDir, 10_000);
      expect(reclaimed).toContain(staleUnparseable);
      expect(existsSync(staleUnparseable)).toBe(false);
    });

    it("ignores non-lock files and subdirectories ending in .lock", () => {
      const notLockFile = join(locksDir, "ignored.txt");
      writeFileSync(notLockFile, "test", "utf8");
      const subDirLock = join(locksDir, "nested.lock");
      mkdirSync(subDirLock);

      const reclaimed = reclaimStaleLocks(locksDir, 10_000);
      expect(reclaimed).toEqual([]);
      expect(existsSync(notLockFile)).toBe(true);
      expect(existsSync(subDirLock)).toBe(true);
    });

    it("does not reclaim locks held by living PIDs even if older than threshold", () => {
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
    });

    it("does not reclaim locks younger than threshold even if process is dead", () => {
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
  });

  describe("in-memory zero-disk stale lock reclaim", () => {
    const memLocksDir = "/virtual/workspace/.locks";

    beforeEach(() => {
      setInMemoryLocking(true);
    });

    it("reclaims stale in-memory lock from dead PID older than threshold", () => {
      const staleMemLock = join(memLocksDir, "dead-mem-worker.lock");
      const pastDate = new Date(Date.now() - 30_000).toISOString();
      seedInMemoryLock(staleMemLock, {
        pid: 99_999_999,
        holder: "dead-mem-worker",
        created_at: pastDate,
      });

      expect(getInMemoryLock(staleMemLock)).not.toBeNull();
      const reclaimed = reclaimStaleLocks(memLocksDir, 10_000);
      expect(reclaimed).toContain(staleMemLock);
      expect(getInMemoryLock(staleMemLock)).toBeNull();
    });

    it("reclaims in-memory lock with corrupted timestamp using mtimeMs", () => {
      const corruptedLock = join(memLocksDir, "corrupted-date.lock");
      const pastTime = Date.now() - 40_000;
      seedInMemoryLock(
        corruptedLock,
        { pid: 99_999_999, holder: "corrupt-agent", created_at: "not-a-valid-date" },
        pastTime,
      );

      const reclaimed = reclaimInMemoryStaleLocks(memLocksDir, 10_000);
      expect(reclaimed).toContain(corruptedLock);
      expect(getInMemoryLock(corruptedLock)).toBeNull();
    });

    it("retains in-memory lock held by alive PID even if older than threshold", () => {
      const liveMemLock = join(memLocksDir, "live-mem-worker.lock");
      const pastDate = new Date(Date.now() - 30_000).toISOString();
      seedInMemoryLock(liveMemLock, {
        pid: process.pid,
        holder: "live-mem-worker",
        created_at: pastDate,
      });

      const reclaimed = reclaimStaleLocks(memLocksDir, 10_000);
      expect(reclaimed).toEqual([]);
      expect(getInMemoryLock(liveMemLock)).not.toBeNull();
    });

    it("retains fresh in-memory lock younger than threshold even if PID is dead", () => {
      const freshMemLock = join(memLocksDir, "fresh-dead-worker.lock");
      const freshDate = new Date(Date.now() - 500).toISOString();
      seedInMemoryLock(freshMemLock, {
        pid: 99_999_999,
        holder: "fresh-dead",
        created_at: freshDate,
      });

      const reclaimed = reclaimStaleLocks(memLocksDir, 10_000);
      expect(reclaimed).toEqual([]);
      expect(getInMemoryLock(freshMemLock)).not.toBeNull();
    });

    it("does not reclaim in-memory locks in other directories", () => {
      const otherDirLock = "/other/directory/worker.lock";
      const pastDate = new Date(Date.now() - 30_000).toISOString();
      seedInMemoryLock(otherDirLock, {
        pid: 99_999_999,
        holder: "other-worker",
        created_at: pastDate,
      });

      const reclaimed = reclaimStaleLocks(memLocksDir, 10_000);
      expect(reclaimed).toEqual([]);
      expect(getInMemoryLock(otherDirLock)).not.toBeNull();
    });
  });
});
