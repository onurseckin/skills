import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  assertPathIdentity,
  assertSafeAncestors,
  ensureSafeDirectory,
  pathIdentity,
  sameIdentity,
} from "../../../olt/scripts/src/installer/path-safety.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("pathIdentity", () => {
  test("returns null for a path that does not exist", async () => {
    const root = scratchRoot(import.meta.path, "missing");
    expect(await pathIdentity(join(root, "nope"))).toBeNull();
  });

  test("reports directory, file, and symlink kinds", async () => {
    const root = scratchRoot(import.meta.path, "kinds");
    const directory = join(root, "dir");
    const file = join(root, "file.txt");
    const link = join(root, "link");
    mkdirSync(directory);
    writeFileSync(file, "content");
    symlinkSync(directory, link);
    expect((await pathIdentity(directory))?.kind).toBe("directory");
    expect((await pathIdentity(file))?.kind).toBe("file");
    expect((await pathIdentity(link))?.kind).toBe("symlink");
  });

  test("propagates a non-ENOENT lstat failure instead of swallowing it", async () => {
    const root = scratchRoot(import.meta.path, "eacces-parent");
    const blocked = join(root, "blocked-dir");
    mkdirSync(blocked, { mode: 0o000 });
    try {
      await expect(pathIdentity(join(blocked, "child"))).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      chmodSync(blocked, 0o755);
    }
  });
});

describe("sameIdentity", () => {
  test("treats two nulls as the same identity", () => {
    expect(sameIdentity(null, null)).toBe(true);
  });

  test("treats a null next to a real identity as different", () => {
    expect(sameIdentity(null, { device: 1n, inode: 1n, kind: "file" })).toBe(false);
    expect(sameIdentity({ device: 1n, inode: 1n, kind: "file" }, null)).toBe(false);
  });

  test("compares device, inode, and kind for two real identities", () => {
    const base = { device: 1n, inode: 2n, kind: "file" as const };
    expect(sameIdentity(base, { device: 1n, inode: 2n, kind: "file" })).toBe(true);
    expect(sameIdentity(base, { device: 9n, inode: 2n, kind: "file" })).toBe(false);
    expect(sameIdentity(base, { device: 1n, inode: 9n, kind: "file" })).toBe(false);
    expect(sameIdentity(base, { device: 1n, inode: 2n, kind: "directory" })).toBe(false);
  });
});

describe("assertPathIdentity", () => {
  test("returns the current identity when it matches expectations", async () => {
    const root = scratchRoot(import.meta.path, "assert-match");
    const directory = join(root, "dir");
    mkdirSync(directory);
    const expected = await pathIdentity(directory);
    await expect(assertPathIdentity(directory, expected, "label")).resolves.toEqual(expected);
  });

  test("throws when the identity no longer matches", async () => {
    const root = scratchRoot(import.meta.path, "assert-mismatch");
    const directory = join(root, "dir");
    mkdirSync(directory);
    const bogus = { device: 0n, inode: 0n, kind: "directory" as const };
    await expect(assertPathIdentity(directory, bogus, "test label")).rejects.toThrow(HarnessError);
  });
});

