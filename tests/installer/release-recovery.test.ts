import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../olt/scripts/src/core/json.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { sealInstallationManifest } from "../../olt/scripts/src/installer/manifest-integrity.ts";
import { pathIdentity } from "../../olt/scripts/src/installer/path-safety.ts";
import { recoverReleasePaths } from "../../olt/scripts/src/installer/release-recovery.ts";
import { SKILL_NAME } from "../../olt/scripts/src/installer/constants.ts";
import { treeDigest } from "../../olt/scripts/src/installer/tree-digest.ts";
import { validateSkillSource } from "../../olt/scripts/src/installer/source-validation.ts";
import type { TransactionMarker } from "../../olt/scripts/src/installer/transaction-marker.ts";
import { scratchRoot } from "../shared/scratch-root.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

/**
 * Copies `sourceRoot` into `dir` and seals a self-consistent installation.json there: the
 * manifest's source_sha256 is always `dir`'s own real content digest, so identifiedInstallation()
 * accepts it regardless of what any particular test's TransactionMarker.source_sha256 says. Tests
 * that need a release to disagree with the marker do so by choosing the marker's digest, not by
 * writing an inconsistent manifest (identifiedInstallation would just reject that outright).
 * Returns the real digest that was sealed in, for callers that need to match or deliberately
 * mismatch it against a marker field.
 */
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

function baseMarker(
  home: string,
  destination: string,
  overrides: Partial<TransactionMarker> = {},
): TransactionMarker {
  return {
    schema: "harness-install-transaction/v3",
    pid: 1,
    lock_device: "1",
    lock_inode: "1",
    destination,
    temporary: join(home, "dest.tmp-1"),
    backup: join(home, "dest.old-1"),
    backup_quarantine: join(home, "dest.delete-1"),
    old_device: null,
    old_inode: null,
    source_sha256: "d".repeat(64),
    stage: "prepared",
    ...overrides,
  };
}

describe("recoverReleasePaths: temporary-only crash (nothing else touched)", () => {
  test("removes an orphaned staged release matching the marker's digest", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "temp-only");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const temporary = join(home, "dest.tmp-1");
    const digest = await makeRelease(source, temporary);
    const marker = baseMarker(home, destination, { temporary, source_sha256: digest });

    await recoverReleasePaths(marker);

    expect(await pathIdentity(temporary)).toBeNull();
    expect(await pathIdentity(destination)).toBeNull();
  });

  test("is a no-op when nothing at all is present (marker already fully cleaned up)", async () => {
    const root = scratchRoot(import.meta.path, "all-missing");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const marker = baseMarker(home, destination);
    await expect(recoverReleasePaths(marker)).resolves.toBeUndefined();
  });
});

describe("recoverReleasePaths: requireRelease validation", () => {
  test("throws when the temporary path exists but is not an identified installation", async () => {
    const root = scratchRoot(import.meta.path, "temp-not-identified");
    const home = join(root, "home");
    const temporary = join(home, "dest.tmp-1");
    await mkdir(temporary, { recursive: true });
    const marker = baseMarker(home, join(home, "dest"), { temporary });
    await expect(recoverReleasePaths(marker)).rejects.toBeInstanceOf(HarnessError);
  });

  test("throws when the temporary release's digest does not match the marker's recorded digest", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "temp-digest-mismatch");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const temporary = join(home, "dest.tmp-1");
    await makeRelease(source, temporary);
    const marker = baseMarker(home, join(home, "dest"), {
      temporary,
      source_sha256: "0".repeat(64),
    });
    await expect(recoverReleasePaths(marker)).rejects.toBeInstanceOf(HarnessError);
  });
});

