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
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { guardedRemoveSync, smartEnsureSymlink } from "../../scripts/sync/fs-helpers.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

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

    guardedRemoveSync(victim, { allowedRoots: [root] });

    expect(existsSync(victim)).toBe(false);
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
