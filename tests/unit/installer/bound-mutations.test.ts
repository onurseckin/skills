import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  moveBoundPath,
  removeBoundPath,
  replaceBoundPath,
} from "../../../olt/scripts/src/installer/bound-mutations.ts";
import { pathIdentity } from "../../../olt/scripts/src/installer/path-safety.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("moveBoundPath", () => {
  test("moves the path and calls beforeRename first", async () => {
    const root = scratchRoot(import.meta.path, "move-success");
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(source);
    writeFileSync(join(source, "file.txt"), "content");
    const expected = await pathIdentity(source);
    if (!expected) throw new Error("expected identity to resolve");
    let hookCalled = false;
    await moveBoundPath(source, destination, expected, "test move", {
      beforeRename() {
        hookCalled = true;
      },
    });
    expect(hookCalled).toBe(true);
    expect(readFileSync(join(destination, "file.txt"), "utf8")).toBe("content");
    expect(existsSync(source)).toBe(false);
  });

  test("restores the moved path and throws when the moved object's identity does not match what the caller expected", async () => {
    // beforeRename is the seam this module exposes specifically to make the race it defends
    // against (something else occupies `source` between the caller capturing `expected` and the
    // rename actually running) deterministically reproducible without a second real process.
    const root = scratchRoot(import.meta.path, "move-mismatch");
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(source);
    writeFileSync(join(source, "original.txt"), "original content");
    const staleExpected = await pathIdentity(source);
    if (!staleExpected) throw new Error("expected identity to resolve");

    await expect(
      moveBoundPath(source, destination, staleExpected, "test move", {
        beforeRename() {
          rmSync(source, { recursive: true });
          mkdirSync(source);
          writeFileSync(join(source, "impostor.txt"), "impostor content");
        },
      }),
    ).rejects.toBeInstanceOf(HarnessError);

    // The impostor should have been renamed back to `source`, and nothing left at `destination`.
    expect(existsSync(destination)).toBe(false);
    expect(readFileSync(join(source, "impostor.txt"), "utf8")).toBe("impostor content");
  });

  test("propagates a rejecting beforeRename hook without attempting the rename", async () => {
    const root = scratchRoot(import.meta.path, "move-hook-rejects");
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(source);
    const expected = await pathIdentity(source);
    if (!expected) throw new Error("expected identity to resolve");
    const failure = new Error("hook failed");
    await expect(
      moveBoundPath(source, destination, expected, "test move", {
        beforeRename() {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(destination)).toBe(false);
  });
});

describe("removeBoundPath", () => {
  test("quarantines and removes a matching path", async () => {
    const root = scratchRoot(import.meta.path, "remove-success");
    const target = join(root, "victim");
    mkdirSync(target);
    writeFileSync(join(target, "file.txt"), "content");
    const expected = await pathIdentity(target);
    if (!expected) throw new Error("expected identity to resolve");
    await removeBoundPath(target, expected, "test remove");
    expect(existsSync(target)).toBe(false);
  });

  test("propagates the identity-mismatch failure raised by the underlying move", async () => {
    const root = scratchRoot(import.meta.path, "remove-mismatch");
    const target = join(root, "victim");
    mkdirSync(target);
    const staleExpected = await pathIdentity(target);
    if (!staleExpected) throw new Error("expected identity to resolve");
    await expect(
      removeBoundPath(target, staleExpected, "test remove", {
        beforeRename() {
          rmSync(target, { recursive: true });
          mkdirSync(target);
        },
      }),
    ).rejects.toBeInstanceOf(HarnessError);
  });
});

describe("replaceBoundPath", () => {
  test("exchanges path with replacement and removes the superseded value", async () => {
    const root = scratchRoot(import.meta.path, "replace-success");
    const path = join(root, "path");
    const replacement = join(root, "replacement");
    mkdirSync(path);
    mkdirSync(replacement);
    writeFileSync(join(path, "file.txt"), "old content");
    writeFileSync(join(replacement, "file.txt"), "new content");
    const expected = await pathIdentity(path);
    const replacementIdentity = await pathIdentity(replacement);
    if (!expected || !replacementIdentity) throw new Error("expected identities to resolve");

    let hookCalled = false;
    await replaceBoundPath(path, expected, replacement, replacementIdentity, "test replace", {
      beforeExchange() {
        hookCalled = true;
      },
    });

    expect(hookCalled).toBe(true);
    expect(readFileSync(join(path, "file.txt"), "utf8")).toBe("new content");
    expect(existsSync(replacement)).toBe(false);
  });

  test("restores the exchange and throws when the post-exchange identities do not match", async () => {
    const root = scratchRoot(import.meta.path, "replace-mismatch");
    const path = join(root, "path");
    const replacement = join(root, "replacement");
    mkdirSync(path);
    mkdirSync(replacement);
    writeFileSync(join(path, "file.txt"), "old content");
    writeFileSync(join(replacement, "file.txt"), "new content");
    const staleExpected = await pathIdentity(path);
    const staleReplacementIdentity = await pathIdentity(replacement);
    if (!staleExpected || !staleReplacementIdentity)
      throw new Error("expected identities to resolve");

    await expect(
      replaceBoundPath(path, staleExpected, replacement, staleReplacementIdentity, "test replace", {
        beforeExchange() {
          rmSync(replacement, { recursive: true });
          mkdirSync(replacement);
          writeFileSync(join(replacement, "file.txt"), "impostor content");
        },
      }),
    ).rejects.toBeInstanceOf(HarnessError);

    // The exchange should have been fully restored: `path` still holds its original content and
    // `replacement` still holds the impostor content that was swapped in via the hook.
    expect(readFileSync(join(path, "file.txt"), "utf8")).toBe("old content");
    expect(readFileSync(join(replacement, "file.txt"), "utf8")).toBe("impostor content");
  });
});
