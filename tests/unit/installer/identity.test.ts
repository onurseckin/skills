import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  identifiedInstallation,
  installationManifest,
  readInstallationManifest,
  INSTALL_SCHEMA,
  INSTALL_VERSION,
  SKILL_NAME,
} from "../../../orchestrating-long-tasks/scripts/src/installer/identity.ts";
import { sealInstallationManifest } from "../../../orchestrating-long-tasks/scripts/src/installer/manifest-integrity.ts";
import { treeDigest } from "../../../orchestrating-long-tasks/scripts/src/installer/tree-digest.ts";
import { canonicalJsonBytes } from "../../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installer identity", () => {
  test("constants are re-exported correctly", () => {
    expect(INSTALL_SCHEMA).toBe("harness.installation");
    expect(INSTALL_VERSION).toBe(1);
    expect(SKILL_NAME).toBe("orchestrating-long-tasks");
  });

  test("installationManifest parses valid manifest and rejects invalid shapes", () => {
    const raw = {
      schema: INSTALL_SCHEMA,
      version: INSTALL_VERSION,
      skill_name: SKILL_NAME,
      runtime_version: "0.1.0",
      source_sha256: "a".repeat(64),
      installed_at: "2026-08-14T00:00:00.000Z",
      clients: ["claude"],
    };
    const validManifest = sealInstallationManifest(raw);

    expect(installationManifest(validManifest)).toEqual(validManifest);
    expect(installationManifest(null)).toBeNull();
    expect(installationManifest(undefined)).toBeNull();
    expect(installationManifest([])).toBeNull();
    expect(installationManifest("not an object")).toBeNull();
    expect(installationManifest(123)).toBeNull();
    expect(installationManifest({})).toBeNull();
    expect(
      installationManifest({
        ...validManifest,
        schema: "wrong-schema",
      }),
    ).toBeNull();
    expect(
      installationManifest({
        ...validManifest,
        skill_name: "wrong-skill",
      }),
    ).toBeNull();
    expect(
      installationManifest({
        ...validManifest,
        metadata_sha256: "tampered",
      }),
    ).toBeNull();
  });

  test("readInstallationManifest reads valid manifest file and returns null on failure", async () => {
    const { root } = await installerFixture();
    const manifestPath = join(root, "installation.json");

    expect(await readInstallationManifest(root)).toBeNull();

    const raw = {
      schema: INSTALL_SCHEMA,
      version: INSTALL_VERSION,
      skill_name: SKILL_NAME,
      runtime_version: "0.1.0",
      source_sha256: "a".repeat(64),
      installed_at: "2026-08-14T00:00:00.000Z",
      clients: ["claude"],
    };
    const validManifest = sealInstallationManifest(raw);
    await writeFile(manifestPath, canonicalJsonBytes(validManifest));
    const read = await readInstallationManifest(root);
    expect(read).toEqual(validManifest);

    await writeFile(manifestPath, "{ invalid json");
    expect(await readInstallationManifest(root)).toBeNull();
  });

  test("identifiedInstallation validates directory digest and runtime version against manifest", async () => {
    const { source } = await installerFixture();
    expect(await identifiedInstallation(source)).toBe(false);

    const digest = await treeDigest(source, new Set(["installation.json"]));
    const validManifest = sealInstallationManifest({
      schema: INSTALL_SCHEMA,
      version: INSTALL_VERSION,
      skill_name: SKILL_NAME,
      runtime_version: "0.1.0",
      source_sha256: digest,
      installed_at: "2026-08-14T00:00:00.000Z",
      clients: ["claude"],
    });
    await writeFile(join(source, "installation.json"), canonicalJsonBytes(validManifest));

    expect(await identifiedInstallation(source)).toBe(true);

    const mismatchedVersionManifest = sealInstallationManifest({
      schema: INSTALL_SCHEMA,
      version: INSTALL_VERSION,
      skill_name: SKILL_NAME,
      runtime_version: "0.2.0",
      source_sha256: digest,
      installed_at: "2026-08-14T00:00:00.000Z",
      clients: ["claude"],
    });
    await writeFile(
      join(source, "installation.json"),
      canonicalJsonBytes(mismatchedVersionManifest),
    );
    expect(await identifiedInstallation(source)).toBe(false);

    const mismatchedDigestManifest = sealInstallationManifest({
      schema: INSTALL_SCHEMA,
      version: INSTALL_VERSION,
      skill_name: SKILL_NAME,
      runtime_version: "0.1.0",
      source_sha256: "f".repeat(64),
      installed_at: "2026-08-14T00:00:00.000Z",
      clients: ["claude"],
    });
    await writeFile(
      join(source, "installation.json"),
      canonicalJsonBytes(mismatchedDigestManifest),
    );
    expect(await identifiedInstallation(source)).toBe(false);

    // Corrupted skill source structure (e.g. invalid SKILL.md)
    await writeFile(join(source, "SKILL.md"), "invalid-skill");
    await writeFile(join(source, "installation.json"), canonicalJsonBytes(validManifest));
    expect(await identifiedInstallation(source)).toBe(false);
  });
});
