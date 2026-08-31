import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../olt/scripts/src/core/json.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { sealInstallationManifest } from "../../olt/scripts/src/installer/manifest-integrity.ts";
import { acquireInstallerLock } from "../../olt/scripts/src/installer/installer-lock.ts";
import { pathIdentity } from "../../olt/scripts/src/installer/path-safety.ts";
import {
  beginReleaseTransaction,
  recoverReleaseTransaction,
} from "../../olt/scripts/src/installer/release-transaction.ts";
import { SKILL_NAME } from "../../olt/scripts/src/installer/constants.ts";
import { treeDigest } from "../../olt/scripts/src/installer/tree-digest.ts";
import { validateSkillSource } from "../../olt/scripts/src/installer/source-validation.ts";
import { markerPath, readMarker } from "../../olt/scripts/src/installer/transaction-marker.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

async function makeRelease(sourceRoot: string, dir: string): Promise<string> {
  await cp(sourceRoot, dir, { recursive: true });
  const validated = await validateSkillSource(sourceRoot);
  const digest = await treeDigest(dir, new Set(["installation.json"]));
  const sealed = sealInstallationManifest({
    schema: "harness.installation",
    version: 1,
    skill_name: SKILL_NAME,
    runtime_version: validated.runtimeVersion,
    source_sha256: digest,
    installed_at: "2026-01-01T00:00:00.000Z",
    clients: [],
  });
  await writeFile(join(dir, "installation.json"), canonicalJsonBytes(sealed));
  return digest;
}

describe("recoverReleaseTransaction", () => {
  test("is a no-op when no marker is present, acquiring and releasing its own lock", async () => {
    const root = scratchRoot(import.meta.path, "no-marker");
    const parent = join(root, "parent");
    mkdirSync(parent);
    await expect(recoverReleaseTransaction(parent, join(parent, "dest"))).resolves.toBeUndefined();
    // The lock must have been released: acquiring it again should succeed immediately.
    const lock = acquireInstallerLock(parent);
    lock.release();
  });

  test("reuses a caller-held lock instead of acquiring or releasing its own", async () => {
    const root = scratchRoot(import.meta.path, "held-lock");
    const parent = join(root, "parent");
    mkdirSync(parent);
    const lock = acquireInstallerLock(parent);
    try {
      await expect(
        recoverReleaseTransaction(parent, join(parent, "dest"), lock),
      ).resolves.toBeUndefined();
      // The lock is still held by us: a second, independent acquire must fail.
      expect(() => acquireInstallerLock(parent)).toThrow(HarnessError);
    } finally {
      lock.release();
    }
  });

  test("throws when the marker path exists but is not a regular file", async () => {
    const root = scratchRoot(import.meta.path, "marker-not-file");
    const parent = join(root, "parent");
    mkdirSync(parent);
    mkdirSync(markerPath(parent));
    await expect(recoverReleaseTransaction(parent, join(parent, "dest"))).rejects.toBeInstanceOf(
      HarnessError,
    );
  });

  test("throws when the marker belongs to a different parent inode's lock", async () => {
    const root = scratchRoot(import.meta.path, "marker-wrong-owner");
    const parent = join(root, "parent");
    const otherParent = join(root, "other-parent");
    mkdirSync(parent);
    mkdirSync(otherParent);
    const otherLock = acquireInstallerLock(otherParent);
    const destination = join(parent, "dest");
    try {
      const transaction = await beginReleaseTransaction(
        otherParent,
        destination,
        join(parent, `dest.tmp-${randomUUID()}`),
        join(parent, `dest.old-${randomUUID()}`),
        join(parent, `dest.delete-${randomUUID()}`),
        "a".repeat(64),
        null,
        otherLock,
      );
      // Move the marker the transaction just wrote (against otherLock's identity) so it sits at
      // the path `parent`'s own transaction machinery would look for it.
      void transaction;
      await rename(markerPath(otherParent), markerPath(parent));

      await expect(recoverReleaseTransaction(parent, destination)).rejects.toThrow(
        /belongs to another parent inode/,
      );
    } finally {
      otherLock.release();
    }
  });

  test("recovers a real crashed transaction and removes the marker afterward", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "recovers-real");
    const parent = join(root, "parent");
    mkdirSync(parent);
    const destination = join(parent, "dest");
    const temporary = join(parent, `dest.tmp-${randomUUID()}`);
    const digest = await makeRelease(source, temporary);
    const lock = acquireInstallerLock(parent);
    const transaction = await beginReleaseTransaction(
      parent,
      destination,
      temporary,
      join(parent, `dest.old-${randomUUID()}`),
      join(parent, `dest.delete-${randomUUID()}`),
      digest,
      null,
      lock,
    );
    lock.release();
    void transaction;

    await recoverReleaseTransaction(parent, destination);

    expect(await pathIdentity(markerPath(parent))).toBeNull();
    expect(await pathIdentity(temporary)).toBeNull();
  });
});

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
    // update()'s inner try/catch specifically cleans up the orphaned `.update-<uuid>` replacement
    // file when replaceBoundPath() itself fails mid-swap. Reaching that exact window requires the
    // marker to still match its captured identity at the top of update() (so the swap is even
    // attempted) but then change before the swap completes — a TOCTOU race with no hook exposed
    // on ReleaseTransaction.update() to synchronize it deterministically. What we exercise instead
    // is the coarser, always-reachable case: marker identity already changed before update() runs
    // at all, so it fails at its very first assertPathIdentity() check, before any replacement
    // file is written — still real behavior worth pinning (update() must surface this, not swallow
    // it), just not the inner cleanup branch itself.
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

      // Custom stage whose serialization invokes getter and tampers with marker after assertPathIdentity passes
      const maliciousStage = {
        get stage() {
          rmSync(markerPath(parent));
          writeFileSync(markerPath(parent), "tampered content");
          return "published";
        },
      };

      // Type-safe cast via unknown
      await expect(transaction.update(maliciousStage as unknown as "published")).rejects.toThrow();

      const names = await readdir(parent);
      expect(names.some((name) => name.includes(".update-"))).toBe(false);
    } finally {
      lock.release();
    }
  });
});