describe("recoverReleasePaths: publish already ran (destination is the new release)", () => {
  test("removes the leftover temporary and quarantines+deletes a leftover backup", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "published-with-backup");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const temporary = join(home, "dest.tmp-1");
    const backup = join(home, "dest.old-1");
    const backupQuarantine = join(home, "dest.delete-1");

    const digest = await makeRelease(source, destination);
    await makeRelease(source, temporary);
    await makeRelease(source, backup);
    const backupIdentity = await pathIdentity(backup);
    if (!backupIdentity) throw new Error("expected backup identity to resolve");

    const marker = baseMarker(home, destination, {
      temporary,
      backup,
      backup_quarantine: backupQuarantine,
      source_sha256: digest,
      stage: "published",
      old_device: String(backupIdentity.device),
      old_inode: String(backupIdentity.inode),
    });

    await recoverReleasePaths(marker);

    expect(await pathIdentity(temporary)).toBeNull();
    expect(await pathIdentity(backup)).toBeNull();
    expect(await pathIdentity(backupQuarantine)).toBeNull();
    expect(await pathIdentity(destination)).not.toBeNull();
  });

  test("finishes deleting a backup that was already quarantined before the crash", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "published-with-quarantine");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const temporary = join(home, "dest.tmp-1");
    const backupQuarantine = join(home, "dest.delete-1");

    const digest = await makeRelease(source, destination);
    await makeRelease(source, temporary);
    await makeRelease(source, backupQuarantine);
    const quarantineIdentity = await pathIdentity(backupQuarantine);
    if (!quarantineIdentity) throw new Error("expected quarantine identity to resolve");

    const marker = baseMarker(home, destination, {
      temporary,
      backup: join(home, "dest.old-1"),
      backup_quarantine: backupQuarantine,
      source_sha256: digest,
      stage: "backup-quarantined",
      old_device: String(quarantineIdentity.device),
      old_inode: String(quarantineIdentity.inode),
    });

    await recoverReleasePaths(marker);

    expect(await pathIdentity(backupQuarantine)).toBeNull();
    expect(await pathIdentity(destination)).not.toBeNull();
  });

  test("is a clean no-op when publish already fully completed with no backup left behind", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "published-clean");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const temporary = join(home, "dest.tmp-1");
    const digest = await makeRelease(source, destination);
    await makeRelease(source, temporary);

    const marker = baseMarker(home, destination, {
      temporary,
      source_sha256: digest,
      stage: "committed",
    });

    await recoverReleasePaths(marker);
    expect(await pathIdentity(temporary)).toBeNull();
    expect(await pathIdentity(destination)).not.toBeNull();
  });

  test("throws when both a backup and a quarantine exist simultaneously (corrupted state)", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "published-both-backup-and-quarantine");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const backup = join(home, "dest.old-1");
    const backupQuarantine = join(home, "dest.delete-1");
    const digest = await makeRelease(source, destination);
    await makeRelease(source, backup);
    await makeRelease(source, backupQuarantine);
    const quarantineIdentity = await pathIdentity(backupQuarantine);
    if (!quarantineIdentity) throw new Error("expected identity to resolve");

    const marker = baseMarker(home, destination, {
      backup,
      backup_quarantine: backupQuarantine,
      source_sha256: digest,
      stage: "published",
      // Matches backup_quarantine's own identity so requireQuarantine() itself passes cleanly,
      // letting the "both backup and quarantine exist" inconsistency in removeSuperseded be the
      // thing that actually throws.
      old_device: String(quarantineIdentity.device),
      old_inode: String(quarantineIdentity.inode),
    });

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction has both backup and quarantine paths/,
    );
  });

  test("throws when a superseded release is found but the marker recorded no prior install", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "published-unexpected-backup");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const backup = join(home, "dest.old-1");
    const digest = await makeRelease(source, destination);
    await makeRelease(source, backup);

    const marker = baseMarker(home, destination, {
      backup,
      source_sha256: digest,
      stage: "published",
      old_device: null,
      old_inode: null,
    });

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction has an unexpected superseded release/,
    );
  });

  test("throws when the backup's own identity no longer matches what the marker recorded", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "published-backup-identity-changed");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const backup = join(home, "dest.old-1");
    const digest = await makeRelease(source, destination);
    await makeRelease(source, backup);

    const marker = baseMarker(home, destination, {
      backup,
      source_sha256: digest,
      stage: "published",
      // A real, differently-shaped identity than backup's actual one, simulating that the
      // filesystem object at `backup` isn't the same one the marker was written against.
      old_device: "999999",
      old_inode: "999999",
    });

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction backup changed identity/,
    );
  });

  test("throws when the backup_quarantine path's identity does not match the marker's recorded old identity", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "quarantine-identity-changed");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const backupQuarantine = join(home, "dest.delete-1");
    const digest = await makeRelease(source, destination);
    await makeRelease(source, backupQuarantine);

    const marker = baseMarker(home, destination, {
      backup_quarantine: backupQuarantine,
      source_sha256: digest,
      stage: "backup-quarantined",
      old_device: "999999",
      old_inode: "999999",
    });

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction backup quarantine changed identity/,
    );
  });
});

