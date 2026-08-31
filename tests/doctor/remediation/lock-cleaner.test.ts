import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cleanseDanglingLocks,
  isProcessAlive,
} from "../../../olt/scripts/src/reporting/doctor/lock-cleaner.ts";

export const lockCleanerSuiteName = "Wave 1 - Task 1.2: Dangling Flock Lock Cleanser";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe(lockCleanerSuiteName, () => {
  test("isProcessAlive accurately detects current process and non-existent PID", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(9999999)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
  });

  test("cleanseDanglingLocks clears lock files belonging to dead PIDs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "lock-cleaner-test-"));
    roots.push(tempDir);

    const locksDir = join(tempDir, ".locks");
    await mkdir(locksDir, { recursive: true });

    const deadPidLock = join(locksDir, "dead-process.lock");
    writeFileSync(
      deadPidLock,
      JSON.stringify({ pid: 9999999, created_at: new Date().toISOString() }),
    );

    const livePidLock = join(locksDir, "live-process.lock");
    writeFileSync(
      livePidLock,
      JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }),
    );

    const cleared = cleanseDanglingLocks({ repoRoot: tempDir, lockDirs: [".locks"] });

    expect(cleared.length).toBe(1);
    expect(cleared[0]).toContain("dead-process.lock");
    expect(existsSync(deadPidLock)).toBe(false);
    expect(existsSync(livePidLock)).toBe(true);
  });
});
