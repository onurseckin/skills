import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InstallerLock } from "../../olt/scripts/src/installer/installer-lock.ts";
import { pathIdentity } from "../../olt/scripts/src/installer/path-safety.ts";
import {
  preparedRelease,
  type ReleaseState,
} from "../../olt/scripts/src/installer/release-actions.ts";
import type { ReleaseTransaction } from "../../olt/scripts/src/installer/release-transaction.ts";
import type { TransactionStage } from "../../olt/scripts/src/installer/transaction-marker.ts";
import type { ReleaseCopyHooks } from "../../olt/scripts/src/installer/release-copy.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

/** A transaction double: records every stage transition and finish() call without touching disk. */
function fakeTransaction() {
  const stages: TransactionStage[] = [];
  let finished = false;
  const transaction: ReleaseTransaction = {
    async update(stage) {
      stages.push(stage);
    },
    async finish(beforeRemove) {
      finished = true;
      await beforeRemove?.();
    },
  };
  return { transaction, stages, finished: () => finished };
}

function fakeLock(): { lock: InstallerLock; released: () => boolean } {
  let released = false;
  return {
    lock: {
      identity: { device: 1n, inode: 1n, kind: "directory" },
      release() {
        released = true;
      },
    },
    released: () => released,
  };
}

/** Builds a ReleaseState wired to real directories on disk, so bound-mutations' own identity
 * checks (which do real lstat calls) succeed exactly as they would in production. */
async function buildState(
  root: string,
  options: { withExisting: boolean },
): Promise<{
  state: ReleaseState;
  stages: TransactionStage[];
  finished: () => boolean;
  lockReleased: () => boolean;
}> {
  const parent = join(root, "parent");
  mkdirSync(parent);
  const destination = join(parent, "dest");
  const temporary = join(parent, "dest.tmp-1");
  const backup = join(parent, "dest.old-1");
  const backupQuarantine = join(parent, "dest.delete-1");

  mkdirSync(temporary);
  writeFileSync(join(temporary, "marker.txt"), "staged content");

  let existingIdentity = null;
  if (options.withExisting) {
    mkdirSync(destination);
    writeFileSync(join(destination, "marker.txt"), "old content");
    existingIdentity = await pathIdentity(destination);
  }

  const parentIdentity = await pathIdentity(parent);
  const temporaryIdentity = await pathIdentity(temporary);
  if (!parentIdentity || !temporaryIdentity) throw new Error("expected identities to resolve");

  const { transaction, stages, finished } = fakeTransaction();
  const { lock, released } = fakeLock();

  const state: ReleaseState = {
    containmentRoot: root,
    parent,
    parentIdentity,
    destination,
    temporary,
    backup,
    backupQuarantine,
    existingIdentity,
    temporaryIdentity,
    publishedIdentity: null,
    transaction,
    lock,
    lockHeld: true,
    committed: false,
    oldMoved: false,
    irreversible: false,
  };

  return { state, stages, finished, lockReleased: released };
}

