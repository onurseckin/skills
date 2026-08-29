import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { canonicalJsonBytes } from "../core/json.ts";
import { HarnessError } from "../core/errors/index.ts";
import { removeBoundPath } from "./bound-mutations.ts";
import { syncTree } from "./durable-tree.ts";
import { identifiedInstallation } from "./identity.ts";
import { acquireInstallerLock } from "./installer-lock.ts";
import { sealInstallationManifest } from "./manifest-integrity.ts";
import { ensureSafeDirectory, pathIdentity, type PathIdentity } from "./path-safety.ts";
import { assertInstallerPlatform } from "./platform.ts";
import { preparedRelease, type ReleaseState } from "./release-actions.ts";
import { combinedFailure, recoveryErrors } from "./recovery-errors.ts";
import { beginReleaseTransaction, recoverReleaseTransaction } from "./release-transaction.ts";
import { validateSkillSource } from "./source-validation.ts";

export { INSTALL_SCHEMA } from "./constants.ts";

export interface PreparedRelease {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  finalize(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface ReleaseCopyOptions {
  containmentRoot?: string;
  platform?: NodeJS.Platform;
  hooks?: ReleaseCopyHooks;
}

export interface ReleaseCopyHooks {
  beforeSourceRecheck?(): Promise<void> | void;
  beforeOldMove?(): Promise<void> | void;
  afterOldMoveBeforeJournal?(): Promise<void> | void;
  afterOldMoved?(): Promise<void> | void;
  beforePublish?(): Promise<void> | void;
  afterPublishBeforeJournal?(): Promise<void> | void;
  afterPublished?(): Promise<void> | void;
  beforeRollbackRemove?(): Promise<void> | void;
  beforeRollbackRestore?(): Promise<void> | void;
  beforeFinalizeBackup?(): Promise<void> | void;
  afterBackupQuarantinedBeforeJournal?(): Promise<void> | void;
  afterBackupDeletedBeforeJournal?(): Promise<void> | void;
  beforeMarkerFinish?(): Promise<void> | void;
  beforeCleanupTemporary?(): Promise<void> | void;
  observe?(step: string): void;
}

function assertExpectedManifest(
  manifest: Record<string, unknown>,
  digest: string,
  runtimeVersion: string,
): void {
  if (manifest.source_sha256 !== digest || manifest.runtime_version !== runtimeVersion) {
    throw new HarnessError(
      "INTEGRITY",
      "staged release digest or runtime does not match its manifest",
    );
  }
}

export async function prepareReleaseCopy(
  source: string,
  requestedDestination: string,
  manifest: Record<string, unknown>,
  options: ReleaseCopyOptions = {},
): Promise<PreparedRelease> {
  assertInstallerPlatform(options.platform);
  const requestedParent = dirname(requestedDestination);
  if (options.containmentRoot === undefined) await mkdir(requestedParent, { recursive: true });
  const parent = await realpath(requestedParent);
  const destination = join(parent, basename(requestedDestination));
  const containmentRoot = options.containmentRoot ?? parent;
  await ensureSafeDirectory(containmentRoot, parent);
  const parentIdentity = await pathIdentity(parent);
  const lock = acquireInstallerLock(parent);
  const hooks = options.hooks ?? {};
  const temporary = `${destination}.tmp-${randomUUID()}`;
  const backup = `${destination}.old-${randomUUID()}`;
  const backupQuarantine = `${destination}.delete-${randomUUID()}`;
  let temporaryIdentity: PathIdentity | null = null;
  let existingIdentity: PathIdentity | null = null;
  let lockHeld = true;
  try {
    await recoverReleaseTransaction(parent, destination, lock);
    const existing = await lstat(destination).catch(() => null);
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw new HarnessError("INVALID_STATE", `refusing to replace unrelated path: ${destination}`);
    }
    if (existing && !(await identifiedInstallation(destination))) {
      throw new HarnessError("INVALID_STATE", `refusing to replace unrelated path: ${destination}`);
    }
    existingIdentity = await pathIdentity(destination);
    const sealed = sealInstallationManifest(manifest);
    await cp(source, temporary, { recursive: true, errorOnExist: true, force: false });
    const staged = await validateSkillSource(temporary);
    const current = await validateSkillSource(source, {
      ...(hooks.beforeSourceRecheck === undefined
        ? {}
        : { beforeSnapshotRecheck: hooks.beforeSourceRecheck }),
    });
    assertExpectedManifest(sealed, staged.digest, staged.runtimeVersion);
    assertExpectedManifest(sealed, current.digest, current.runtimeVersion);
    await writeFile(join(temporary, "installation.json"), canonicalJsonBytes(sealed), {
      flag: "wx",
      mode: 0o444,
    });
    syncTree(temporary);
    hooks.observe?.("staged-tree-synced");
    temporaryIdentity = await pathIdentity(temporary);
    const transaction = await beginReleaseTransaction(
      parent,
      destination,
      temporary,
      backup,
      backupQuarantine,
      staged.digest,
      existingIdentity,
      lock,
    );
    const state: ReleaseState = {
      containmentRoot,
      parent,
      parentIdentity: parentIdentity!,
      destination,
      temporary,
      backup,
      backupQuarantine,
      existingIdentity,
      temporaryIdentity,
      publishedIdentity: null,
      transaction,
      lock,
      lockHeld,
      committed: false,
      oldMoved: false,
      irreversible: false,
    };
    return preparedRelease(state, hooks);
  } catch (error) {
    const recovery = await recoveryErrors([
      async () => {
        if (temporaryIdentity)
          await removeBoundPath(temporary, temporaryIdentity, "staged installation");
      },
      async () => {
        if (lockHeld) {
          lock.release();
          lockHeld = false;
        }
      },
    ]);
    throw combinedFailure(error, recovery, "release preparation and cleanup failed");
  }
}

export async function atomicReleaseCopy(
  source: string,
  destination: string,
  manifest: Record<string, unknown>,
  options: ReleaseCopyOptions = {},
): Promise<void> {
  const release = await prepareReleaseCopy(source, destination, manifest, options);
  let failure: unknown;
  try {
    await release.commit();
    await release.finalize();
  } catch (error) {
    failure = combinedFailure(
      error,
      await recoveryErrors([() => release.rollback()]),
      "release publication and rollback failed",
    );
  }
  const cleanup = await recoveryErrors([() => release.cleanup()]);
  if (failure !== undefined) throw combinedFailure(failure, cleanup, "release cleanup failed");
  if (cleanup.length > 0) throw new AggregateError(cleanup, "release cleanup failed");
}
