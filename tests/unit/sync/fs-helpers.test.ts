import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  guardedRemoveSync,
  logDestructiveOp,
  smartEnsureSymlink,
} from "../../../scripts/sync/fs-helpers.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

function initRealGitRepoAt(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
  writeFileSync(join(dirPath, "precious.txt"), "do-not-delete-me\n", "utf-8");
  git(["init", "--quiet", "--initial-branch", "main"], dirPath);
  git(["config", "user.email", "test@example.com"], dirPath);
  git(["config", "user.name", "Test"], dirPath);
  git(["add", "-A"], dirPath);
  git(["commit", "--quiet", "-m", "init"], dirPath);
}

describe("logDestructiveOp", () => {
  test("writes audit event JSON to stderr", () => {
    let captured = "";
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      logDestructiveOp({
        operation: "delete",
        requestedPath: "/tmp/foo",
        resolvedPath: "/tmp/foo",
        timestamp: "2026-08-30T00:00:00Z",
      });
      expect(captured).toContain("[sync-audit]");
      expect(captured).toContain('"requestedPath":"/tmp/foo"');
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});

describe("smartEnsureSymlink refuses to destroy a real directory", () => {
  test("a real git-repo directory at the link path throws and survives untouched", () => {
    const root = scratchRoot(import.meta.path, "symlink-vs-git-repo");
    const assistantDir = join(root, "assistant-skills");
    const targetOlt = join(root, "olt-deployment");
    mkdirSync(targetOlt, { recursive: true });
    writeFileSync(join(targetOlt, "SKILL.md"), "canonical\n", "utf-8");

    const linkPath = join(assistantDir, "olt");
    initRealGitRepoAt(linkPath);

    expect(() => smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] })).toThrow(
      HarnessError,
    );

    expect(existsSync(linkPath)).toBe(true);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(false);
    expect(lstatSync(linkPath).isDirectory()).toBe(true);
    expect(existsSync(join(linkPath, ".git"))).toBe(true);
    expect(readFileSync(join(linkPath, "precious.txt"), "utf-8")).toBe("do-not-delete-me\n");
  });

  test("a real plain directory (no .git) at the link path also throws and survives untouched", () => {
    const root = scratchRoot(import.meta.path, "symlink-vs-plain-dir");
    const assistantDir = join(root, "assistant-skills");
    const targetOlt = join(root, "olt-deployment");
    mkdirSync(targetOlt, { recursive: true });

    const linkPath = join(assistantDir, "olt");
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(linkPath, "keepme.txt"), "still-here\n", "utf-8");

    let caught: unknown;
    try {
      smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HarnessError);
    expect((caught as HarnessError).code).toBe("PATH_SAFETY");
    expect((caught as HarnessError).message).toContain(linkPath);
    expect(existsSync(linkPath)).toBe(true);
    expect(lstatSync(linkPath).isDirectory()).toBe(true);
    expect(readFileSync(join(linkPath, "keepme.txt"), "utf-8")).toBe("still-here\n");
  });

  test("a real file at the link path throws and survives untouched", () => {
    const root = scratchRoot(import.meta.path, "symlink-vs-plain-file");
    const assistantDir = join(root, "assistant-skills");
    mkdirSync(assistantDir, { recursive: true });
    const targetOlt = join(root, "olt-deployment");
    mkdirSync(targetOlt, { recursive: true });

    const linkPath = join(assistantDir, "olt");
    writeFileSync(linkPath, "not-a-symlink\n", "utf-8");

    expect(() => smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] })).toThrow(
      HarnessError,
    );
    expect(readFileSync(linkPath, "utf-8")).toBe("not-a-symlink\n");
  });

  test("throws when readExistingEntry encounters non-ENOENT error", () => {
    const root = scratchRoot(import.meta.path, "symlink-non-enoent");
    const linkPath = join(root, "test-entry");

    expect(() =>
      smartEnsureSymlink(join(root, "target"), linkPath, {
        allowedRoots: [root],
        fsDriver: {
          lstatSync: () => {
            const err = new Error("Permission denied") as NodeJS.ErrnoException;
            err.code = "EACCES";
            throw err;
          },
        },
      }),
    ).toThrow("Permission denied");
  });

  test("describeKind covers non-symlink non-file non-directory branch", () => {
    const root = scratchRoot(import.meta.path, "symlink-other-kind");
    const linkPath = join(root, "special-entry");

    const mockStats = {
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => false,
    } as unknown as Stats;

    let caught: unknown;
    try {
      smartEnsureSymlink(join(root, "target"), linkPath, {
        allowedRoots: [root],
        fsDriver: { lstatSync: () => mockStats },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    expect((caught as HarnessError).message).toContain("non-symlink filesystem entry");
  });
});

describe("smartEnsureSymlink normal operation", () => {
  test("creates a symlink where nothing existed before", () => {
    const root = scratchRoot(import.meta.path, "symlink-create");
    const assistantDir = join(root, "assistant-skills");
    mkdirSync(assistantDir, { recursive: true });
    const targetOlt = join(root, "olt-deployment");
    mkdirSync(targetOlt, { recursive: true });

    const linkPath = join(assistantDir, "olt");
    const status = smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] });

    expect(status).toBe("created");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe(targetOlt);
  });

  test("is idempotent when the symlink already points at target", () => {
    const root = scratchRoot(import.meta.path, "symlink-idempotent");
    const assistantDir = join(root, "assistant-skills");
    mkdirSync(assistantDir, { recursive: true });
    const targetOlt = join(root, "olt-deployment");
    mkdirSync(targetOlt, { recursive: true });

    const linkPath = join(assistantDir, "olt");
    symlinkSync(targetOlt, linkPath);

    const status = smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] });

    expect(status).toBe("skipped");
    expect(readlinkSync(linkPath)).toBe(targetOlt);
  });

  test("re-points a stale symlink that targets something else", () => {
    const root = scratchRoot(import.meta.path, "symlink-repoint");
    const assistantDir = join(root, "assistant-skills");
    mkdirSync(assistantDir, { recursive: true });
    const oldTarget = join(root, "old-olt-deployment");
    const newTarget = join(root, "new-olt-deployment");
    mkdirSync(oldTarget, { recursive: true });
    mkdirSync(newTarget, { recursive: true });

    const linkPath = join(assistantDir, "olt");
    symlinkSync(oldTarget, linkPath);

    const status = smartEnsureSymlink(newTarget, linkPath, { allowedRoots: [assistantDir] });

    expect(status).toBe("created");
    expect(readlinkSync(linkPath)).toBe(newTarget);
  });

  test("re-points a broken symlink where readlinkSync throws", () => {
    const root = scratchRoot(import.meta.path, "symlink-broken-readlink");
    const assistantDir = join(root, "assistant-skills");
    mkdirSync(assistantDir, { recursive: true });
    const newTarget = join(root, "new-olt-deployment");
    mkdirSync(newTarget, { recursive: true });

    const linkPath = join(assistantDir, "olt");
    symlinkSync(join(root, "non-existent-target"), linkPath);

    const status = smartEnsureSymlink(newTarget, linkPath, {
      allowedRoots: [assistantDir],
      fsDriver: {
        readlinkSync: () => {
          throw new Error("Broken link read error");
        },
      },
    });
    expect(status).toBe("created");
  });

  test("falls back to safeCpSync if symlinkSync throws", () => {
    const root = scratchRoot(import.meta.path, "symlink-fallback-cp");
    const assistantDir = join(root, "assistant-skills");
    mkdirSync(assistantDir, { recursive: true });
    const targetFile = join(root, "target.txt");
    writeFileSync(targetFile, "content-to-copy", "utf-8");

    const linkPath = join(assistantDir, "copied-file.txt");

    const status = smartEnsureSymlink(targetFile, linkPath, {
      allowedRoots: [assistantDir],
      fsDriver: {
        symlinkSync: () => {
          throw new Error("Operation not supported (cross-device or no symlink perms)");
        },
      },
    });
    expect(status).toBe("created");
    expect(existsSync(linkPath)).toBe(true);
    expect(readFileSync(linkPath, "utf-8")).toBe("content-to-copy");
  });

  test("refuses when the link path falls outside the declared allowed roots", () => {
    const root = scratchRoot(import.meta.path, "symlink-outside-root");
    const assistantDir = join(root, "assistant-skills");
    const otherDir = join(root, "unrelated-dir");
    mkdirSync(assistantDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    const targetOlt = join(root, "olt-deployment");
    mkdirSync(targetOlt, { recursive: true });

    const linkPath = join(otherDir, "olt");

    expect(() => smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] })).toThrow(
      HarnessError,
    );
    expect(existsSync(linkPath)).toBe(false);
  });
});

