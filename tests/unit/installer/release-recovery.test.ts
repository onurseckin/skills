import { afterEach, describe, expect, test } from "bun:test";
import { cp, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { recoverReleasePaths } from "../../../orchestrating-long-tasks/scripts/src/installer/release-recovery.ts";
import {
  MARKER_SCHEMA,
  type TransactionMarker,
} from "../../../orchestrating-long-tasks/scripts/src/installer/transaction-marker.ts";
import { sealInstallationManifest } from "../../../orchestrating-long-tasks/scripts/src/installer/manifest-integrity.ts";
import { pathIdentity, type PathIdentity } from "../../../orchestrating-long-tasks/scripts/src/installer/path-safety.ts";
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

function makeMarker(dest: string, sourceDigest: string, overrides: Partial<TransactionMarker> = {}): TransactionMarker {
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

describe("installer release recovery", () => {
  test("recovers published release by removing temporary and superseded backup", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, digest);
    await createIdentifiedRelease(marker.temporary, source);
    const oldId = await createIdentifiedRelease(marker.backup, source);
    await createIdentifiedRelease(marker.destination, source);

    marker.old_device = String(oldId.device);
    marker.old_inode = String(oldId.inode);

    await recoverReleasePaths(marker);

    expect(await lstat(marker.destination).catch(() => null)).not.toBeNull();
    expect(await lstat(marker.temporary).catch(() => null)).toBeNull();
    expect(await lstat(marker.backup).catch(() => null)).toBeNull();
    expect(await lstat(marker.backup_quarantine).catch(() => null)).toBeNull();
  });

  test("recovers published release with quarantine already created", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, digest);
    const oldId = await createIdentifiedRelease(marker.backup_quarantine, source);
    await createIdentifiedRelease(marker.destination, source);

    marker.old_device = String(oldId.device);
    marker.old_inode = String(oldId.inode);

    await recoverReleasePaths(marker);

    expect(await lstat(marker.destination).catch(() => null)).not.toBeNull();
    expect(await lstat(marker.backup_quarantine).catch(() => null)).toBeNull();
  });

  test("restores backup to destination if failure occurred after old moved but before publish", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, digest, { stage: "old-moved" });
    await createIdentifiedRelease(marker.temporary, source);
    await createIdentifiedRelease(marker.backup, source);

    await recoverReleasePaths(marker);

    expect(await lstat(marker.destination).catch(() => null)).not.toBeNull();
    expect(await lstat(marker.backup).catch(() => null)).toBeNull();
    expect(await lstat(marker.temporary).catch(() => null)).toBeNull();
  });

  test("cleans up temporary when failure occurred before old move (no dest, no backup)", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, digest, { stage: "prepared" });
    await createIdentifiedRelease(marker.temporary, source);

    await recoverReleasePaths(marker);

    expect(await lstat(marker.temporary).catch(() => null)).toBeNull();
  });

  test("cleans up temporary when old destination still present and no backup/quarantine", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const dest = join(root, "dest");

    // Create destination with modified source (different digest)
    await createIdentifiedRelease(dest, source);
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('updated')\n");
    const updatedDigest = await treeDigest(source, new Set(["installation.json"]));

    const marker = makeMarker(dest, updatedDigest, { stage: "prepared" });
    await createIdentifiedRelease(marker.temporary, source);

    await recoverReleasePaths(marker);

    expect(await lstat(marker.destination).catch(() => null)).not.toBeNull();
    expect(await lstat(marker.temporary).catch(() => null)).toBeNull();
  });
});
