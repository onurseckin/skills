import { describe, expect, test } from "bun:test";
import { closeSync, mkdirSync, type Stats } from "node:fs";
import { join } from "node:path";
import { releaseFlock as releaseNativeFlock } from "../../../olt/scripts/src/platform/index.ts";
import {
  executePreparedCommand,
  setExecutionLockDependenciesForTesting,
} from "../../../olt/scripts/src/engine/runner/models/execution/run-command.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";
import type { InternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import type {
  CommandResult,
  PreparedCommand,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";

function broadPrepared(repo: string, argv: readonly string[] = ["bun", "test"]): PreparedCommand {
  return {
    commandRoot: "root",
    options: {
      runRoot: repo,
      repositoryRoot: repo,
      argv,
    } as unknown as PreparedCommand["options"],
  };
}

function broadRunner(onExecute: () => Promise<CommandResult>): InternalCommandRunner {
  return {
    prepareCommand: async () => ({}) as PreparedCommand,
    executePreparedCommand: onExecute,
  };
}

function syntheticStats(kind: "directory" | "file", inode: number): Stats {
  return {
    dev: 1,
    ino: inode,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => false,
  } as unknown as Stats;
}

function enoent(): Error & { code: string } {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

describe("run-command broad scope mutex advanced behavior", () => {
  test("surfaces release and close failures even when they throw undefined", async () => {
    for (const failingCleanup of ["release", "close"] as const) {
      const repo = scratchRoot(import.meta.path, `mutex-${failingCleanup}-undefined`);
      let closeAttempts = 0;
      const restore = setExecutionLockDependenciesForTesting({
        releaseFlock(descriptor) {
          releaseNativeFlock(descriptor);
          if (failingCleanup === "release") throw undefined;
        },
        close(descriptor) {
          closeAttempts += 1;
          closeSync(descriptor);
          if (failingCleanup === "close") throw undefined;
        },
      });
      try {
        await expect(
          executePreparedCommand(
            broadPrepared(repo),
            broadRunner(
              async () => ({ record: { id: failingCleanup } }) as unknown as CommandResult,
            ),
          ),
        ).rejects.toMatchObject({ code: "INTEGRITY" });
      } finally {
        restore();
      }
      expect(closeAttempts).toBe(2);
    }
  });

  test("fails closed after lock-directory replacement only after repository authority is held", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-lock-directory-replacement");
    const lockDir = join(repo, ".olt", ".locks");
    const lockFile = join(lockDir, "execution.lock");
    const events: string[] = [];
    let lockDirectoryReads = 0;
    const restore = setExecutionLockDependenciesForTesting({
      mkdirLockDirectory() {
        events.push("mkdir-lock-directory");
      },
      lstat(path) {
        if (path === repo) return syntheticStats("directory", 1);
        if (path === lockFile) throw enoent();
        if (path === lockDir) {
          lockDirectoryReads += 1;
          return syntheticStats("directory", lockDirectoryReads === 1 ? 2 : 3);
        }
        throw new Error(`unexpected lstat path: ${path}`);
      },
      openRepositoryRoot() {
        events.push("open-repository-root");
        return 71;
      },
      openLockFile() {
        events.push("open-lock-file");
        return 72;
      },
      fstat(descriptor) {
        return syntheticStats(descriptor === 71 ? "directory" : "file", descriptor === 71 ? 1 : 72);
      },
      tryExclusiveFlock(descriptor) {
        events.push(`flock-${descriptor}`);
        return true;
      },
      releaseFlock(descriptor) {
        events.push(`release-${descriptor}`);
      },
      close(descriptor) {
        events.push(`close-${descriptor}`);
      },
    });
    let ran = false;
    try {
      await expect(
        executePreparedCommand(
          broadPrepared(repo),
          broadRunner(async () => {
            ran = true;
            return { record: { id: "replacement" } } as unknown as CommandResult;
          }),
        ),
      ).rejects.toMatchObject({ code: "INTEGRITY" });
    } finally {
      restore();
    }
    expect(ran).toBe(false);
    expect(events.indexOf("flock-71")).toBeLessThan(events.indexOf("mkdir-lock-directory"));
    expect(events).toContain("release-71");
    expect(events).toContain("close-72");
    expect(events).toContain("close-71");
  });

  test("identity-binds the opened repository root before touching its lock directory", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-repository-identity-replacement");
    const lockDir = join(repo, ".olt", ".locks");
    const lockFile = join(lockDir, "execution.lock");
    const events: string[] = [];
    const restore = setExecutionLockDependenciesForTesting({
      mkdirLockDirectory() {
        events.push("mkdir-lock-directory");
      },
      lstat(path) {
        if (path === repo) return syntheticStats("directory", 1);
        if (path === lockDir) return syntheticStats("directory", 3);
        if (path === lockFile) throw enoent();
        throw new Error(`unexpected lstat path: ${path}`);
      },
      openRepositoryRoot: () => 101,
      openLockFile: () => 102,
      fstat(descriptor) {
        return syntheticStats(
          descriptor === 101 ? "directory" : "file",
          descriptor === 101 ? 2 : 4,
        );
      },
      tryExclusiveFlock: () => true,
      close(descriptor) {
        events.push(`close-${descriptor}`);
      },
    });
    let ran = false;
    try {
      await expect(
        executePreparedCommand(
          broadPrepared(repo),
          broadRunner(async () => {
            ran = true;
            return { record: { id: "root-identity" } } as unknown as CommandResult;
          }),
        ),
      ).rejects.toMatchObject({ code: "INTEGRITY" });
    } finally {
      restore();
    }
    expect(ran).toBe(false);
    expect(events).not.toContain("mkdir-lock-directory");
    expect(events).toEqual(["close-101"]);
  });

  test("keeps a same-repository normalized path alias mutually exclusive", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-path-alias");
    let allowFirstToFinish!: () => void;
    const firstMayFinish = new Promise<void>((resolveFirst) => {
      allowFirstToFinish = resolveFirst;
    });
    let enteredFirst!: () => void;
    const firstEntered = new Promise<void>((resolveEntered) => {
      enteredFirst = resolveEntered;
    });
    const first = executePreparedCommand(
      broadPrepared(repo),
      broadRunner(async () => {
        enteredFirst();
        await firstMayFinish;
        return { record: { id: "first" } } as unknown as CommandResult;
      }),
    );
    await firstEntered;
    await expect(
      executePreparedCommand(
        broadPrepared(join(repo, ".")),
        broadRunner(async () => ({ record: { id: "second" } }) as unknown as CommandResult),
      ),
    ).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
    allowFirstToFinish();
    await first;
  });

  test("cleans every opened descriptor on fstat and flock acquisition errors", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-acquisition-cleanup");
    const lockDir = join(repo, ".olt", ".locks");
    const lockFile = join(lockDir, "execution.lock");
    const lstat = (path: string): Stats => {
      if (path === repo || path === lockDir) return syntheticStats("directory", 1);
      if (path === lockFile) throw enoent();
      throw new Error(`unexpected lstat path: ${path}`);
    };

    const rootCloseCalls: number[] = [];
    const restoreRoot = setExecutionLockDependenciesForTesting({
      mkdirLockDirectory() {},
      lstat,
      openRepositoryRoot: () => 81,
      fstat() {
        throw new Error("root fstat failed");
      },
      close(descriptor) {
        rootCloseCalls.push(descriptor);
      },
    });
    try {
      await expect(
        executePreparedCommand(
          broadPrepared(repo),
          broadRunner(async () => ({}) as CommandResult),
        ),
      ).rejects.toMatchObject({ code: "INTEGRITY" });
    } finally {
      restoreRoot();
    }
    expect(rootCloseCalls).toEqual([81]);

    const flockReleaseCalls: number[] = [];
    const flockCloseCalls: number[] = [];
    const restoreFlock = setExecutionLockDependenciesForTesting({
      mkdirLockDirectory() {},
      lstat,
      openRepositoryRoot: () => 91,
      openLockFile: () => 92,
      fstat(descriptor) {
        return syntheticStats(descriptor === 91 ? "directory" : "file", descriptor === 91 ? 1 : 92);
      },
      tryExclusiveFlock(descriptor) {
        if (descriptor === 92) throw new Error("file flock failed");
        return true;
      },
      releaseFlock(descriptor) {
        flockReleaseCalls.push(descriptor);
      },
      close(descriptor) {
        flockCloseCalls.push(descriptor);
      },
    });
    try {
      await expect(
        executePreparedCommand(
          broadPrepared(repo),
          broadRunner(async () => ({}) as CommandResult),
        ),
      ).rejects.toMatchObject({ code: "INTEGRITY" });
    } finally {
      restoreFlock();
    }
    expect(flockReleaseCalls).toEqual([91]);
    expect(flockCloseCalls).toEqual([92, 91]);
  });
});
