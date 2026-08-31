import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { acquireInstallerLock } from "../../../olt/scripts/src/installer/installer-lock.ts";
import {
  atomicReleaseCopy,
  prepareReleaseCopy,
  type ReleaseCopyHooks,
} from "../../../olt/scripts/src/installer/release-copy.ts";
import { beginReleaseTransaction } from "../../../olt/scripts/src/installer/release-transaction.ts";
import { sealInstallationManifest } from "../../../olt/scripts/src/installer/manifest-integrity.ts";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import { markerPath } from "../../../olt/scripts/src/installer/transaction-marker.ts";
import { pathIdentity } from "../../../olt/scripts/src/installer/path-safety.ts";
import { validateSkillSource } from "../../../olt/scripts/src/installer/source-validation.ts";
import { SKILL_NAME } from "../../../olt/scripts/src/installer/constants.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";
import { cleanInstallerFixtures, installerFixture } from "../helpers.ts";

afterEach(cleanInstallerFixtures);

async function validManifest(source: string): Promise<Record<string, unknown>> {
  const validated = await validateSkillSource(source);
  return {
    schema: "harness.installation",
    version: 1,
    skill_name: SKILL_NAME,
    runtime_version: validated.runtimeVersion,
    source_sha256: validated.digest,
    installed_at: "2026-01-01T00:00:00.000Z",
    clients: ["claude"],
  };
}

describe("prepareReleaseCopy", () => {
  test("stages a fresh release, syncing the tree and exposing it as a PreparedRelease", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "prepare-fresh");
    const home = join(root, "home");
    const destination = join(home, "dest");
    const events: string[] = [];
    const release = await prepareReleaseCopy(source, destination, await validManifest(source), {
      hooks: { observe: (step) => events.push(step) },
    });
    expect(events).toContain("staged-tree-synced");
    await release.commit();
    await release.finalize();
    await release.cleanup();
    expect(await readFile(join(destination, "installation.json"), "utf8")).toContain(SKILL_NAME);
  });

  test("rejects an unsupported platform before touching the filesystem", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "prepare-bad-platform");
    const home = join(root, "home");
    await expect(
      prepareReleaseCopy(source, join(home, "dest"), await validManifest(source), {
        platform: "win32",
      }),
    ).rejects.toBeInstanceOf(HarnessError);
  });

  test("refuses to replace a destination that already exists as a plain file", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "prepare-dest-is-file");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const destination = join(home, "dest");
    writeFileSync(destination, "not a directory");
    await expect(
      prepareReleaseCopy(source, destination, await validManifest(source)),
    ).rejects.toThrow(/refusing to replace unrelated path/);
  });

  test("refuses to replace a destination directory that is not an identified installation", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "prepare-dest-not-identified");
    const home = join(root, "home");
    const destination = join(home, "dest");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "random.txt"), "not a real install");
    await expect(
      prepareReleaseCopy(source, destination, await validManifest(source)),
    ).rejects.toThrow(/refusing to replace unrelated path/);
  });

  test("rejects a manifest whose digest does not match the staged content", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "prepare-staged-digest-mismatch");
    const home = join(root, "home");
    const destination = join(home, "dest");
    const manifest = await validManifest(source);
    manifest.source_sha256 = "0".repeat(64);
    await expect(prepareReleaseCopy(source, destination, manifest)).rejects.toThrow(
      /staged release digest or runtime does not match its manifest/,
    );
  });

  test("rejects a manifest when the source changes during the final re-validation", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "prepare-current-digest-mismatch");
    const home = join(root, "home");
    const destination = join(home, "dest");
    const manifest = await validManifest(source);
    await expect(
      prepareReleaseCopy(source, destination, manifest, {
        hooks: {
          async beforeSourceRecheck() {
            await writeFile(join(source, "extra-file.txt"), "mutated after staging");
          },
        },
      }),
    ).rejects.toThrow(/skill source changed during identity validation/);
  });

  test("FINDING: a staged-digest mismatch leaves the staged temporary directory on disk", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "prepare-failure-leaks-temp");
    const home = join(root, "home");
    const destination = join(home, "dest");
    const manifest = await validManifest(source);
    manifest.source_sha256 = "0".repeat(64);
    await expect(prepareReleaseCopy(source, destination, manifest)).rejects.toThrow(
      /staged release digest or runtime does not match its manifest/,
    );
    const entries = await readdir(home).catch(() => []);
    expect(entries.some((name) => name.includes(".tmp-"))).toBe(true);
    const lock = acquireInstallerLock(home);
    lock.release();
  });

  test("automatically recovers a leftover crashed transaction from a previous attempt", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "prepare-auto-recovery");
    const home = join(root, "home");
    const destination = join(home, "dest");
    const manifest = await validManifest(source);

    await mkdir(home, { recursive: true });
    const validated = await validateSkillSource(source);
    const temporary = join(home, `dest.tmp-${randomUUID()}`);
    await cp(source, temporary, { recursive: true });
    const sealed = sealInstallationManifest({
      schema: "harness.installation",
      version: 1,
      skill_name: SKILL_NAME,
      runtime_version: validated.runtimeVersion,
      source_sha256: validated.digest,
      installed_at: "2026-01-01T00:00:00.000Z",
      clients: [],
    });
    await writeFile(join(temporary, "installation.json"), canonicalJsonBytes(sealed));
    const setupLock = acquireInstallerLock(home);
    await beginReleaseTransaction(
      home,
      destination,
      temporary,
      join(home, `dest.old-${randomUUID()}`),
      join(home, `dest.delete-${randomUUID()}`),
      validated.digest,
      null,
      setupLock,
    );
    setupLock.release();

    expect(await pathIdentity(markerPath(home))).not.toBeNull();

    const release = await prepareReleaseCopy(source, destination, manifest);
    await release.commit();
    await release.finalize();
    await release.cleanup();
    expect(await pathIdentity(markerPath(home))).toBeNull();
    expect(await readFile(join(destination, "installation.json"), "utf8")).toContain(SKILL_NAME);
  });

  test("stages an upgrade over an existing identified installation", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "prepare-upgrade");
    const home = join(root, "home");
    const destination = join(home, "dest");
    const manifest = await validManifest(source);

    const first = await prepareReleaseCopy(source, destination, manifest);
    await first.commit();
    await first.finalize();
    await first.cleanup();

    const second = await prepareReleaseCopy(source, destination, manifest);
    await second.commit();
    await second.finalize();
    await second.cleanup();
    expect(await readFile(join(destination, "installation.json"), "utf8")).toContain(SKILL_NAME);
  });
});