describe("preparedRelease().commit()", () => {
  test("fresh install: publishes the staged release directly, no old-move stages", async () => {
    const root = scratchRoot(import.meta.path, "commit-fresh");
    const { state, stages } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.commit();
    expect(readFileSync(join(state.destination, "marker.txt"), "utf8")).toBe("staged content");
    expect(stages).toEqual(["publish-intent", "published"]);
    expect(state.committed).toBe(true);
    expect(state.oldMoved).toBe(false);
  });

  test("upgrade: moves the old release to backup before publishing the new one", async () => {
    const root = scratchRoot(import.meta.path, "commit-upgrade");
    const { state, stages } = await buildState(root, { withExisting: true });
    const release = preparedRelease(state, {});
    await release.commit();
    expect(readFileSync(join(state.destination, "marker.txt"), "utf8")).toBe("staged content");
    expect(readFileSync(join(state.backup, "marker.txt"), "utf8")).toBe("old content");
    expect(stages).toEqual(["old-move-intent", "old-moved", "publish-intent", "published"]);
    expect(state.oldMoved).toBe(true);
  });

  test("calls every documented hook and observe() checkpoint in order for an upgrade", async () => {
    const root = scratchRoot(import.meta.path, "commit-hooks");
    const { state } = await buildState(root, { withExisting: true });
    const calls: string[] = [];
    const hooks: ReleaseCopyHooks = {
      beforeOldMove() {
        calls.push("beforeOldMove");
      },
      afterOldMoveBeforeJournal() {
        calls.push("afterOldMoveBeforeJournal");
      },
      afterOldMoved() {
        calls.push("afterOldMoved");
      },
      beforePublish() {
        calls.push("beforePublish");
      },
      afterPublishBeforeJournal() {
        calls.push("afterPublishBeforeJournal");
      },
      afterPublished() {
        calls.push("afterPublished");
      },
      observe(step) {
        calls.push(`observe:${step}`);
      },
    };
    const release = preparedRelease(state, hooks);
    await release.commit();
    expect(calls).toEqual([
      "observe:journal-old-move-intent",
      "beforeOldMove",
      "observe:old-rename-synced",
      "afterOldMoveBeforeJournal",
      "observe:journal-old-moved",
      "afterOldMoved",
      "observe:journal-publish-intent",
      "beforePublish",
      "observe:publish-rename-synced",
      "afterPublishBeforeJournal",
      "observe:journal-published",
      "afterPublished",
    ]);
  });

  test("propagates a hook failure without catching it, leaving partial state for rollback", async () => {
    const root = scratchRoot(import.meta.path, "commit-hook-throws");
    const { state, stages } = await buildState(root, { withExisting: true });
    const failure = new Error("beforePublish exploded");
    const release = preparedRelease(state, {
      beforePublish() {
        throw failure;
      },
    });
    await expect(release.commit()).rejects.toBe(failure);
    // The old-move half of commit() had already completed and been journaled before the hook ran.
    expect(stages).toEqual(["old-move-intent", "old-moved", "publish-intent"]);
    expect(state.oldMoved).toBe(true);
    expect(state.committed).toBe(false);
  });
});

