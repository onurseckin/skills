import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  acquireWorktreeLock,
  releaseOrchestratorLock,
  releaseTrackLock,
  releaseWorktreeLock,
} from "../../../olt/scripts/src/workflow/worktree/lock.ts";
import { setupWorkflowVirtualFs } from "../shared/index.ts";

const TEST_DIR = "/virtual/worktree-lock-ownership-suite";

describe("releaseWorktreeLock process ownership verification", () => {
  let vfsCleanup: (() => void) | undefined;
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
    vfs = setup.vfs;
    vfs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("returns true when lock file does not exist", () => {
    const lockPath = join(TEST_DIR, "nonexistent.lock");
    const result = releaseWorktreeLock(lockPath);
    expect(result).toBe(true);
  });

  test("refuses to unlink lock held by another PID without force", () => {
    const lockPath = join(TEST_DIR, "foreign.lock");
    const foreignPid = process.pid + 88888;
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "track-foreign",
        pid: foreignPid,
        createdAt: new Date().toISOString(),
      }),
    );

    const result = releaseWorktreeLock(lockPath);
    expect(result).toBe(false);
    expect(vfs.existsSync(lockPath)).toBe(true);
  });

  test("successfully unlinks lock held by the same PID", () => {
    const lockPath = join(TEST_DIR, "own.lock");
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "track-own",
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }),
    );

    const result = releaseWorktreeLock(lockPath);
    expect(result).toBe(true);
    expect(vfs.existsSync(lockPath)).toBe(false);
  });

  test("force: true allows releasing lock held by another PID", () => {
    const lockPath = join(TEST_DIR, "forced.lock");
    const foreignPid = process.pid + 77777;
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "track-forced",
        pid: foreignPid,
        createdAt: new Date().toISOString(),
      }),
    );

    const result = releaseWorktreeLock(lockPath, { force: true });
    expect(result).toBe(true);
    expect(vfs.existsSync(lockPath)).toBe(false);
  });

  test("respects ownerPid option matching lock PID", () => {
    const lockPath = join(TEST_DIR, "delegated-match.lock");
    const customPid = 43210;
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "track-delegated-match",
        pid: customPid,
        createdAt: new Date().toISOString(),
      }),
    );

    const result = releaseWorktreeLock(lockPath, { ownerPid: customPid });
    expect(result).toBe(true);
    expect(vfs.existsSync(lockPath)).toBe(false);
  });

  test("refuses to unlink when ownerPid option does not match lock PID", () => {
    const lockPath = join(TEST_DIR, "delegated-mismatch.lock");
    const customPid = 43210;
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "track-delegated-mismatch",
        pid: customPid,
        createdAt: new Date().toISOString(),
      }),
    );

    const result = releaseWorktreeLock(lockPath, { ownerPid: 99999 });
    expect(result).toBe(false);
    expect(vfs.existsSync(lockPath)).toBe(true);
  });

  test("unlinks corrupted or non-PID lock safely", () => {
    const lockPath = join(TEST_DIR, "corrupt.lock");
    vfs.writeFileSync(lockPath, "{ invalid json payload");

    const result = releaseWorktreeLock(lockPath);
    expect(result).toBe(true);
    expect(vfs.existsSync(lockPath)).toBe(false);
  });

  test("releaseTrackLock enforces process ownership", () => {
    const lockPath = join(TEST_DIR, "track-wrapper.lock");
    const foreignPid = process.pid + 66666;
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "track-wrapper",
        pid: foreignPid,
        createdAt: new Date().toISOString(),
      }),
    );

    const denied = releaseTrackLock(lockPath);
    expect(denied).toBe(false);
    expect(vfs.existsSync(lockPath)).toBe(true);

    const allowed = releaseTrackLock(lockPath, { force: true });
    expect(allowed).toBe(true);
    expect(vfs.existsSync(lockPath)).toBe(false);
  });

  test("releaseOrchestratorLock enforces process ownership", () => {
    const lockPath = join(TEST_DIR, "orch-wrapper.lock");
    const foreignPid = process.pid + 55555;
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "orch-wrapper",
        pid: foreignPid,
        createdAt: new Date().toISOString(),
      }),
    );

    const denied = releaseOrchestratorLock(lockPath);
    expect(denied).toBe(false);
    expect(vfs.existsSync(lockPath)).toBe(true);

    const allowed = releaseOrchestratorLock(lockPath, { force: true });
    expect(allowed).toBe(true);
    expect(vfs.existsSync(lockPath)).toBe(false);
  });

  test("acquireWorktreeLock and releaseWorktreeLock work end-to-end", () => {
    const lockPath = join(TEST_DIR, "e2e.lock");
    acquireWorktreeLock(lockPath, "track-e2e");
    expect(vfs.existsSync(lockPath)).toBe(true);

    const denied = releaseWorktreeLock(lockPath, { ownerPid: process.pid + 1234 });
    expect(denied).toBe(false);
    expect(vfs.existsSync(lockPath)).toBe(true);

    const allowed = releaseWorktreeLock(lockPath);
    expect(allowed).toBe(true);
    expect(vfs.existsSync(lockPath)).toBe(false);
  });

  test("returns false when unlinkSync throws on failed deletion", () => {
    const lockPath = join(TEST_DIR, "failed-unlink.lock");
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "track-failed",
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }),
    );

    const origRm = vfs.rmSync.bind(vfs);
    vfs.rmSync = () => {
      throw new Error("EACCES: permission denied");
    };

    try {
      const result = releaseWorktreeLock(lockPath);
      expect(result).toBe(false);
      expect(vfs.existsSync(lockPath)).toBe(true);
    } finally {
      vfs.rmSync = origRm;
    }
  });
});
