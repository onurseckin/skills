import { afterEach, describe, expect, test } from "bun:test";
import {
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { createRepositoryGitCommand } from "../../../../olt/scripts/src/packets/repository-git-command.ts";
import { preflightRepositoryGitMetadata } from "../../../../olt/scripts/src/packets/repository-git-metadata.ts";
import {
  readRepositoryGitControlFile,
  type RepositoryGitFileHooks,
} from "../../../../olt/scripts/src/packets/repository-git-safe-file.ts";

const roots: string[] = [];
const environment = { PATH: "/usr/bin:/bin" };

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "repository-git-availability-"));
  roots.push(root);
  mkdirSync(join(root, ".git"));
  return realpathSync(root);
}

function special(path: string): Stats {
  return {
    ...lstatSync(path),
    isDirectory: () => false,
    isFile: () => false,
    isSymbolicLink: () => false,
  } as Stats;
}

describe("repository Git availability controls", () => {
  test("rejects special controls before open and uses nonblocking no-follow opens", () => {
    const repo = repository();
    const config = join(repo, ".git", "config");
    writeFileSync(config, "[core]\n");
    let opens = 0;
    const hostile: RepositoryGitFileHooks = {
      lstatPath: (path) => (path === config ? special(path) : lstatSync(path)),
      openFile: () => {
        opens += 1;
        throw new Error("special control reached open");
      },
    };
    expect(() => readRepositoryGitControlFile(config, "config", 1024, hostile)).toThrow(
      /not a regular file/i,
    );
    expect(opens).toBe(0);

    let flags = 0;
    readRepositoryGitControlFile(config, "config", 1024, {
      openFile: (path, value) => {
        flags = value;
        return openSync(path, value);
      },
    });
    expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);

    expect(() =>
      readRepositoryGitControlFile(config, "config", 1024, {
        openFile: (path, value) => {
          unlinkSync(path);
          mkdirSync(path);
          return openSync(path, value);
        },
      }),
    ).toThrow(/changed during scan/i);
  });

  test("preflights ordinary controls before the shared Git spawn", () => {
    const repo = repository();
    const config = join(repo, ".git", "config");
    writeFileSync(config, "[core]\n");
    let spawned = false;
    const command = createRepositoryGitCommand(
      environment,
      () => {
        spawned = true;
        return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
      {
        preflight: (path) =>
          preflightRepositoryGitMetadata(path, {
            lstatPath: (candidate) =>
              candidate === config ? special(candidate) : lstatSync(candidate),
          }),
      },
    );
    let caught: unknown;
    try {
      command(repo, ["status"], 1024);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    expect((caught as HarnessError).code).toBe("INTEGRITY");
    expect((caught as HarnessError).message).toMatch(/not a regular file/i);
    expect(spawned).toBeFalse();
  });

  test("preflights linked-worktree pointers and controls with bounded safe reads", () => {
    const root = mkdtempSync(join(tmpdir(), "repository-linked-preflight-"));
    roots.push(root);
    mkdirSync(join(root, "worktree"), { recursive: true });
    mkdirSync(join(root, "metadata", "worktrees", "linked"), { recursive: true });
    mkdirSync(join(root, "metadata", "info"), { recursive: true });
    const repo = realpathSync(join(root, "worktree"));
    const gitDir = realpathSync(join(root, "metadata", "worktrees", "linked"));
    const commonDir = realpathSync(join(root, "metadata"));
    writeFileSync(join(repo, ".git"), `gitdir: ${gitDir}\n`);
    writeFileSync(join(gitDir, "commondir"), "../..\n");
    writeFileSync(join(gitDir, "gitdir"), `${join(repo, ".git")}\n`);
    writeFileSync(join(commonDir, "config"), "[core]\n");
    const opens: Array<{ path: string; flags: number }> = [];
    expect(
      preflightRepositoryGitMetadata(repo, {
        openFile: (path, flags) => {
          opens.push({ path, flags });
          return openSync(path, flags);
        },
      }),
    ).toBeTrue();
    expect(opens.map(({ path }) => path)).toContain(join(repo, ".git"));
    expect(opens.map(({ path }) => path)).toContain(join(gitDir, "commondir"));
    expect(opens.map(({ path }) => path)).toContain(join(commonDir, "config"));
    expect(opens.every(({ flags }) => (flags & constants.O_NONBLOCK) !== 0)).toBeTrue();
  });

  test("rejects a special linked-worktree pointer before opening it", () => {
    const root = mkdtempSync(join(tmpdir(), "repository-linked-special-"));
    roots.push(root);
    mkdirSync(join(root, "worktree"));
    mkdirSync(join(root, "metadata"));
    const repo = realpathSync(join(root, "worktree"));
    const gitDir = realpathSync(join(root, "metadata"));
    const pointer = join(repo, ".git");
    writeFileSync(pointer, `gitdir: ${gitDir}\n`);
    let opened = false;
    expect(() =>
      preflightRepositoryGitMetadata(repo, {
        lstatPath: (path) => (path === pointer ? special(path) : lstatSync(path)),
        openFile: () => {
          opened = true;
          throw new Error("special linked pointer reached open");
        },
      }),
    ).toThrow(/invalid/i);
    expect(opened).toBeFalse();
  });

  test("rejects a linked-worktree pointer file whose bytes are not valid UTF-8", () => {
    const root = mkdtempSync(join(tmpdir(), "repository-linked-badutf8-"));
    roots.push(root);
    mkdirSync(join(root, "worktree"));
    mkdirSync(join(root, "metadata"));
    const repo = realpathSync(join(root, "worktree"));
    const gitDir = realpathSync(join(root, "metadata"));
    const pointer = join(repo, ".git");
    writeFileSync(
      pointer,
      Buffer.concat([
        Buffer.from(`gitdir: ${gitDir}`),
        Buffer.from([0x80, 0x81]),
        Buffer.from("\n"),
      ]),
    );
    expect(() => preflightRepositoryGitMetadata(repo)).toThrow(/worktree Git file is not UTF-8/i);
  });

  test("uses a finite timeout and reports timeout as operational invalid state", () => {
    const repo = repository();
    const calls: string[] = [];
    let options: { timeout?: number; killSignal?: string } = {};
    const timeout = Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT" });
    const command = createRepositoryGitCommand(
      environment,
      (_executable, _argv, value) => {
        calls.push("spawn");
        options = value;
        return { status: null, stdout: null, stderr: null, error: timeout };
      },
      {
        preflight: () => {
          calls.push("preflight");
          return true;
        },
      },
    );
    let caught: unknown;
    try {
      command(repo, ["status"], 1024);
    } catch (error) {
      caught = error;
    }
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.killSignal).toBe("SIGKILL");
    expect(options).not.toHaveProperty("detached");
    expect(calls).toEqual(["preflight", "spawn"]);
    expect(caught).toBeInstanceOf(HarnessError);
    expect((caught as HarnessError).code).toBe("INVALID_STATE");
    expect((caught as HarnessError).message).toBe("repository Git command timed out");
  });

  test("re-throws non-ENOENT errors during metadata inspection", () => {
    const repo = repository();
    const eacces = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    expect(() =>
      preflightRepositoryGitMetadata(repo, {
        lstatPath: () => {
          throw eacces;
        },
      }),
    ).toThrow("Permission denied");
  });
});