describe("preparedRelease().rollback()", () => {
  test("fresh install, fully committed: removes the newly published destination", async () => {
    const root = scratchRoot(import.meta.path, "rollback-fresh-committed");
    const { state, finished } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.commit();
    await release.rollback();
    expect(existsSync(state.destination)).toBe(false);
    expect(finished()).toBe(true);
  });

  test("upgrade, fully committed: removes the new release and restores the backup", async () => {
    const root = scratchRoot(import.meta.path, "rollback-upgrade-committed");
    const { state } = await buildState(root, { withExisting: true });
    const release = preparedRelease(state, {});
    await release.commit();
    await release.rollback();
    expect(readFileSync(join(state.destination, "marker.txt"), "utf8")).toBe("old content");
    expect(existsSync(state.backup)).toBe(false);
  });

  test("crashed between old-move and publish: restores the backup, nothing to remove", async () => {
    const root = scratchRoot(import.meta.path, "rollback-old-moved-only");
    const { state } = await buildState(root, { withExisting: true });
    const release = preparedRelease(state, {
      beforePublish() {
        throw new Error("simulated crash before publish");
      },
    });
    await expect(release.commit()).rejects.toThrow();
    expect(state.committed).toBe(false);
    expect(state.oldMoved).toBe(true);
    await release.rollback();
    expect(readFileSync(join(state.destination, "marker.txt"), "utf8")).toBe("old content");
    expect(existsSync(state.backup)).toBe(false);
  });

  test("crashed before any mutation: rollback is a pure no-op besides finishing the transaction", async () => {
    const root = scratchRoot(import.meta.path, "rollback-untouched");
    const { state, finished } = await buildState(root, { withExisting: true });
    const release = preparedRelease(state, {
      beforeOldMove() {
        throw new Error("simulated crash before old-move");
      },
    });
    await expect(release.commit()).rejects.toThrow();
    expect(state.committed).toBe(false);
    expect(state.oldMoved).toBe(false);
    await release.rollback();
    // Original destination untouched.
    expect(readFileSync(join(state.destination, "marker.txt"), "utf8")).toBe("old content");
    expect(finished()).toBe(true);
  });

  test("is a no-op once the release has become irreversible", async () => {
    const root = scratchRoot(import.meta.path, "rollback-irreversible");
    const { state } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.commit();
    await release.finalize();
    // finalize() already completed; rollback() must not touch the now-live destination.
    await expect(release.rollback()).resolves.toBeUndefined();
    expect(readFileSync(join(state.destination, "marker.txt"), "utf8")).toBe("staged content");
  });

  test("calls beforeRollbackRemove and beforeRollbackRestore hooks", async () => {
    const root = scratchRoot(import.meta.path, "rollback-hooks");
    const { state } = await buildState(root, { withExisting: true });
    const calls: string[] = [];
    const release = preparedRelease(state, {
      beforeRollbackRemove() {
        calls.push("beforeRollbackRemove");
      },
      beforeRollbackRestore() {
        calls.push("beforeRollbackRestore");
      },
    });
    await release.commit();
    await release.rollback();
    expect(calls).toEqual(["beforeRollbackRemove", "beforeRollbackRestore"]);
  });

  test("throws an AggregateError when the recovery steps themselves fail", async () => {
    const root = scratchRoot(import.meta.path, "rollback-recovery-fails");
    const { state } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.commit();
    // Tamper with the published destination's identity between commit() and rollback(): replace
    // it with a fresh directory of the same name, so removeBoundPath's identity check fails.
    rmSync(state.destination, { recursive: true });
    mkdirSync(state.destination);
    await expect(release.rollback()).rejects.toBeInstanceOf(AggregateError);
  });
});

describe("preparedRelease().finalize()", () => {
  test("fresh install: skips the backup dance and goes straight to committed", async () => {
    const root = scratchRoot(import.meta.path, "finalize-fresh");
    const { state, stages, finished } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.commit();
    await release.finalize();
    expect(stages).toEqual(["publish-intent", "published", "committed"]);
    expect(finished()).toBe(true);
    expect(state.irreversible).toBe(true);
  });

  test("upgrade: quarantines and deletes the backup, then commits", async () => {
    const root = scratchRoot(import.meta.path, "finalize-upgrade");
    const { state, stages, finished } = await buildState(root, { withExisting: true });
    const release = preparedRelease(state, {});
    await release.commit();
    await release.finalize();
    expect(existsSync(state.backup)).toBe(false);
    expect(existsSync(state.backupQuarantine)).toBe(false);
    expect(stages).toEqual([
      "old-move-intent",
      "old-moved",
      "publish-intent",
      "published",
      "backup-delete-intent",
      "backup-quarantined",
      "committed",
    ]);
    expect(finished()).toBe(true);
  });

  test("calls every finalize hook and observe() checkpoint in order", async () => {
    const root = scratchRoot(import.meta.path, "finalize-hooks");
    const { state } = await buildState(root, { withExisting: true });
    const calls: string[] = [];
    const release = preparedRelease(state, {
      observe(step) {
        calls.push(`observe:${step}`);
      },
      beforeFinalizeBackup() {
        calls.push("beforeFinalizeBackup");
      },
      afterBackupQuarantinedBeforeJournal() {
        calls.push("afterBackupQuarantinedBeforeJournal");
      },
      afterBackupDeletedBeforeJournal() {
        calls.push("afterBackupDeletedBeforeJournal");
      },
      beforeMarkerFinish() {
        calls.push("beforeMarkerFinish");
      },
    });
    await release.commit();
    calls.length = 0;
    await release.finalize();
    expect(calls).toEqual([
      "observe:journal-backup-delete-intent",
      "beforeFinalizeBackup",
      "observe:backup-quarantine-synced",
      "afterBackupQuarantinedBeforeJournal",
      "observe:journal-backup-quarantined",
      "observe:backup-delete-synced",
      "afterBackupDeletedBeforeJournal",
      "observe:journal-committed",
      "beforeMarkerFinish",
      "observe:marker-delete-synced",
    ]);
  });

  test("sets irreversible before the backup is fully deleted, so a mid-finalize failure still blocks rollback", async () => {
    const root = scratchRoot(import.meta.path, "finalize-irreversible-early");
    const { state } = await buildState(root, { withExisting: true });
    const failure = new Error("simulated crash during backup deletion journaling");
    const release = preparedRelease(state, {
      afterBackupQuarantinedBeforeJournal() {
        throw failure;
      },
    });
    await release.commit();
    await expect(release.finalize()).rejects.toBe(failure);
    expect(state.irreversible).toBe(true);
    // Backup was already quarantined (moved) before the failure; rollback must refuse to act.
    await expect(release.rollback()).resolves.toBeUndefined();
    expect(existsSync(state.backup)).toBe(false);
  });
});