describe("guardedRemoveSync", () => {
  test("removes a plain file inside the allowed root", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-file");
    const victim = join(root, "nested", "victim.txt");
    mkdirSync(join(root, "nested"), { recursive: true });
    writeFileSync(victim, "gone-soon\n", "utf-8");

    const audits: unknown[] = [];
    guardedRemoveSync(victim, {
      allowedRoots: [root],
      onAudit: (e) => audits.push(e),
    });

    expect(existsSync(victim)).toBe(false);
    expect(audits.length).toBeGreaterThan(0);
  });

  test("is a no-op by default when the target is already missing", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-missing");
    const missing = join(root, "never-existed");

    expect(() => guardedRemoveSync(missing, { allowedRoots: [root] })).not.toThrow();
  });

  test("refuses to delete a directory containing a .git entry without an explicit override", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-git-repo");
    const repoDir = join(root, "some-repo");
    initRealGitRepoAt(repoDir);

    expect(() => guardedRemoveSync(repoDir, { allowedRoots: [root] })).toThrow(HarnessError);
    expect(existsSync(repoDir)).toBe(true);
    expect(existsSync(join(repoDir, ".git"))).toBe(true);
    expect(readFileSync(join(repoDir, "precious.txt"), "utf-8")).toBe("do-not-delete-me\n");
  });

  test("allows deleting git repo when allowGitRepositoryDeletion is true", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-git-repo-override");
    const repoDir = join(root, "removable-repo");
    initRealGitRepoAt(repoDir);

    guardedRemoveSync(repoDir, {
      allowedRoots: [root],
      allowGitRepositoryDeletion: true,
    });

    expect(existsSync(repoDir)).toBe(false);
  });

  test("refuses to delete outside the declared allowed roots even when the caller asks", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-outside-root");
    const allowedRoot = join(root, "allowed");
    const sibling = join(root, "sibling");
    mkdirSync(allowedRoot, { recursive: true });
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, "keep.txt"), "keep\n", "utf-8");

    expect(() => guardedRemoveSync(sibling, { allowedRoots: [allowedRoot] })).toThrow(HarnessError);
    expect(existsSync(join(sibling, "keep.txt"))).toBe(true);
  });
});
