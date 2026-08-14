import { ensureSafeDirectory, assertPathIdentity } from "./path-safety.ts";
import { moveBoundPath, removeBoundPath } from "./bound-mutations.ts";
import { removeJournaledPath } from "./journaled-removal.ts";
import { recoveryErrors } from "./recovery-errors.ts";
import type { InstallerLock } from "./installer-lock.ts";
import type { PathIdentity } from "./path-safety.ts";
import type { ReleaseTransaction } from "./release-transaction.ts";
import type { PreparedRelease, ReleaseCopyHooks } from "./release-copy.ts";

export interface ReleaseState {
  containmentRoot: string;
  parent: string;
  parentIdentity: PathIdentity;
  destination: string;
  temporary: string;
  backup: string;
  backupQuarantine: string;
  existingIdentity: PathIdentity | null;
  temporaryIdentity: PathIdentity | null;
  publishedIdentity: PathIdentity | null;
  transaction: ReleaseTransaction;
  lock: InstallerLock;
  lockHeld: boolean;
  committed: boolean;
  oldMoved: boolean;
  irreversible: boolean;
}

export function preparedRelease(state: ReleaseState, hooks: ReleaseCopyHooks): PreparedRelease {
  return {
    async commit() {
      await ensureSafeDirectory(state.containmentRoot, state.parent, false);
      await assertPathIdentity(state.parent, state.parentIdentity, "installation parent");
      await assertPathIdentity(
        state.destination,
        state.existingIdentity,
        "installation destination",
      );
      if (state.existingIdentity) {
        await state.transaction.update("old-move-intent");
        hooks.observe?.("journal-old-move-intent");
        await hooks.beforeOldMove?.();
        await moveBoundPath(
          state.destination,
          state.backup,
          state.existingIdentity,
          "installed release",
        );
        state.oldMoved = true;
        hooks.observe?.("old-rename-synced");
        await hooks.afterOldMoveBeforeJournal?.();
        await state.transaction.update("old-moved");
        hooks.observe?.("journal-old-moved");
        await hooks.afterOldMoved?.();
      }
      await state.transaction.update("publish-intent");
      hooks.observe?.("journal-publish-intent");
      await hooks.beforePublish?.();
      await moveBoundPath(
        state.temporary,
        state.destination,
        state.temporaryIdentity!,
        "staged installation",
      );
      state.publishedIdentity = state.temporaryIdentity;
      state.temporaryIdentity = null;
      state.committed = true;
      hooks.observe?.("publish-rename-synced");
      await hooks.afterPublishBeforeJournal?.();
      await state.transaction.update("published");
      hooks.observe?.("journal-published");
      await hooks.afterPublished?.();
    },
    async rollback() {
      if (state.irreversible) return;
      const errors = await recoveryErrors([
        async () => {
          if (!state.committed) return;
          await hooks.beforeRollbackRemove?.();
          await removeBoundPath(
            state.destination,
            state.publishedIdentity!,
            "published installation",
          );
          state.committed = false;
        },
        async () => {
          if (!state.oldMoved) return;
          await hooks.beforeRollbackRestore?.();
          await moveBoundPath(
            state.backup,
            state.destination,
            state.existingIdentity!,
            "installation backup",
          );
          state.oldMoved = false;
        },
      ]);
      if (errors.length > 0) throw new AggregateError(errors, "release rollback failed");
      await state.transaction.finish();
    },
    async finalize() {
      if (state.oldMoved) {
        await state.transaction.update("backup-delete-intent");
        hooks.observe?.("journal-backup-delete-intent");
        await hooks.beforeFinalizeBackup?.();
        await moveBoundPath(
          state.backup,
          state.backupQuarantine,
          state.existingIdentity!,
          "installation backup quarantine",
        );
        state.oldMoved = false;
        state.irreversible = true;
        hooks.observe?.("backup-quarantine-synced");
        await hooks.afterBackupQuarantinedBeforeJournal?.();
        await state.transaction.update("backup-quarantined");
        hooks.observe?.("journal-backup-quarantined");
        await removeJournaledPath(
          state.backupQuarantine,
          state.existingIdentity!,
          "installation backup quarantine",
        );
        hooks.observe?.("backup-delete-synced");
        await hooks.afterBackupDeletedBeforeJournal?.();
      }
      state.irreversible = true;
      await state.transaction.update("committed");
      hooks.observe?.("journal-committed");
      await state.transaction.finish(hooks.beforeMarkerFinish);
      hooks.observe?.("marker-delete-synced");
    },
    async cleanup() {
      const errors = await recoveryErrors([
        async () => {
          await hooks.beforeCleanupTemporary?.();
          if (state.temporaryIdentity) {
            await removeBoundPath(state.temporary, state.temporaryIdentity, "staged installation");
            state.temporaryIdentity = null;
          }
        },
        async () => {
          if (!state.committed && !state.oldMoved) await state.transaction.finish();
        },
        async () => {
          if (!state.lockHeld) return;
          state.lock.release();
          state.lockHeld = false;
        },
      ]);
      if (errors.length > 0) throw new AggregateError(errors, "release cleanup failed");
    },
  };
}
