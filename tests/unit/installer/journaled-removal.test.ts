import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { removeJournaledPath } from "../../../orchestrating-long-tasks/scripts/src/installer/journaled-removal.ts";
import { pathIdentity } from "../../../orchestrating-long-tasks/scripts/src/installer/path-safety.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("removeJournaledPath", () => {
  test("is a no-op when the path is already gone", async () => {
    const root = scratchRoot(import.meta.path, "already-gone");
    const target = join(root, "missing");
    const bogusExpected = { device: 0n, inode: 0n, kind: "directory" as const };
    await expect(removeJournaledPath(target, bogusExpected, "test path")).resolves.toBeUndefined();
  });

  test("removes a directory tree matching the expected identity and syncs the parent", async () => {
    const root = scratchRoot(import.meta.path, "removes-tree");
    const target = join(root, "victim");
    mkdirSync(target);
    writeFileSync(join(target, "child.txt"), "content");
    const expected = await pathIdentity(target);
    if (!expected) throw new Error("expected identity to resolve for a directory that exists");
    await removeJournaledPath(target, expected, "test path");
    expect(existsSync(target)).toBe(false);
  });

  test("throws when the path identity no longer matches what the caller expected", async () => {
    const root = scratchRoot(import.meta.path, "identity-mismatch");
    const target = join(root, "victim");
    mkdirSync(target);
    const wrongExpected = { device: 999999n, inode: 999999n, kind: "directory" as const };
    await expect(removeJournaledPath(target, wrongExpected, "test path")).rejects.toBeInstanceOf(
      HarnessError,
    );
    expect(existsSync(target)).toBe(true);
  });

  test("throws when a symlink now sits where the caller expected a real directory", async () => {
    const root = scratchRoot(import.meta.path, "symlink-instead");
    const target = join(root, "victim");
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, target);
    const expectedDirectory = { device: 0n, inode: 0n, kind: "directory" as const };
    await expect(
      removeJournaledPath(target, expectedDirectory, "test path"),
    ).rejects.toBeInstanceOf(HarnessError);
    expect(existsSync(target)).toBe(true);
  });
});
