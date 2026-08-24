import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TestLockData {
  readonly pid: number;
  readonly scope: "broad" | "targeted";
  readonly args: readonly string[];
  readonly startedAt: string;
}

const LOCK_DIR = ".olt/.locks";
const BROAD_LOCK_FILE = join(LOCK_DIR, "broad-test.lock");

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireTestLock(isBroadScope: boolean, args: readonly string[]): () => void {
  if (!isBroadScope) {
    return () => {}; // Targeted runs do not require global broad lock
  }

  mkdirSync(LOCK_DIR, { recursive: true });

  if (existsSync(BROAD_LOCK_FILE)) {
    let lock: TestLockData | undefined;
    try {
      const raw = readFileSync(BROAD_LOCK_FILE, "utf-8");
      lock = JSON.parse(raw) as TestLockData;
    } catch {
      // Corrupt lock file, reclaim
      try {
        unlinkSync(BROAD_LOCK_FILE);
      } catch {}
    }

    if (lock) {
      if (isProcessAlive(lock.pid)) {
        console.error(
          `\x1b[31m[LOCKED_TEST_RUNNER]\x1b[0m A major test run is already active!\n` +
            `  PID: ${lock.pid}\n` +
            `  Scope: ${lock.args.join(" ")}\n` +
            `  Started: ${lock.startedAt}\n` +
            `\x1b[33mDuplicate execution blocked to prevent resource starvation. Wait for current run to finish or kill PID ${lock.pid}.\x1b[0m`,
        );
        process.exit(1);
      } else {
        // Reclaim stale lock
        try {
          unlinkSync(BROAD_LOCK_FILE);
        } catch {}
      }
    }
  }

  const lockData: TestLockData = {
    pid: process.pid,
    scope: "broad",
    args,
    startedAt: new Date().toISOString(),
  };

  writeFileSync(BROAD_LOCK_FILE, JSON.stringify(lockData, null, 2));

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (existsSync(BROAD_LOCK_FILE)) {
        const raw = readFileSync(BROAD_LOCK_FILE, "utf-8");
        const data = JSON.parse(raw) as TestLockData;
        if (data.pid === process.pid) {
          unlinkSync(BROAD_LOCK_FILE);
        }
      }
    } catch {}
  };

  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    release();
    process.exit(143);
  });
  process.on("uncaughtException", (err) => {
    release();
    console.error(err);
    process.exit(1);
  });

  return release;
}
