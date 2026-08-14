import { fsyncDirectory } from "../core/durable-write.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { dirname } from "node:path";
import { moveBoundPath, removeBoundPath } from "./bound-mutations.ts";
import { identifiedInstallation, readInstallationManifest } from "./identity.ts";
import { removeJournaledPath } from "./journaled-removal.ts";
import { pathIdentity, sameIdentity, type PathIdentity } from "./path-safety.ts";
import type { TransactionMarker } from "./transaction-marker.ts";

async function requireRelease(path: string, digest?: string): Promise<PathIdentity | null> {
  const identity = await pathIdentity(path);
  if (!identity) return null;
  if (identity.kind !== "directory" || !(await identifiedInstallation(path)))
    throw new HarnessError(
      "INVALID_STATE",
      `transaction path is not an identified release: ${path}`,
    );
  if (digest && (await readInstallationManifest(path))?.source_sha256 !== digest)
    throw new HarnessError(
      "INVALID_STATE",
      `transaction release has an unexpected digest: ${path}`,
    );
  return identity;
}

async function removeRelease(
  path: string,
  identity: PathIdentity | null,
  label: string,
): Promise<void> {
  if (identity) await removeBoundPath(path, identity, label);
}

function publicationMayHaveRun(stage: TransactionMarker["stage"]): boolean {
  return [
    "publish-intent",
    "published",
    "backup-delete-intent",
    "backup-quarantined",
    "committed",
  ].includes(stage);
}

function oldIdentity(marker: TransactionMarker): PathIdentity | null {
  if (marker.old_device === null || marker.old_inode === null) return null;
  return {
    device: BigInt(marker.old_device),
    inode: BigInt(marker.old_inode),
    kind: "directory",
  };
}

async function requireQuarantine(
  marker: TransactionMarker,
  expected: PathIdentity | null,
): Promise<PathIdentity | null> {
  const current = await pathIdentity(marker.backup_quarantine);
  if (current && !sameIdentity(current, expected))
    throw new HarnessError("INVALID_STATE", "transaction backup quarantine changed identity");
  return current;
}

async function removeSuperseded(
  marker: TransactionMarker,
  backup: PathIdentity | null,
  quarantine: PathIdentity | null,
  expected: PathIdentity | null,
): Promise<void> {
  if (backup && quarantine)
    throw new HarnessError("INVALID_STATE", "transaction has both backup and quarantine paths");
  if ((backup || quarantine) && !expected)
    throw new HarnessError("INVALID_STATE", "transaction has an unexpected superseded release");
  if (backup) {
    if (!sameIdentity(backup, expected))
      throw new HarnessError("INVALID_STATE", "transaction backup changed identity");
    await moveBoundPath(
      marker.backup,
      marker.backup_quarantine,
      backup,
      "recovery backup quarantine",
    );
    quarantine = backup;
  }
  if (quarantine)
    await removeJournaledPath(marker.backup_quarantine, quarantine, "recovery backup quarantine");
}

export async function recoverReleasePaths(marker: TransactionMarker): Promise<void> {
  const temporary = await requireRelease(marker.temporary, marker.source_sha256);
  const backup = await requireRelease(marker.backup);
  const expectedOld = oldIdentity(marker);
  const quarantine = await requireQuarantine(marker, expectedOld);
  const destination = await requireRelease(marker.destination);
  const destinationIsNew =
    destination !== null &&
    (await readInstallationManifest(marker.destination))?.source_sha256 === marker.source_sha256;

  if (destinationIsNew && publicationMayHaveRun(marker.stage)) {
    await removeRelease(marker.temporary, temporary, "recovery staged release");
    await removeSuperseded(marker, backup, quarantine, expectedOld);
    fsyncDirectory(dirname(marker.destination));
    return;
  }
  if (!destination && backup && !quarantine) {
    await moveBoundPath(marker.backup, marker.destination, backup, "recovery backup");
    await removeRelease(marker.temporary, temporary, "recovery staged release");
    return;
  }
  if (!destination && !backup && !quarantine) {
    await removeRelease(marker.temporary, temporary, "recovery staged release");
    return;
  }
  if (quarantine)
    throw new HarnessError(
      "INVALID_STATE",
      "transaction lost its published release during deletion",
    );
  if (destination && backup)
    throw new HarnessError("INVALID_STATE", "transaction has both an old destination and backup");
  await removeRelease(marker.temporary, temporary, "recovery staged release");
}
