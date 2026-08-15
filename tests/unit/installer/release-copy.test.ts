import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  atomicReleaseCopy,
  prepareReleaseCopy,
  INSTALL_SCHEMA,
} from "../../../orchestrating-long-tasks/scripts/src/installer/release-copy.ts";
import { treeDigest } from "../../../orchestrating-long-tasks/scripts/src/installer/tree-digest.ts";
import { readInstallationManifest } from "../../../orchestrating-long-tasks/scripts/src/installer/identity.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installer release copy", () => {
  test("INSTALL_SCHEMA is re-exported", () => {
    expect(INSTALL_SCHEMA).toBe("harness.installation");
  });

  test("atomicReleaseCopy performs end-to-end fresh installation", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const destination = join(root, "installed-skill");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const rawManifest = {
      schema: INSTALL_SCHEMA,
      version: 1,
      skill_name: "orchestrating-long-tasks",
      runtime_version: "0.1.0",
      source_sha256: digest,
      installed_at: new Date().toISOString(),
      clients: ["claude"],
    };

    const observed: string[] = [];
    await atomicReleaseCopy(source, destination, rawManifest, {
      hooks: {
        observe(step) {
          observed.push(step);
        },
      },
    });

    expect(observed).toContain("staged-tree-synced");
    const manifest = await readInstallationManifest(destination);
    expect(manifest).not.toBeNull();
    expect(manifest?.source_sha256).toBe(digest);
    expect(manifest?.runtime_version).toBe("0.1.0");
  });

  test("atomicReleaseCopy upgrades an existing valid installation", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const destination = join(root, "installed-skill");
    const initialDigest = await treeDigest(source, new Set(["installation.json"]));

    const rawManifest = {
      schema: INSTALL_SCHEMA,
      version: 1,
      skill_name: "orchestrating-long-tasks",
      runtime_version: "0.1.0",
      source_sha256: initialDigest,
      installed_at: new Date().toISOString(),
      clients: ["claude"],
    };

    await atomicReleaseCopy(source, destination, rawManifest);

    // Update source
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('upgraded')\n");
    const upgradedDigest = await treeDigest(source, new Set(["installation.json"]));
    const upgradedManifest = {
      ...rawManifest,
      source_sha256: upgradedDigest,
    };

    await atomicReleaseCopy(source, destination, upgradedManifest);

    const manifest = await readInstallationManifest(destination);
    expect(manifest?.source_sha256).toBe(upgradedDigest);
  });

  test("prepareReleaseCopy rejects if destination is an existing regular file", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const destination = join(root, "dest-file");
    await writeFile(destination, "data");

    const digest = await treeDigest(source, new Set(["installation.json"]));
    const rawManifest = {
      schema: INSTALL_SCHEMA,
      version: 1,
      skill_name: "orchestrating-long-tasks",
      runtime_version: "0.1.0",
      source_sha256: digest,
      installed_at: new Date().toISOString(),
      clients: ["claude"],
    };

    await expect(prepareReleaseCopy(source, destination, rawManifest)).rejects.toThrow(
      /refusing to replace unrelated path/,
    );
  });

  test("prepareReleaseCopy rejects if destination is an existing symlink", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const realDir = join(root, "real-dir");
    const destination = join(root, "dest-link");
    await mkdir(realDir);
    await symlink(realDir, destination);

    const digest = await treeDigest(source, new Set(["installation.json"]));
    const rawManifest = {
      schema: INSTALL_SCHEMA,
      version: 1,
      skill_name: "orchestrating-long-tasks",
      runtime_version: "0.1.0",
      source_sha256: digest,
      installed_at: new Date().toISOString(),
      clients: ["claude"],
    };

    await expect(prepareReleaseCopy(source, destination, rawManifest)).rejects.toThrow(
      /refusing to replace unrelated path/,
    );
  });

  test("prepareReleaseCopy rejects if destination is an un-identified directory", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const destination = join(root, "unrelated-dir");
    await mkdir(destination);

    const digest = await treeDigest(source, new Set(["installation.json"]));
    const rawManifest = {
      schema: INSTALL_SCHEMA,
      version: 1,
      skill_name: "orchestrating-long-tasks",
      runtime_version: "0.1.0",
      source_sha256: digest,
      installed_at: new Date().toISOString(),
      clients: ["claude"],
    };

    await expect(prepareReleaseCopy(source, destination, rawManifest)).rejects.toThrow(
      /refusing to replace unrelated path/,
    );
  });

  test("prepareReleaseCopy rejects if manifest does not match source digest or version", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const destination = join(root, "dest-skill");

    const rawManifestWrongDigest = {
      schema: INSTALL_SCHEMA,
      version: 1,
      skill_name: "orchestrating-long-tasks",
      runtime_version: "0.1.0",
      source_sha256: "0".repeat(64),
      installed_at: new Date().toISOString(),
      clients: ["claude"],
    };

    await expect(prepareReleaseCopy(source, destination, rawManifestWrongDigest)).rejects.toThrow(
      /staged release digest or runtime does not match its manifest/,
    );

    const digest = await treeDigest(source, new Set(["installation.json"]));
    const rawManifestWrongVersion = {
      schema: INSTALL_SCHEMA,
      version: 1,
      skill_name: "orchestrating-long-tasks",
      runtime_version: "9.9.9",
      source_sha256: digest,
      installed_at: new Date().toISOString(),
      clients: ["claude"],
    };

    await expect(prepareReleaseCopy(source, destination, rawManifestWrongVersion)).rejects.toThrow(
      /staged release digest or runtime does not match its manifest/,
    );
  });

  test("atomicReleaseCopy rolls back when commit fails", async () => {
    const { root: rawRoot, source } = await installerFixture();
    const root = await realpath(rawRoot);
    const destination = join(root, "dest-skill-fail");
    const digest = await treeDigest(source, new Set(["installation.json"]));

    const rawManifest = {
      schema: INSTALL_SCHEMA,
      version: 1,
      skill_name: "orchestrating-long-tasks",
      runtime_version: "0.1.0",
      source_sha256: digest,
      installed_at: new Date().toISOString(),
      clients: ["claude"],
    };

    await expect(
      atomicReleaseCopy(source, destination, rawManifest, {
        hooks: {
          beforePublish() {
            throw new Error("simulated commit failure");
          },
        },
      }),
    ).rejects.toThrow(/simulated commit failure/);

    expect(await lstat(destination).catch(() => null)).toBeNull();
  });
});
