import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import {
  acquireMutexLock,
  setExecutionLockDependenciesForTesting,
} from "../../../olt/scripts/src/engine/runner/models/execution/run-command.ts";
import { activeExecutionRootInodes } from "../../../olt/scripts/src/engine/runner/models/execution/run-command-lock-deps.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { Stats } from "node:fs";
import { cleanupVirtualEngineFS, getVirtualEngineFS, setupVirtualEngineFS } from "../fixture.ts";

describe("engine/runner/models/execution/run-command.ts - Mutex Locking", () => {
  let tempDir: string;
  let restoreDeps: (() => void) | undefined;
  let restoreLockDeps: (() => void) | undefined;

  beforeEach(() => {
    setupVirtualEngineFS();
    restoreLockDeps = setExecutionLockDependenciesForTesting({
      lstat: (p) => fs.lstatSync(p),
      fstat: (fd) => fs.fstatSync(fd),
      openRepositoryRoot: (p, flags) => fs.openSync(p, flags),
      openLockFile: (p, flags, mode) => fs.openSync(p, flags, mode),
      mkdirLockDirectory: (p, opts) => fs.mkdirSync(p, opts),
      close: (fd) => fs.closeSync(fd),
    });
    tempDir = "/virtual/run-cmd-mutex";
    const vfs = getVirtualEngineFS();
    vfs.mkdirSync(tempDir, { recursive: true });
    vfs.mkdirSync(join(tempDir, ".olt", ".locks"), { recursive: true });
  });

  afterEach(() => {
    if (restoreDeps) {
      restoreDeps();
      restoreDeps = undefined;
    }
    if (restoreLockDeps) {
      restoreLockDeps();
      restoreLockDeps = undefined;
    }
    cleanupVirtualEngineFS();
  });

  it("returns noop callback for non-broad scope commands", () => {
    const cleanup = acquireMutexLock(tempDir, ["echo", "test"]);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("throws LOCK_TIMEOUT when lock is already active in current process", () => {
    const cleanup1 = acquireMutexLock(tempDir, ["bun", "test"]);
    expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    cleanup1();
  });

  it("throws LOCK_TIMEOUT when repository execution authority is already active in process", () => {
    const realRootStat = fs.statSync(tempDir);
    const rootInode = `${realRootStat.dev}:${realRootStat.ino}`;
    activeExecutionRootInodes.add(rootInode);

    try {
      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    } finally {
      activeExecutionRootInodes.delete(rootInode);
    }
  });

  it("handles double-release cleanly without error", () => {
    const cleanup = acquireMutexLock(tempDir, ["bun", "test"]);
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });

  it("throws and cleans up when root directory tryExclusiveFlock returns false", () => {
    restoreDeps = setExecutionLockDependenciesForTesting({
      tryExclusiveFlock: () => false,
    });

    expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
  });

  it("throws and cleans up when lock file tryExclusiveFlock returns false", () => {
    let callCount = 0;
    restoreDeps = setExecutionLockDependenciesForTesting({
      tryExclusiveFlock: () => {
        callCount++;
        return callCount === 1;
      },
    });

    expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
  });

  it("throws when repository root is not a real directory", () => {
    restoreDeps = setExecutionLockDependenciesForTesting({
      lstat: () =>
        ({
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
          dev: 1,
          ino: 1,
        }) as unknown as Stats,
    });

    expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
  });

  it("throws when opened repository root fstat reports non-directory", () => {
    restoreDeps = setExecutionLockDependenciesForTesting({
      fstat: () =>
        ({
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
          dev: 1,
          ino: 1,
        }) as unknown as Stats,
    });

    expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
  });

  it("throws when directory identity shifts between checks (symlink race simulation)", () => {
    let fstatCount = 0;
    restoreDeps = setExecutionLockDependenciesForTesting({
      fstat: () => {
        fstatCount++;
        return {
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
          dev: 999,
          ino: fstatCount,
        } as unknown as Stats;
      },
    });

    expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
  });

  it("throws when repositoryAfter identity differs from opened repository root", () => {
    let lstatCount = 0;
    restoreDeps = setExecutionLockDependenciesForTesting({
      lstat: () => {
        lstatCount++;
        return {
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
          dev: 1,
          ino: lstatCount === 2 ? 9999 : 1,
        } as unknown as Stats;
      },
      fstat: () =>
        ({
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
          dev: 1,
          ino: 1,
        }) as unknown as Stats,
    });

    expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
  });

  it("throws and translates error when lock release fails on descriptor or root", () => {
    let releaseCount = 0;
    restoreDeps = setExecutionLockDependenciesForTesting({
      releaseFlock: () => {
        releaseCount++;
        if (releaseCount === 2) {
          throw new Error("Root flock release failure simulation");
        }
      },
    });

    const cleanup = acquireMutexLock(tempDir, ["bun", "test"]);
    expect(() => cleanup()).toThrow(HarnessError);
  });

  it("throws when root close fails during release", () => {
    let closeCount = 0;
    restoreDeps = setExecutionLockDependenciesForTesting({
      close: () => {
        closeCount++;
        if (closeCount === 2) {
          throw new Error("Root close failure simulation");
        }
      },
    });

    const cleanup = acquireMutexLock(tempDir, ["bun", "test"]);
    expect(() => cleanup()).toThrow(HarnessError);
  });

  it("throws when mkdirLockDirectory fails", () => {
    restoreDeps = setExecutionLockDependenciesForTesting({
      mkdirLockDirectory: () => {
        throw new Error("mkdir failure");
      },
    });

    expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
  });

  it("throws when opened lock file is not a regular file", () => {
    const realRootStat = fs.statSync(tempDir);
    let fstatCount = 0;
    restoreDeps = setExecutionLockDependenciesForTesting({
      fstat: () => {
        fstatCount++;
        if (fstatCount === 1) {
          return realRootStat;
        }
        return {
          isDirectory: () => false,
          isFile: () => false,
          isSymbolicLink: () => false,
          dev: realRootStat.dev,
          ino: 9999,
        } as unknown as Stats;
      },
    });

    expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
  });

  it("throws when lock directory identity changes while opening lock file", () => {
    const lockDir = resolve(join(tempDir, ".olt", ".locks"));
    const realLockDirStat = fs.statSync(lockDir);
    let lockDirLstatCount = 0;
    restoreDeps = setExecutionLockDependenciesForTesting({
      lstat: (path) => {
        if (resolve(path) === lockDir) {
          lockDirLstatCount++;
          if (lockDirLstatCount === 2) {
            const modified = Object.assign(
              Object.create(Object.getPrototypeOf(realLockDirStat)),
              realLockDirStat,
              { ino: realLockDirStat.ino + 999 },
            ) as Stats;
            return modified;
          }
        }
        return fs.statSync(path);
      },
    });

    expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
  });

  it("throws when close fails on lock descriptor during release", () => {
    restoreDeps = setExecutionLockDependenciesForTesting({
      close: () => {
        throw new Error("Close failure simulation");
      },
    });

    const cleanup = acquireMutexLock(tempDir, ["bun", "test"]);
    expect(() => cleanup()).toThrow(HarnessError);
  });
});
