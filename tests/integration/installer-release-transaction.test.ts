import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  beginReleaseTransaction,
  recoverReleaseTransaction,
} from "../../orchestrating-long-tasks/scripts/src/installer/release-transaction.ts";
import { acquireInstallerLock } from "../../orchestrating-long-tasks/scripts/src/installer/installer-lock.ts";
import {
  createMarker,
  markerPath,
  MARKER_SCHEMA,
  readMarker,
  type TransactionMarker,
} from "../../orchestrating-long-tasks/scripts/src/installer/transaction-marker.ts";
import { cleanInstallerFixtures, installerFixture } from "../unit/installer/helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installer release transaction", () => {
  test("lifecycle: begin, update stages, finish", async () => {
    const { root: rawRoot } = await installerFixture();
    const root = await realpath(rawRoot);
    const lock = acquireInstallerLock(root);
    const dest = join(root, "dest");
    const uuid = randomUUID();
    const temporary = `${dest}.tmp-${uuid}`;
    const backup = `${dest}.old-${uuid}`;
    const backupQuarantine = `${dest}.delete-${uuid}`;
    const digest = "a".repeat(64);

    try {
      const tx = await beginReleaseTransaction(
        root,
        dest,
        temporary,
        backup,
        backupQuarantine,
        digest,
        null,
        lock,
      );

      const mPath = markerPath(root);
      let current = readMarker(mPath, dest);
      expect(current.stage).toBe("prepared");

      await tx.update("old-moved");
      current = readMarker(mPath, dest);
      expect(current.stage).toBe("old-moved");

      await tx.update("published");
      current = readMarker(mPath, dest);
      expect(current.stage).toBe("published");

      let beforeRemoveCalled = false;
      await tx.finish(async () => {
        beforeRemoveCalled = true;
      });

      expect(beforeRemoveCalled).toBe(true);
      expect(await lstat(mPath).catch(() => null)).toBeNull();

      // Double finish is no-op
      await tx.finish();
    } finally {
      lock.release();
    }
  });

  test("recovers dangling marker and removes marker file under lock", async () => {
    const { root: rawRoot } = await installerFixture();
    const root = await realpath(rawRoot);
    const lock = acquireInstallerLock(root);
    const dest = join(root, "dest");
    const mPath = markerPath(root);
    const uuid = randomUUID();

    const marker: TransactionMarker = {
      schema: MARKER_SCHEMA,
      pid: process.pid,
      lock_device: String(lock.identity.device),
      lock_inode: String(lock.identity.inode),
      destination: dest,
      temporary: `${dest}.tmp-${uuid}`,
      backup: `${dest}.old-${uuid}`,
      backup_quarantine: `${dest}.delete-${uuid}`,
      old_device: null,
      old_inode: null,
      source_sha256: "a".repeat(64),
      stage: "prepared",
    };

    createMarker(mPath, marker);
    expect(await lstat(mPath).catch(() => null)).not.toBeNull();

    try {
      await recoverReleaseTransaction(root, dest, lock);
      expect(await lstat(mPath).catch(() => null)).toBeNull();
    } finally {
      lock.release();
    }
  });

  test("recoverReleaseTransaction is a no-op when no marker exists", async () => {
    const { root: rawRoot } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");

    // Both with held lock and without
    await recoverReleaseTransaction(root, dest);

    const lock = acquireInstallerLock(root);
    try {
      await recoverReleaseTransaction(root, dest, lock);
    } finally {
      lock.release();
    }
  });

  test("recoverReleaseTransaction throws when marker is not a regular file", async () => {
    const { root: rawRoot } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const mPath = markerPath(root);

    await mkdir(mPath);
    await expect(recoverReleaseTransaction(root, dest)).rejects.toThrow(
      /installer transaction marker is not a regular file/,
    );
  });

  test("recoverReleaseTransaction throws when marker belongs to another parent inode", async () => {
    const { root: rawRoot } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const mPath = markerPath(root);
    const uuid = randomUUID();

    const marker: TransactionMarker = {
      schema: MARKER_SCHEMA,
      pid: process.pid,
      lock_device: "9999999",
      lock_inode: "8888888",
      destination: dest,
      temporary: `${dest}.tmp-${uuid}`,
      backup: `${dest}.old-${uuid}`,
      backup_quarantine: `${dest}.delete-${uuid}`,
      old_device: null,
      old_inode: null,
      source_sha256: "a".repeat(64),
      stage: "prepared",
    };

    createMarker(mPath, marker);

    await expect(recoverReleaseTransaction(root, dest)).rejects.toThrow(
      /installer transaction belongs to another parent inode/,
    );
  });
});
