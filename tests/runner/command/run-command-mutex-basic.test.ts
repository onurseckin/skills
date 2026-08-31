import { describe, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  type Stats,
  writeFileSync,
} from "node:fs";
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

describe("run-command broad scope test detection and mutex basic lock", () => {
  test("keeps a persistent regular lock inode after a broad run releases it", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-broad-test");
    const lockFile = join(repo, ".olt", ".locks", "execution.lock");

    let ran = false;
    const fakeRunner = broadRunner(async () => {
      ran = true;
      expect(existsSync(lockFile)).toBe(true);
      return { record: { id: "C-1" } } as unknown as CommandResult;
    });

    await executePreparedCommand(broadPrepared(repo), fakeRunner);
    expect(ran).toBe(true);
    expect(lstatSync(lockFile).isFile()).toBe(true);
  });

  test("executePreparedCommand bypasses mutex for targeted file-scoped runs", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-targeted-test");
    const lockFile = join(repo, ".olt", ".locks", "execution.lock");

    let ran = false;
    const fakeRunner = broadRunner(async () => {
      ran = true;
      expect(existsSync(lockFile)).toBe(false);
      return { record: { id: "C-2" } } as unknown as CommandResult;
    });

    await executePreparedCommand(
      broadPrepared(repo, ["bun", "test", "src/foo.test.ts"]),
      fakeRunner,
    );
    expect(ran).toBe(true);
  });

  test("treats malformed stale PID text as irrelevant after flock acquisition", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-stale-pid");
    const lockDir = join(repo, ".olt", ".locks");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "execution.lock"), "not-a-pid", "utf-8");
    let ran = false;

    await executePreparedCommand(
      broadPrepared(repo),
      broadRunner(async () => {
        ran = true;
        return { record: { id: "stale" } } as unknown as CommandResult;
      }),
    );
    expect(ran).toBe(true);
  });

  test("refuses a final-component symlink without touching its target or running", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-symlink");
    const lockDir = join(repo, ".olt", ".locks");
    mkdirSync(lockDir, { recursive: true });
    const target = join(repo, "outside-lock-target");
    writeFileSync(target, "sentinel", "utf-8");
    symlinkSync(target, join(lockDir, "execution.lock"));

    let ran = false;
    await expect(
      executePreparedCommand(
        broadPrepared(repo),
        broadRunner(async () => {
          ran = true;
          return { record: { id: "symlink" } } as unknown as CommandResult;
        }),
      ),
    ).rejects.toMatchObject({ code: "PATH_SAFETY" });
    expect(ran).toBe(false);
    expect(readFileSync(target, "utf-8")).toBe("sentinel");
  });

  test("fails closed for a wrong-kind lock node and injected unreadable lock open", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-wrong-kind");
    const lockFile = join(repo, ".olt", ".locks", "execution.lock");
    mkdirSync(lockFile, { recursive: true });
    let ran = false;
    await expect(
      executePreparedCommand(
        broadPrepared(repo),
        broadRunner(async () => {
          ran = true;
          return { record: { id: "wrong-kind" } } as unknown as CommandResult;
        }),
      ),
    ).rejects.toMatchObject({ code: "PATH_SAFETY" });
    expect(ran).toBe(false);

    const unreadableRepo = scratchRoot(import.meta.path, "mutex-unreadable");
    const restore = setExecutionLockDependenciesForTesting({
      openLockFile() {
        const denied = Object.assign(new Error("denied"), { code: "EACCES" });
        throw denied;
      },
    });
    try {
      await expect(
        executePreparedCommand(
          broadPrepared(unreadableRepo),
          broadRunner(async () => {
            ran = true;
            return { record: { id: "unreadable" } } as unknown as CommandResult;
          }),
        ),
      ).rejects.toMatchObject({ code: "INTEGRITY" });
    } finally {
      restore();
    }
    expect(ran).toBe(false);
  });

  test("releases after runner failure so a later broad run can acquire the same inode", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-runner-failure");
    await expect(
      executePreparedCommand(
        broadPrepared(repo),
        broadRunner(async () => {
          throw new Error("runner failed");
        }),
      ),
    ).rejects.toThrow("runner failed");
    let laterRan = false;
    await executePreparedCommand(
      broadPrepared(repo),
      broadRunner(async () => {
        laterRan = true;
        return { record: { id: "later" } } as unknown as CommandResult;
      }),
    );
    expect(laterRan).toBe(true);
  });

  test("preserves an undefined runner failure when cleanup also fails", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-undefined-runner-failure");
    const restore = setExecutionLockDependenciesForTesting({
      releaseFlock(descriptor) {
        releaseNativeFlock(descriptor);
        throw new Error("release failed");
      },
      close(descriptor) {
        closeSync(descriptor);
        throw new Error("close failed");
      },
    });
    let caught: unknown = Symbol("not-run");
    try {
      await executePreparedCommand(
        broadPrepared(repo),
        broadRunner(async () => {
          throw undefined;
        }),
      );
    } catch (error) {
      caught = error;
    } finally {
      restore();
    }
    expect(caught).toBeUndefined();
  });
});
