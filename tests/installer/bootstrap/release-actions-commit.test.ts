import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InstallerLock } from "../../../olt/scripts/src/installer/installer-lock.ts";
import { pathIdentity } from "../../../olt/scripts/src/installer/path-safety.ts";
import {
  preparedRelease,
  type ReleaseState,
} from "../../../olt/scripts/src/installer/release-actions.ts";
import type { ReleaseTransaction } from "../../../olt/scripts/src/installer/release-transaction.ts";
import type { TransactionStage } from "../../../olt/scripts/src/installer/transaction-marker.ts";
import type { ReleaseCopyHooks } from "../../../olt/scripts/src/installer/release-copy.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";
import { cleanupVirtualInstallerFS, setupVirtualInstallerFS } from "../helpers.ts";

beforeEach(setupVirtualInstallerFS);
afterEach(cleanupVirtualInstallerFS);

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