describe("atomicReleaseCopy", () => {
  test("installs a fresh release end to end", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "atomic-fresh");
    const home = join(root, "home");
    const destination = join(home, "dest");
    await atomicReleaseCopy(source, destination, await validManifest(source));
    expect(await readFile(join(destination, "installation.json"), "utf8")).toContain(SKILL_NAME);
    expect(await pathIdentity(markerPath(home))).toBeNull();
  });

  test("upgrades an existing installation end to end", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "atomic-upgrade");
    const home = join(root, "home");
    const destination = join(home, "dest");
    await atomicReleaseCopy(source, destination, await validManifest(source));
    await atomicReleaseCopy(source, destination, await validManifest(source));
    expect(await readFile(join(destination, "installation.json"), "utf8")).toContain(SKILL_NAME);
  });

  test("rolls back and re-throws the original failure when commit fails partway", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "atomic-commit-fails");
    const home = join(root, "home");
    const destination = join(home, "dest");
    await atomicReleaseCopy(source, destination, await validManifest(source));
    const failure = new Error("simulated publish failure");
    const hooks: ReleaseCopyHooks = {
      beforePublish() {
        throw failure;
      },
    };
    await expect(
      atomicReleaseCopy(source, destination, await validManifest(source), { hooks }),
    ).rejects.toBe(failure);
    expect(await readFile(join(destination, "installation.json"), "utf8")).toContain(SKILL_NAME);
    expect(await pathIdentity(markerPath(home))).toBeNull();
  });

  test("combines the original failure with a cleanup failure when both commit and cleanup fail", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "atomic-commit-and-cleanup-fail");
    const home = join(root, "home");
    const destination = join(home, "dest");
    await atomicReleaseCopy(source, destination, await validManifest(source));
    const failure = new Error("simulated publish failure");
    const hooks: ReleaseCopyHooks = {
      beforePublish() {
        throw failure;
      },
      beforeCleanupTemporary() {
        const tempName = readdirSync(home).find((name) => name.includes(".tmp-"));
        if (!tempName) return;
        const tempPath = join(home, tempName);
        rmSync(tempPath, { recursive: true });
        mkdirSync(tempPath);
      },
    };
    await expect(
      atomicReleaseCopy(source, destination, await validManifest(source), { hooks }),
    ).rejects.toBeInstanceOf(AggregateError);
  });
});
