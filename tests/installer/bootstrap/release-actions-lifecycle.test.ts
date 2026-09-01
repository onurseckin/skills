import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InstallerLock } from "../../../olt/scripts/src/installer/installer-lock.ts";
import { pathIdentity } from "../../../olt/scripts/src/installer/path-safety.ts";
import {
  preparedRelease,
  type ReleaseState,
} from "../../../olt/scripts/src/installer/release-actions.ts";
import type { ReleaseTransaction } from "../../../olt/scripts/src/installer/release-transaction.ts";
import type { TransactionStage } from "../../../olt/scripts/src/installer/transaction-marker.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";
import { cleanupVirtualInstallerFS, setupVirtualInstallerFS } from "../helpers.ts";

beforeEach(setupVirtualInstallerFS);
afterEach(cleanupVirtualInstallerFS);

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
    expect(readFileSync(join(state.destination, "marker.txt"), "utf8")).toBe("old content");
    expect(finished()).toBe(true);
  });

  test("is a no-op once the release has become irreversible", async () => {
    const root = scratchRoot(import.meta.path, "rollback-irreversible");
    const { state } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.commit();
    await release.finalize();
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
    expect(state.irreversible).toBe(true);
  });

  test("is a no-op on repeated calls", async () => {
    const root = scratchRoot(import.meta.path, "finalize-idempotent");
    const { state } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.commit();
    await release.finalize();
    await expect(release.finalize()).resolves.toBeUndefined();
  });
});

describe("preparedRelease().dispose() / cleanup()", () => {
  test("cleans up leftover temporary directory on uncommitted release", async () => {
    const root = scratchRoot(import.meta.path, "dispose-cleanup-temp");
    const { state, lockReleased } = await buildState(root, { withExisting: false });
    const release = preparedRelease(state, {});
    await release.cleanup();
    expect(existsSync(state.temporary)).toBe(false);
    expect(lockReleased()).toBe(true);
  });
});
