import { afterEach, describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import {
  identifiedInstallation,
  installationManifest,
  readInstallationManifest,
} from "../../../olt/scripts/src/installer/identity.ts";
import { sealInstallationManifest } from "../../../olt/scripts/src/installer/manifest-integrity.ts";
import { treeDigest } from "../../../olt/scripts/src/installer/tree-digest.ts";
import {
  INSTALL_SCHEMA,
  INSTALL_VERSION,
  SKILL_NAME,
} from "../../../olt/scripts/src/installer/constants.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

const validDigest = "b".repeat(64);

function validManifestInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: INSTALL_SCHEMA,
    version: INSTALL_VERSION,
    skill_name: SKILL_NAME,
    runtime_version: "0.1.0",
    source_sha256: validDigest,
    installed_at: "2026-01-01T00:00:00.000Z",
    clients: ["claude"],
    ...overrides,
  };
}

describe("installationManifest", () => {
  test("returns the manifest for a sealed, verified payload", () => {
    const sealed = sealInstallationManifest(validManifestInput());
    expect(installationManifest(sealed)?.runtime_version).toBe("0.1.0");
  });

  test("returns null for a non-object value", () => {
    expect(installationManifest("not an object")).toBeNull();
    expect(installationManifest(42)).toBeNull();
  });

  test("returns null for null", () => {
    expect(installationManifest(null)).toBeNull();
  });

  test("returns null for an array", () => {
    expect(installationManifest([])).toBeNull();
  });

  test("returns null when the payload fails manifest verification", () => {
    expect(installationManifest(validManifestInput())).toBeNull();
  });
});

describe("readInstallationManifest", () => {
  test("returns null when installation.json does not exist", async () => {
    const { source } = await installerFixture();
    expect(await readInstallationManifest(source)).toBeNull();
  });

  test("returns null when installation.json is not valid canonical JSON", async () => {
    const { source } = await installerFixture();
    await writeFile(join(source, "installation.json"), "{ not json");
    expect(await readInstallationManifest(source)).toBeNull();
  });

  test("returns null when installation.json parses but is not a trustworthy manifest", async () => {
    const { source } = await installerFixture();
    await writeFile(join(source, "installation.json"), canonicalJsonBytes({ hello: "world" }));
    expect(await readInstallationManifest(source)).toBeNull();
  });

  test("returns the manifest when installation.json is a valid sealed manifest", async () => {
    const { source } = await installerFixture();
    const sealed = sealInstallationManifest(validManifestInput());
    await writeFile(join(source, "installation.json"), canonicalJsonBytes(sealed));
    const manifest = await readInstallationManifest(source);
    expect(manifest?.source_sha256).toBe(validDigest);
  });
});

describe("identifiedInstallation", () => {
  test("returns false when there is no installation manifest", async () => {
    const { source } = await installerFixture();
    expect(await identifiedInstallation(source)).toBe(false);
  });

  test("returns true when the manifest's digest and runtime version match the real tree", async () => {
    const { source } = await installerFixture();
    const digest = await treeDigest(source, new Set(["installation.json"]));
    const sealed = sealInstallationManifest(validManifestInput({ source_sha256: digest }));
    await writeFile(join(source, "installation.json"), canonicalJsonBytes(sealed));
    expect(await identifiedInstallation(source)).toBe(true);
  });

  test("returns false when the manifest's runtime_version does not match the source", async () => {
    const { source } = await installerFixture();
    const digest = await treeDigest(source, new Set(["installation.json"]));
    const sealed = sealInstallationManifest(
      validManifestInput({ source_sha256: digest, runtime_version: "9.9.9" }),
    );
    await writeFile(join(source, "installation.json"), canonicalJsonBytes(sealed));
    expect(await identifiedInstallation(source)).toBe(false);
  });

  test("returns false when the manifest's digest no longer matches the real tree contents", async () => {
    const { source } = await installerFixture();
    const sealed = sealInstallationManifest(validManifestInput({ source_sha256: validDigest }));
    await writeFile(join(source, "installation.json"), canonicalJsonBytes(sealed));
    expect(await identifiedInstallation(source)).toBe(false);
  });

  test("returns false when validating the skill source throws, e.g. SKILL.md is missing", async () => {
    const { source } = await installerFixture();
    const digest = await treeDigest(source, new Set(["installation.json"]));
    const sealed = sealInstallationManifest(validManifestInput({ source_sha256: digest }));
    await writeFile(join(source, "installation.json"), canonicalJsonBytes(sealed));
    await rm(join(source, "SKILL.md"));
    expect(await identifiedInstallation(source)).toBe(false);
  });
});