describe("recoverReleasePaths: publish never ran (destination still missing)", () => {
  test("restores the backup back to destination when the old release was moved but never published", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "old-moved-not-published");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const temporary = join(home, "dest.tmp-1");
    const backup = join(home, "dest.old-1");
    const digest = await makeRelease(source, temporary);
    await makeRelease(source, backup);

    const marker = baseMarker(home, destination, {
      temporary,
      backup,
      source_sha256: digest,
      stage: "old-moved",
    });

    await recoverReleasePaths(marker);

    expect(await pathIdentity(destination)).not.toBeNull();
    expect(await pathIdentity(backup)).toBeNull();
    expect(await pathIdentity(temporary)).toBeNull();
  });

  test("just removes the leftover temporary when the old release was never touched", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "untouched-old-release");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const temporary = join(home, "dest.tmp-1");
    const digest = await makeRelease(source, temporary);
    await makeRelease(source, destination);

    const marker = baseMarker(home, destination, {
      temporary,
      source_sha256: digest,
      stage: "prepared",
    });

    await recoverReleasePaths(marker);

    expect(await pathIdentity(temporary)).toBeNull();
    expect(await pathIdentity(destination)).not.toBeNull();
  });

  test("throws when both an old (untouched) destination and a backup exist at once", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "destination-and-backup-both-exist");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const backup = join(home, "dest.old-1");
    const destinationDigest = await makeRelease(source, destination);
    await makeRelease(source, backup);

    const marker = baseMarker(home, destination, {
      backup,
      // Deliberately different from destination's own real digest, so destinationIsNew is false
      // and this falls through to the "both an old destination and backup" inconsistency check
      // instead of being treated as a completed publish.
      source_sha256: destinationDigest === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64),
      stage: "prepared",
    });

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction has both an old destination and backup/,
    );
  });

  test("throws when a quarantine exists but the transaction never reached publication", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "quarantine-without-publish");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const backupQuarantine = join(home, "dest.delete-1");
    await makeRelease(source, backupQuarantine);
    const quarantineIdentity = await pathIdentity(backupQuarantine);
    if (!quarantineIdentity) throw new Error("expected quarantine identity to resolve");

    const marker = baseMarker(home, destination, {
      backup_quarantine: backupQuarantine,
      source_sha256: "d".repeat(64),
      stage: "prepared",
      old_device: String(quarantineIdentity.device),
      old_inode: String(quarantineIdentity.inode),
    });

    await expect(recoverReleasePaths(marker)).rejects.toThrow(
      /transaction lost its published release during deletion/,
    );
  });
});

describe("recoverReleasePaths: readdir sanity", () => {
  test("leaves no stray files in the parent directory after a full recovery", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "readdir-sanity");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    const temporary = join(home, "dest.tmp-1");
    const digest = await makeRelease(source, temporary);
    const marker = baseMarker(home, destination, { temporary, source_sha256: digest });
    await recoverReleasePaths(marker);
    expect(await readdir(home)).toEqual([]);
  });
});
