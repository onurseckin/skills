import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TestLockData {
  readonly pid: number;
  readonly scope: "broad" | "targeted";
  readonly args: readonly string[];
  readonly startedAt: string;
}

export interface LockStore {
  readonly isMemory: boolean;
  existsSync(path: string): boolean;
  readFileSync(path: string): string;
  writeFileSync(path: string, data: string): void;
  unlinkSync(path: string): void;
  mkdirSync(path: string): void;
}

export function createMemoryLockStore(initialFiles?: Record<string, string>): LockStore {
  const memory = new Map<string, string>(Object.entries(initialFiles ?? {}));
  return {
    isMemory: true,
    existsSync: (p: string) => memory.has(p),
    readFileSync: (p: string) => {
      const data = memory.get(p);
      if (data === undefined) throw new Error(`ENOENT: no such file: ${p}`);
      return data;
    },
    writeFileSync: (p: string, data: string) => {
      memory.set(p, data);
    },
    unlinkSync: (p: string) => {
      memory.delete(p);
    },
    mkdirSync: () => {},
  };
}

export const diskLockStore: LockStore = {
  isMemory: false,
  existsSync: (p: string) => existsSync(p),
  readFileSync: (p: string) => readFileSync(p, "utf-8"),
  writeFileSync: (p: string, data: string) => writeFileSync(p, data),
  unlinkSync: (p: string) => unlinkSync(p),
  mkdirSync: (p: string) => mkdirSync(p, { recursive: true }),
};

let activeStore: LockStore = diskLockStore;

export function setLockStore(store: LockStore): void {
  activeStore = store;
}

export function resetLockStore(): void {
  activeStore = diskLockStore;
}

export function getActiveLockStore(): LockStore {
  return activeStore;
}

export interface TestLockOptions {
  readonly store?: LockStore;
  readonly inMemory?: boolean;
  readonly lockDir?: string;
  readonly lockFile?: string;
  readonly skipSignalHandlers?: boolean;
}

const DEFAULT_LOCK_DIR = ".olt/.locks";
const DEFAULT_BROAD_LOCK_FILE = join(DEFAULT_LOCK_DIR, "broad-test.lock");

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireTestLock(
  isBroadScope: boolean,
  args: readonly string[],
  options?: TestLockOptions,
): () => void {
  if (!isBroadScope) {
    return () => {};
  }

  const store = options?.inMemory
    ? (options.store ?? createMemoryLockStore())
    : (options?.store ?? activeStore);

  const lockFile =
    options?.lockFile ??
    (options?.lockDir ? join(options.lockDir, "broad-test.lock") : DEFAULT_BROAD_LOCK_FILE);
  const lockDir = options?.lockDir ?? DEFAULT_LOCK_DIR;

  store.mkdirSync(lockDir);

  if (store.existsSync(lockFile)) {
    let lock: TestLockData | undefined;
    try {
      const raw = store.readFileSync(lockFile);
      lock = JSON.parse(raw) as TestLockData;
    } catch {
      try {
        store.unlinkSync(lockFile);
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
        try {
          store.unlinkSync(lockFile);
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

  store.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (store.existsSync(lockFile)) {
        const raw = store.readFileSync(lockFile);
        const data = JSON.parse(raw) as TestLockData;
        if (data.pid === process.pid) {
          store.unlinkSync(lockFile);
        }
      }
    } catch {}
  };

  if (!options?.skipSignalHandlers) {
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
  }

  return release;
}
