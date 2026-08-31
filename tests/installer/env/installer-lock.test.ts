import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { acquireInstallerLock } from "../../../olt/scripts/src/installer/installer-lock.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";

describe("acquireInstallerLock", () => {
  test("acquires and releases a lock on a real directory", () => {
    const root = scratchRoot(import.meta.path, "acquire-release");
    const lock = acquireInstallerLock(root);
    expect(lock.identity.kind).toBe("directory");
    expect(() => lock.release()).not.toThrow();
  });

  test("release is idempotent when called more than once", () => {
    const root = scratchRoot(import.meta.path, "release-twice");
    const lock = acquireInstallerLock(root);
    lock.release();
    expect(() => lock.release()).not.toThrow();
  });

  test("a second acquire on the same still-locked directory fails with LOCK_TIMEOUT", () => {
    const root = scratchRoot(import.meta.path, "contention");
    const held = acquireInstallerLock(root);
    try {
      expect(() => acquireInstallerLock(root)).toThrow(HarnessError);
      try {
        acquireInstallerLock(root);
        throw new Error("expected throw");
      } catch (error) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).code).toBe("LOCK_TIMEOUT");
      }
    } finally {
      held.release();
    }
  });

  test("acquiring again after release succeeds", () => {
    const root = scratchRoot(import.meta.path, "reacquire");
    const first = acquireInstallerLock(root);
    first.release();
    const second = acquireInstallerLock(root);
    expect(() => second.release()).not.toThrow();
  });

  test("throws when the parent path is not a directory", () => {
    const root = scratchRoot(import.meta.path, "not-a-directory");
    const file = join(root, "file.txt");
    writeFileSync(file, "x");
    expect(() => acquireInstallerLock(file)).toThrow(HarnessError);
  });

  test("throws when the parent path is a symlink to a directory, not a real directory", () => {
    const root = scratchRoot(import.meta.path, "symlink-parent");
    const real = join(root, "real");
    mkdirSync(real);
    const link = join(root, "link");
    symlinkSync(real, link);
    expect(() => acquireInstallerLock(link)).toThrow(HarnessError);
  });

  test("throws when the parent path does not exist", () => {
    const root = scratchRoot(import.meta.path, "missing-parent");
    expect(() => acquireInstallerLock(join(root, "nope"))).toThrow();
  });

  test("propagates a distinct PathIdentity per directory acquired", () => {
    const root = scratchRoot(import.meta.path, "distinct-identity");
    const first = join(root, "a");
    const second = join(root, "b");
    mkdirSync(first);
    mkdirSync(second);
    const lockA = acquireInstallerLock(first);
    const lockB = acquireInstallerLock(second);
    try {
      expect(lockA.identity.inode).not.toBe(lockB.identity.inode);
    } finally {
      lockA.release();
      lockB.release();
    }
  });
});
