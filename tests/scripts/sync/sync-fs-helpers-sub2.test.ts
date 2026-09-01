import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
  FALLBACK_MARKER,
  guardedRemoveSync,
  logDestructiveOp,
  smartEnsureSymlink,
} from "../../../scripts/sync/fs-helpers.ts";
import { cleanupVirtualSyncFS, scratchRoot, setupVirtualSyncFS } from "../../sync/sync-fixture.ts";

beforeEach(() => {
  setupVirtualSyncFS();
});
afterEach(() => {
  cleanupVirtualSyncFS();
});

function initRealGitRepoAt(dirPath: string): void {
  mkdirSync(join(dirPath, ".git"), { recursive: true });
  writeFileSync(join(dirPath, "precious.txt"), "do-not-delete-me\n", "utf-8");
}

function setupAssistantRoots(testName: string) {
  const root = scratchRoot(import.meta.path, testName);
  const assistantDir = join(root, "assistant-skills");
  const targetOlt = join(root, "olt-deployment");
  mkdirSync(assistantDir, { recursive: true });
  mkdirSync(targetOlt, { recursive: true });
  return { root, assistantDir, targetOlt, linkPath: join(assistantDir, "olt") };
}

describe("logDestructiveOp", () => {
test("refuses when the link path falls outside the declared allowed roots", () => {
    const { root, assistantDir, targetOlt } = setupAssistantRoots("symlink-outside-root");
    const otherDir = join(root, "unrelated-dir");
    mkdirSync(otherDir, { recursive: true });

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
    guardedRemoveSync(victim, { allowedRoots: [root], onAudit: (e) => audits.push(e) });
    expect(existsSync(victim)).toBe(false);
    expect(audits.length).toBeGreaterThan(0);
  });

test("is a no-op by default when the target is already missing", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-missing");
    expect(() =>
      guardedRemoveSync(join(root, "never-existed"), { allowedRoots: [root] }),
    ).not.toThrow();
  });

test("refuses to delete a directory containing a .git entry without an explicit override", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-git-repo");
    const repoDir = join(root, "some-repo");
    initRealGitRepoAt(repoDir);
    expect(() => guardedRemoveSync(repoDir, { allowedRoots: [root] })).toThrow(HarnessError);
    expect(existsSync(repoDir)).toBe(true);
    expect(existsSync(join(repoDir, ".git"))).toBe(true);
  });

test("allows deleting git repo when allowGitRepositoryDeletion is true", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-git-repo-override");
    const repoDir = join(root, "removable-repo");
    initRealGitRepoAt(repoDir);
    guardedRemoveSync(repoDir, { allowedRoots: [root], allowGitRepositoryDeletion: true });
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
