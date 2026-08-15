import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { recoverReleasePaths } from "../../../orchestrating-long-tasks/scripts/src/installer/release-recovery.ts";
import {
  MARKER_SCHEMA,
  type TransactionMarker,
} from "../../../orchestrating-long-tasks/scripts/src/installer/transaction-marker.ts";
import { sealInstallationManifest } from "../../../orchestrating-long-tasks/scripts/src/installer/manifest-integrity.ts";
import {
  pathIdentity,
  type PathIdentity,
} from "../../../orchestrating-long-tasks/scripts/src/installer/path-safety.ts";
import { treeDigest } from "../../../orchestrating-long-tasks/scripts/src/installer/tree-digest.ts";
import { canonicalJsonBytes } from "../../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

async function createIdentifiedRelease(path: string, source: string): Promise<PathIdentity> {
  await cp(source, path, { recursive: true });
  const digest = await treeDigest(path, new Set(["installation.json"]));
  const manifest = sealInstallationManifest({
    schema: "harness.installation",
    version: 1,
    skill_name: "orchestrating-long-tasks",
    runtime_version: "0.1.0",
    source_sha256: digest,
    installed_at: new Date().toISOString(),
    clients: ["claude"],
  });
  await writeFile(join(path, "installation.json"), canonicalJsonBytes(manifest));
  const id = await pathIdentity(path);
  return id!;
}

function makeMarker(
  dest: string,
  sourceDigest: string,
  overrides: Partial<TransactionMarker> = {},
): TransactionMarker {
  const uuid = randomUUID();
  return {
    schema: MARKER_SCHEMA,
    pid: process.pid,
    lock_device: "1",
    lock_inode: "1",
    destination: dest,
    temporary: `${dest}.tmp-${uuid}`,
    backup: `${dest}.old-${uuid}`,
    backup_quarantine: `${dest}.delete-${uuid}`,
    old_device: null,
    old_inode: null,
    source_sha256: sourceDigest,
    stage: "published",
    ...overrides,
  };
}

describe("installer release recovery errors", () => {
  test("throws when path is not an identified release", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, digest);
    await mkdir(marker.temporary);

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction path is not an identified release/,
    );
  });

  test("throws when release has unexpected digest", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, digest);
    await createIdentifiedRelease(marker.temporary, source);

    const wrongMarker = { ...marker, source_sha256: "0".repeat(64) };
    await expect(recoverReleasePaths(wrongMarker)).rejects.toThrow(
      /transaction release has an unexpected digest/,
    );
  });

  test("throws when transaction has superseded release but oldIdentity is null", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, digest);
    await createIdentifiedRelease(marker.backup, source);
    await createIdentifiedRelease(marker.destination, source);
    marker.old_device = null;
    marker.old_inode = null;

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction has an unexpected superseded release/,
    );
  });

  test("throws when backup changed identity", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, digest);
    await createIdentifiedRelease(marker.backup, source);
    await createIdentifiedRelease(marker.destination, source);
    marker.old_device = "99999";
    marker.old_inode = "99999";

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction backup changed identity/,
    );
  });

  test("throws when quarantine changed identity", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, digest);
    await createIdentifiedRelease(marker.backup_quarantine, source);
    marker.old_device = "99999";
    marker.old_inode = "99999";

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction backup quarantine changed identity/,
    );
  });

  test("throws when published release lost during deletion (quarantine exists without new destination)", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, digest, { stage: "backup-delete-intent" });
    const qId = await createIdentifiedRelease(marker.backup_quarantine, source);
    marker.old_device = String(qId.device);
    marker.old_inode = String(qId.inode);

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction lost its published release during deletion/,
    );
  });

  test("throws when transaction has both old destination and backup", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");

    // Destination is old version
    await createIdentifiedRelease(dest, source);
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('updated')\n");
    const updatedDigest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, updatedDigest, { stage: "old-move-intent" });
    await createIdentifiedRelease(marker.backup, source);

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction has both an old destination and backup/,
    );
  });
});