describe("ensureSafeDirectory", () => {
  test("creates and verifies a nested directory chain beneath home", async () => {
    const root = scratchRoot(import.meta.path, "ensure-nested");
    const nested = join(root, "a", "b", "c");
    const identity = await ensureSafeDirectory(root, nested);
    expect(identity.kind).toBe("directory");
    expect((await pathIdentity(join(root, "a", "b")))?.kind).toBe("directory");
  });

  test("tolerates an already-existing directory in the chain", async () => {
    const root = scratchRoot(import.meta.path, "ensure-existing");
    mkdirSync(join(root, "a"));
    const identity = await ensureSafeDirectory(root, join(root, "a", "b"));
    expect(identity.kind).toBe("directory");
  });

  test("returns home's own identity when directory equals homeRoot", async () => {
    const root = scratchRoot(import.meta.path, "ensure-home-itself");
    const identity = await ensureSafeDirectory(root, root);
    expect(identity.kind).toBe("directory");
  });

  test("with create=false it verifies without creating missing directories", async () => {
    const root = scratchRoot(import.meta.path, "ensure-no-create");
    mkdirSync(join(root, "a"));
    await expect(ensureSafeDirectory(root, join(root, "a", "missing"), false)).rejects.toThrow(
      HarnessError,
    );
  });

  test("throws when the requested directory escapes homeRoot", async () => {
    const root = scratchRoot(import.meta.path, "ensure-escape");
    const outside = scratchRoot(import.meta.path, "ensure-escape-outside");
    await expect(ensureSafeDirectory(root, outside)).rejects.toThrow(HarnessError);
  });

  test("throws when homeRoot itself is not a real directory", async () => {
    const root = scratchRoot(import.meta.path, "ensure-bad-home");
    const notADirectory = join(root, "file.txt");
    writeFileSync(notADirectory, "x");
    await expect(ensureSafeDirectory(notADirectory, join(notADirectory, "child"))).rejects.toThrow(
      HarnessError,
    );
  });

  test("throws when an ancestor resolves outside homeRoot through a symlink", async () => {
    const root = scratchRoot(import.meta.path, "ensure-ancestor-symlink");
    const outside = scratchRoot(import.meta.path, "ensure-ancestor-symlink-outside");
    symlinkSync(outside, join(root, "escape"));
    await expect(ensureSafeDirectory(root, join(root, "escape", "child"), false)).rejects.toThrow(
      HarnessError,
    );
  });

  test("throws when homeRoot's own lexical path traverses a symlink ancestor and its realpath lands elsewhere", async () => {
    // Every ancestor verifyDirectory() checks along the way is itself a real directory (never a
    // symlink component as its OWN dirent), yet homeRoot's realpath still disagrees with its
    // lexical self because a directory further up homeRoot's own path is a symlink. lstat only
    // inspects the final path component, so this is the one shape that clears the "is this a real
    // directory" check and only then fails the "does it still resolve inside itself" check.
    const outsideBase = scratchRoot(import.meta.path, "ensure-home-escape-target");
    const actual = join(outsideBase, "actual");
    mkdirSync(actual);
    const linkParent = scratchRoot(import.meta.path, "ensure-home-escape-link-parent");
    symlinkSync(outsideBase, join(linkParent, "link"));
    const homeRoot = join(linkParent, "link", "actual");
    await expect(ensureSafeDirectory(homeRoot, join(homeRoot, "child"))).rejects.toThrow(
      HarnessError,
    );
    try {
      await ensureSafeDirectory(homeRoot, join(homeRoot, "child"));
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).message).toContain(
        "directory ancestor escapes validated home",
      );
    }
  });
});

describe("assertSafeAncestors", () => {
  test("returns without throwing once it reaches a missing ancestor", async () => {
    const root = scratchRoot(import.meta.path, "ancestors-missing");
    await expect(
      assertSafeAncestors(root, join(root, "does", "not", "exist")),
    ).resolves.toBeUndefined();
  });

  test("verifies every ancestor that does exist", async () => {
    const root = scratchRoot(import.meta.path, "ancestors-exist");
    mkdirSync(join(root, "a", "b"), { recursive: true });
    await expect(assertSafeAncestors(root, join(root, "a", "b", "c"))).resolves.toBeUndefined();
  });

  test("succeeds trivially when directory itself equals homeRoot", async () => {
    const root = scratchRoot(import.meta.path, "ancestors-home-itself");
    await expect(assertSafeAncestors(root, root)).resolves.toBeUndefined();
  });

  test("throws when the requested directory escapes homeRoot", async () => {
    const root = scratchRoot(import.meta.path, "ancestors-escape");
    const outside = scratchRoot(import.meta.path, "ancestors-escape-outside");
    await expect(assertSafeAncestors(root, outside)).rejects.toThrow(HarnessError);
  });

  test("throws when homeRoot itself is not a real directory", async () => {
    const root = scratchRoot(import.meta.path, "ancestors-bad-home");
    const notADirectory = join(root, "file.txt");
    writeFileSync(notADirectory, "x");
    await expect(assertSafeAncestors(notADirectory, join(notADirectory, "child"))).rejects.toThrow(
      HarnessError,
    );
  });

  test("throws when an existing ancestor resolves outside homeRoot through a symlink", async () => {
    const root = scratchRoot(import.meta.path, "ancestors-symlink");
    const outside = scratchRoot(import.meta.path, "ancestors-symlink-outside");
    symlinkSync(outside, join(root, "escape"));
    await expect(assertSafeAncestors(root, join(root, "escape", "child"))).rejects.toThrow(
      HarnessError,
    );
  });
});
