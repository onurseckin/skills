import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, rm } from "node:fs/promises";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { acquireInstallerLock } from "../../../olt/scripts/src/installer/installer-lock.ts";
import { pathIdentity } from "../../../olt/scripts/src/installer/path-safety.ts";
import { beginReleaseTransaction } from "../../../olt/scripts/src/installer/release-transaction.ts";
import { markerPath, readMarker } from "../../../olt/scripts/src/installer/transaction-marker.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";
import { cleanupVirtualInstallerFS, setupVirtualInstallerFS } from "../helpers.ts";

beforeEach(setupVirtualInstallerFS);
afterEach(cleanupVirtualInstallerFS);

describe("beginReleaseTransaction", () => {
  test("writes a marker readable back with the expected fields", async () => {
    const root = scratchRoot(import.meta.path, "writes-marker");
    const parent = join(root, "parent");
    mkdirSync(parent);
    const destination = join(parent, "dest");
    const lock = acquireInstallerLock(parent);
    try {
      await beginReleaseTransaction(
        parent,
        destination,
        join(parent, `dest.tmp-${randomUUID()}`),
        join(parent, `dest.old-${randomUUID()}`),
        join(parent, `dest.delete-${randomUUID()}`),
        "b".repeat(64),
        null,
        lock,
      );
      const marker = readMarker(markerPath(parent), destination);
      expect(marker.stage).toBe("prepared");
      expect(marker.source_sha256).toBe("b".repeat(64));
      expect(marker.old_device).toBeNull();
    } finally {
      lock.release();
    }
  });

  test("records old_device/old_inode when an old identity is provided", async () => {
    const root = scratchRoot(import.meta.path, "records-old-identity");
    const parent = join(root, "parent");
    mkdirSync(parent);
    const destination = join(parent, "dest");
    const lock = acquireInstallerLock(parent);
    try {
      await beginReleaseTransaction(
        parent,
        destination,
        join(parent, `dest.tmp-${randomUUID()}`),
        join(parent, `dest.old-${randomUUID()}`),
        join(parent, `dest.delete-${randomUUID()}`),
        "c".repeat(64),
        { device: 7n, inode: 8n, kind: "directory" },
        lock,
      );
      const marker = readMarker(markerPath(parent), destination);
      expect(marker.old_device).toBe("7");
      expect(marker.old_inode).toBe("8");
    } finally {
      lock.release();
    }
  });

  test("update() rewrites the marker's stage atomically", async () => {
    const root = scratchRoot(import.meta.path, "update-stage");
    const parent = join(root, "parent");
    mkdirSync(parent);
    const destination = join(parent, "dest");
    const lock = acquireInstallerLock(parent);
    try {
      const transaction = await beginReleaseTransaction(
        parent,
        destination,
        join(parent, `dest.tmp-${randomUUID()}`),
        join(parent, `dest.old-${randomUUID()}`),
        join(parent, `dest.delete-${randomUUID()}`),
        "d".repeat(64),
        null,
        lock,
      );
      await transaction.update("old-move-intent");
      expect(readMarker(markerPath(parent), destination).stage).toBe("old-move-intent");
      await transaction.update("published");
      expect(readMarker(markerPath(parent), destination).stage).toBe("published");
    } finally {
      lock.release();
    }
  });

  test("finish() removes the marker and is idempotent on a second call", async () => {
    const root = scratchRoot(import.meta.path, "finish-idempotent");
    const parent = join(root, "parent");
    mkdirSync(parent);
    const destination = join(parent, "dest");
    const lock = acquireInstallerLock(parent);
    try {
      const transaction = await beginReleaseTransaction(
        parent,
        destination,
        join(parent, `dest.tmp-${randomUUID()}`),
        join(parent, `dest.old-${randomUUID()}`),
        join(parent, `dest.delete-${randomUUID()}`),
        "e".repeat(64),
        null,
        lock,
      );
      await transaction.finish();
      expect(await pathIdentity(markerPath(parent))).toBeNull();
      await expect(transaction.finish()).resolves.toBeUndefined();
    } finally {
      lock.release();
    }
  });

  test("finish() calls beforeRemove before deleting the marker", async () => {
    const root = scratchRoot(import.meta.path, "finish-hook");
    const parent = join(root, "parent");
    mkdirSync(parent);
    const destination = join(parent, "dest");
    const lock = acquireInstallerLock(parent);
    try {
      const transaction = await beginReleaseTransaction(
        parent,
        destination,
        join(parent, `dest.tmp-${randomUUID()}`),
        join(parent, `dest.old-${randomUUID()}`),
        join(parent, `dest.delete-${randomUUID()}`),
        "f".repeat(64),
        null,
        lock,
      );
      let calledBeforeRemove = false;
      await transaction.finish(() => {
        calledBeforeRemove = true;
        expect(pathIdentity(markerPath(parent))).resolves.not.toBeNull();
      });
      expect(calledBeforeRemove).toBe(true);
    } finally {
      lock.release();
    }
  });

  test("update() propagates the failure when the marker changed identity before the swap could even start", async () => {
    const root = scratchRoot(import.meta.path, "update-identity-changed");
    const parent = join(root, "parent");
    mkdirSync(parent);
    const destination = join(parent, "dest");
    const lock = acquireInstallerLock(parent);
    try {
      const transaction = await beginReleaseTransaction(
        parent,
        destination,
        join(parent, `dest.tmp-${randomUUID()}`),
        join(parent, `dest.old-${randomUUID()}`),
        join(parent, `dest.delete-${randomUUID()}`),
        "0".repeat(64),
        null,
        lock,
      );
      await rm(markerPath(parent));
      await mkdir(markerPath(parent));

      await expect(transaction.update("published")).rejects.toThrow(HarnessError);

      const names = await readdir(parent);
      expect(names.some((name) => name.includes(".update-"))).toBe(false);
    } finally {
      lock.release();
    }
  });

  test("update() inner catch cleans up replacement marker when replaceBoundPath fails", async () => {
    const root = scratchRoot(import.meta.path, "update-inner-catch-cleanup");
    const parent = join(root, "parent");
    mkdirSync(parent);
    const destination = join(parent, "dest");
    const lock = acquireInstallerLock(parent);
    try {
      const transaction = await beginReleaseTransaction(
        parent,
        destination,
        join(parent, `dest.tmp-${randomUUID()}`),
        join(parent, `dest.old-${randomUUID()}`),
        join(parent, `dest.delete-${randomUUID()}`),
        "0".repeat(64),
        null,
        lock,
      );

      const maliciousStage = {
        get stage() {
          rmSync(markerPath(parent));
          writeFileSync(markerPath(parent), "tampered content");
          return "published";
        },
      };

      await expect(transaction.update(maliciousStage as unknown as "published")).rejects.toThrow();

      const names = await readdir(parent);
      expect(names.some((name) => name.includes(".update-"))).toBe(false);
    } finally {
      lock.release();
    }
  });
});