describe("preparedRelease().cleanup()", () => {
  test("after a full commit+finalize: removes nothing more, transaction.finish() not called again, lock released", async () => {
    const root = scratchRoot(import.meta.path, "cleanup-after-finalize");
    const { state, lockReleased } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.commit();
    await release.finalize();
    await release.cleanup();
    expect(lockReleased()).toBe(true);
    expect(state.lockHeld).toBe(false);
  });

  test("after commit failed before any mutation: removes the staged temporary and finishes the transaction", async () => {
    const root = scratchRoot(import.meta.path, "cleanup-after-early-failure");
    const { state, finished, lockReleased } = await buildState(root, { withExisting: true });
    const release = preparedRelease(state, {
      beforeOldMove() {
        throw new Error("simulated crash");
      },
    });
    await expect(release.commit()).rejects.toThrow();
    await release.cleanup();
    expect(existsSync(state.temporary)).toBe(false);
    expect(state.temporaryIdentity).toBeNull();
    expect(finished()).toBe(true);
    expect(lockReleased()).toBe(true);
  });

  test("after a successful rollback: cleanup's own transaction.finish() call is a safe no-op re-finish", async () => {
    const root = scratchRoot(import.meta.path, "cleanup-after-rollback");
    const { state, finished } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.commit();
    await release.rollback();
    await release.cleanup();
    expect(finished()).toBe(true);
  });

  test("calls beforeCleanupTemporary before removing the staged temporary", async () => {
    const root = scratchRoot(import.meta.path, "cleanup-hook");
    const { state } = await buildState(root, { withExisting: false });
    let calledBefore = false;
    const release = preparedRelease(state, {
      beforeCleanupTemporary() {
        calledBefore = true;
        expect(existsSync(state.temporary)).toBe(true);
      },
    });
    await release.cleanup();
    expect(calledBefore).toBe(true);
    expect(existsSync(state.temporary)).toBe(false);
  });

  test("is safe to call twice: the second call finds nothing left to release", async () => {
    const root = scratchRoot(import.meta.path, "cleanup-twice");
    const { state, lockReleased } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.cleanup();
    expect(lockReleased()).toBe(true);
    await expect(release.cleanup()).resolves.toBeUndefined();
  });

  test("throws an AggregateError when the temporary cleanup itself fails", async () => {
    const root = scratchRoot(import.meta.path, "cleanup-recovery-fails");
    const { state } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    // Tamper with the staged temporary's identity so removeBoundPath's own check fails.
    rmSync(state.temporary, { recursive: true });
    mkdirSync(state.temporary);
    await expect(release.cleanup()).rejects.toBeInstanceOf(AggregateError);
  });
});
