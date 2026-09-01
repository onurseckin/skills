import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, rename, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { sealInstallationManifest } from "../../../olt/scripts/src/installer/manifest-integrity.ts";
import { acquireInstallerLock } from "../../../olt/scripts/src/installer/installer-lock.ts";
import { pathIdentity } from "../../../olt/scripts/src/installer/path-safety.ts";
import {
  beginReleaseTransaction,
  recoverReleaseTransaction,
} from "../../../olt/scripts/src/installer/release-transaction.ts";
import { SKILL_NAME } from "../../../olt/scripts/src/installer/constants.ts";
import { treeDigest } from "../../../olt/scripts/src/installer/tree-digest.ts";
import { validateSkillSource } from "../../../olt/scripts/src/installer/source-validation.ts";
import { markerPath } from "../../../olt/scripts/src/installer/transaction-marker.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";
import { cleanInstallerFixtures, installerFixture } from "../helpers.ts";

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
