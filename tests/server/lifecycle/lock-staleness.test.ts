import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import { isLocked, ServerLockError } from "../../../olt/scripts/src/server/lifecycle/lock.ts";
import { VirtualFSError } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupVirtualServerFS, scratchRoot, setupVirtualServerFS } from "../fixture.ts";

describe("Dev Server Lifecycle Subsystem - Lock Staleness Error Semantics", () => {
  let testDir: string;
  let lockPath: string;

  beforeEach(() => {
    setupVirtualServerFS();
    testDir = scratchRoot("server-lifecycle-lock-staleness", "staleness");
    lockPath = join(testDir, "server-restart.lock");
  });

  afterEach(() => {
    cleanupVirtualServerFS();
  });

  it("treats a lock file that vanishes mid-check (ENOENT) as stale and reclaimable", async () => {
    const vfs = setupVirtualServerFS();
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        lockHolderId: "holder",
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      }),
    );
    const statSpy = spyOn(vfs, "statSync").mockImplementation(() => {
      throw VirtualFSError.enoent(lockPath, "stat");
    });

    try {
      expect(await isLocked(lockPath)).toBe(false);
    } finally {
      statSpy.mockRestore();
    }
  });

  it("does not silently declare a present-but-unreadable lock stale on a non-ENOENT stat failure", async () => {
    const vfs = setupVirtualServerFS();
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        lockHolderId: "holder",
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      }),
    );
    const statSpy = spyOn(vfs, "statSync").mockImplementation(() => {
      throw new VirtualFSError(
        "EACCES",
        `EACCES: permission denied, stat '${lockPath}'`,
        lockPath,
        "stat",
      );
    });

    try {
      await expect(isLocked(lockPath)).rejects.toThrow(ServerLockError);
    } finally {
      statSpy.mockRestore();
    }
  });
});
