import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
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
} from "../../../olt/scripts/src/communication/locking/safe-lock.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS } from "../helpers.ts";

describe("SafeLock Advisory Locking Engine (Disk and In-Memory)", () => {
  let tempDir: string;
  let locksDir: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    setInMemoryLocking(false);
    resetInMemoryLocks();
    tempDir = mkdtempSync(join(tmpdir(), "safelock-test-"));
    locksDir = join(tempDir, ".locks");
    mkdirSync(locksDir, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualCommunicationFS();
  });

  it("validates constants, delay, process liveness, payload parsing and bad arguments", () => {
    expect(DEFAULT_LOCK_TIMEOUT_MS).toBe(10_000);
    expect(DEFAULT_STALE_THRESHOLD_MS).toBe(10_000);
    expect(DEFAULT_RETRY_INTERVAL_MS).toBe(25);
    delay(0);
    delay(-5);
    const start = performance.now();
    delay(15);
    expect(performance.now() - start).toBeGreaterThanOrEqual(10);

    expect(isProcessAlive(process.pid)).toBe(true);
    for (const pid of [0, -1, Number.NaN, 1.5, 99_999_999]) expect(isProcessAlive(pid)).toBe(false);

    const valid = { pid: 12345, holder: "agent-a", created_at: "2026-08-29T00:00:00.000Z" };
    expect(parseLockPayload(JSON.stringify(valid))).toEqual(valid);
    for (const inv of [
      "",
      "invalid json",
      "{ invalid json }",
      JSON.stringify({ pid: "not-a-number" }),
      JSON.stringify({ pid: 1.5, holder: "a", created_at: "now" }),
      JSON.stringify({ pid: 1, holder: 123, created_at: "now" }),
      JSON.stringify({ pid: 1, holder: "a", created_at: 123 }),
    ]) {
      expect(parseLockPayload(inv)).toBeNull();
    }

    const validPath = join(locksDir, "valid.lock");
    for (const bad of [
      () => acquireMailboxLock("", "agent-1"),
      () => acquireMailboxLock(123 as unknown as string, "agent-1"),
      () => acquireMailboxLock(validPath, ""),
      () => acquireMailboxLock(validPath, null as unknown as string),
      () => acquireMailboxLock(validPath, "agent-1", { timeoutMs: -1 }),
      () => acquireMailboxLock(validPath, "agent-1", { timeoutMs: Infinity }),
      () => acquireMailboxLock(validPath, "agent-1", { staleThresholdMs: Number.NaN }),
      () => acquireMailboxLock(validPath, "agent-1", { retryMs: -5 }),
    ]) {
      expect(bad).toThrow(HarnessError);
    }
  });

  it("handles physical disk lock acquisition, auto-mkdir, errors and re-entrancy", () => {
    const lockPath = join(locksDir, "agent-1.lock");
    const result = acquireMailboxLock(lockPath, "agent-1");
    expect(result.acquired).toBe(true);
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

    const nested = join(tempDir, "deep", "nested", "locks", "worker.lock");
    const nestedRes = acquireMailboxLock(nested, "nested-worker");
    expect(nestedRes.acquired).toBe(true);
    releaseMailboxLock(nestedRes);

    const blocker = join(tempDir, "blocker-file");
    writeFileSync(blocker, "not-a-dir", "utf8");
    expect(() => acquireMailboxLock(join(blocker, "c", "l.lock"), "fail")).toThrow(HarnessError);

    const dirAsLock = join(locksDir, "directory-path");
    mkdirSync(dirAsLock);
    expect(() => acquireMailboxLock(dirAsLock, "fail")).toThrow(HarnessError);
  });

  it("prevents concurrent acquisition on disk and handles release safely", () => {
    const lockPath = join(locksDir, "mutex.lock");
    const first = acquireMailboxLock(lockPath, "holder-1");
    expect(first.acquired).toBe(true);

    const second = acquireMailboxLock(lockPath, "holder-2", { timeoutMs: 60, retryMs: 10 });
    expect(second.acquired).toBe(false);
    expect(second.holderPid).toBe(process.pid);
    releaseMailboxLock(first);

    const third = acquireMailboxLock(lockPath, "holder-2", { timeoutMs: 100, retryMs: 10 });
    expect(third.acquired).toBe(true);
    releaseMailboxLock(third);
  });

  it("reads holder PID from disk and handles safe and faulty descriptor release", () => {
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

    expect(() =>
      releaseMailboxLock({ acquired: false, lockFd: null, lockPath: "/none", holderPid: null }),
    ).not.toThrow();
    expect(() =>
      releaseMailboxLock({ acquired: true, lockFd: -1, lockPath: "/none", holderPid: null }),
    ).not.toThrow();

    const closed = join(locksDir, "closed-fd.lock");
    const fd = openSync(closed, "w");
    closeSync(fd);
    expect(() =>
      releaseMailboxLock({ acquired: true, lockFd: fd, lockPath: closed, holderPid: process.pid }),
    ).toThrow();
  });

  it("acquires and prevents concurrent in-memory acquisition with timeouts", () => {
    setInMemoryLocking(true);
    expect(isInMemoryLocking()).toBe(true);
    const lockPath = "/virtual/locks/in-mem-agent.lock";
    const result = acquireMailboxLock(lockPath, "mem-worker-1");
    expect(result.acquired).toBe(true);
    expect(result.lockFd).toBeGreaterThanOrEqual(100_000);
    expect(result.holderPid).toBe(process.pid);
    expect(existsSync(lockPath)).toBe(false);

    const mem = getInMemoryLock(lockPath);
    expect(mem?.holder).toBe("mem-worker-1");
    expect(mem?.pid).toBe(process.pid);
    expect(readHolderPid(lockPath)).toBe(process.pid);

    const start = performance.now();
    const contended = acquireMailboxLock(lockPath, "agent-second", { timeoutMs: 40, retryMs: 10 });
    expect(performance.now() - start).toBeGreaterThanOrEqual(30);
    expect(contended.acquired).toBe(false);
    expect(contended.holderPid).toBe(process.pid);

    releaseMailboxLock(result);
    expect(getInMemoryLock(lockPath)).toBeNull();

    const res3 = acquireMailboxLock(lockPath, "agent-second", { timeoutMs: 50, retryMs: 10 });
    expect(res3.acquired).toBe(true);
    releaseMailboxLock(res3);
  });

  it("manages seed, get, remove, and reset of in-memory locks", () => {
    setInMemoryLocking(true);
    const p1 = "/mem/agent1.lock";
    const p2 = "/mem/agent2.lock";
    const fd1 = seedInMemoryLock(p1, {
      pid: 8888,
      holder: "seeded-agent",
      created_at: "2026-08-31T00:00:00.000Z",
    });
    expect(fd1).toBeGreaterThanOrEqual(100_000);
    expect(readHolderPid(p1)).toBe(8888);
    expect(getInMemoryLock(p1)?.holder).toBe("seeded-agent");
    expect(removeInMemoryLock(p1)).toBe(true);
    expect(getInMemoryLock(p1)).toBeNull();

    seedInMemoryLock(p2, { pid: 9999, holder: "agent-2", created_at: "2026-08-31T00:00:00.000Z" });
    resetInMemoryLocks();
    expect(getInMemoryLock(p2)).toBeNull();
  });

  it("executes withExclusiveLock and withExclusiveLockAsync in in-memory mode", async () => {
    setInMemoryLocking(true);
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
      withExclusiveLockAsync(lockPath, "blocked", async () => "nope", {
        timeoutMs: 20,
        retryMs: 5,
      }),
    ).rejects.toThrow(HarnessError);
    releaseMailboxLock(blocker);
  });

  it("executes acquireMailboxLockAsync in in-memory mode", async () => {
    setInMemoryLocking(true);
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

    await expect(
      withExclusiveLockAsync(lockPath, "error-agent", async () => {
        throw new Error("action error");
      }),
    ).rejects.toThrow("action error");
    expect(getInMemoryLock(lockPath)).toBeNull();
  });
});
