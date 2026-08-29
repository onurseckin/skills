import { randomUUID } from "node:crypto";
import { HarnessError } from "../core/errors/index.ts";
import { removeBoundPath, replaceBoundPath } from "./bound-mutations.ts";
import { acquireInstallerLock, type InstallerLock } from "./installer-lock.ts";
import {
  assertPathIdentity,
  pathIdentity,
  sameIdentity,
  type PathIdentity,
} from "./path-safety.ts";
import { recoverReleasePaths } from "./release-recovery.ts";
import {
  createMarker,
  markerPath,
  MARKER_SCHEMA,
  readMarker,
  type TransactionMarker,
  type TransactionStage,
} from "./transaction-marker.ts";

export interface ReleaseTransaction {
  update(stage: TransactionStage): Promise<void>;
  finish(beforeRemove?: () => Promise<void> | void): Promise<void>;
}

function assertMarkerOwner(marker: TransactionMarker, lock: InstallerLock): void {
  if (
    marker.lock_device !== String(lock.identity.device) ||
    marker.lock_inode !== String(lock.identity.inode)
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      "installer transaction belongs to another parent inode",
    );
  }
}

async function recoverUnderLock(
  parent: string,
  destination: string,
  lock: InstallerLock,
): Promise<void> {
  const path = markerPath(parent);
  const identity = await pathIdentity(path);
  if (!identity) return;
  if (identity.kind !== "file")
    throw new HarnessError("INVALID_STATE", "installer transaction marker is not a regular file");
  const marker = readMarker(path, destination);
  await assertPathIdentity(path, identity, "installer transaction marker");
  assertMarkerOwner(marker, lock);
  await recoverReleasePaths(marker);
  await removeBoundPath(path, identity, "installer transaction marker");
}

export async function recoverReleaseTransaction(
  parent: string,
  destination: string,
  heldLock?: InstallerLock,
): Promise<void> {
  const lock = heldLock ?? acquireInstallerLock(parent);
  try {
    await recoverUnderLock(parent, destination, lock);
  } finally {
    if (!heldLock) lock.release();
  }
}

export async function beginReleaseTransaction(
  parent: string,
  destination: string,
  temporary: string,
  backup: string,
  backupQuarantine: string,
  sourceDigest: string,
  oldIdentity: PathIdentity | null,
  lock: InstallerLock,
): Promise<ReleaseTransaction> {
  const path = markerPath(parent);
  let marker: TransactionMarker = {
    schema: MARKER_SCHEMA,
    pid: process.pid,
    lock_device: String(lock.identity.device),
    lock_inode: String(lock.identity.inode),
    destination,
    temporary,
    backup,
    backup_quarantine: backupQuarantine,
    old_device: oldIdentity === null ? null : String(oldIdentity.device),
    old_inode: oldIdentity === null ? null : String(oldIdentity.inode),
    source_sha256: sourceDigest,
    stage: "prepared",
  };
  createMarker(path, marker);
  let identity: PathIdentity | null = await pathIdentity(path);
  return {
    async update(stage) {
      await assertPathIdentity(path, identity, "installer transaction marker");
      const next = { ...marker, stage };
      const replacement = `${path}.update-${randomUUID()}`;
      createMarker(replacement, next);
      const replacementIdentity = await pathIdentity(replacement);
      try {
        await replaceBoundPath(
          path,
          identity!,
          replacement,
          replacementIdentity!,
          "installer transaction marker",
        );
      } catch (error) {
        const remaining = await pathIdentity(replacement);
        if (sameIdentity(remaining, replacementIdentity))
          await removeBoundPath(
            replacement,
            replacementIdentity!,
            "replacement transaction marker",
          );
        throw error;
      }
      marker = next;
      identity = replacementIdentity;
    },
    async finish(beforeRemove) {
      if (identity === null) return;
      await beforeRemove?.();
      await removeBoundPath(path, identity, "installer transaction marker");
      identity = null;
    },
  };
}
