import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cleanseDanglingLocks,
  isProcessAlive,
} from "../../../olt/scripts/src/reporting/doctor/lock-cleaner.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const lockCleanerSuiteName = "Wave 1 - Task 1.2: Dangling Flock Lock Cleanser";

interface HasCheck {
  has(targetPath: string): boolean;
}

let vfs: VirtualMemoryFS & HasCheck;
let session: VirtualFSSession | undefined;

function setupVirtualFs(): void {
  session?.cleanup();
  const memoryFs = new VirtualMemoryFS();
  vfs = Object.assign(memoryFs, {
    has: (targetPath: string) => vfs.existsSync(targetPath),
  });
  session = createVirtualFSSession(vfs);
}

afterEach(() => {
  session?.cleanup();
  session = undefined;
});

describe(lockCleanerSuiteName, () => {
  test("isProcessAlive accurately detects current process and non-existent PID", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(9999999)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
  });

  test("cleanseDanglingLocks clears lock files belonging to dead PIDs", () => {
    setupVirtualFs();
    const tempDir = "/virtual/lock-cleaner-test";
    const locksDir = join(tempDir, ".locks");
    vfs.mkdirSync(locksDir, { recursive: true });

    const deadPidLock = join(locksDir, "dead-process.lock");
    vfs.writeFileSync(
      deadPidLock,
      JSON.stringify({ pid: 9999999, created_at: new Date().toISOString() }),
    );

    const livePidLock = join(locksDir, "live-process.lock");
    vfs.writeFileSync(
      livePidLock,
      JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }),
    );

    const cleared = cleanseDanglingLocks({ repoRoot: tempDir, lockDirs: [".locks"] });

    expect(cleared.length).toBe(1);
    expect(cleared[0]).toContain("dead-process.lock");
    expect(vfs.has(deadPidLock)).toBe(false);
    expect(vfs.has(livePidLock)).toBe(true);
  });
});
