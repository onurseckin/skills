import { describe, expect, test } from "bun:test";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  sealInstallationManifest,
  verifiedManifestPayload,
} from "../../../olt/scripts/src/installer/manifest-integrity.ts";
import {
  INSTALL_SCHEMA,
  INSTALL_VERSION,
  SKILL_NAME,
} from "../../../olt/scripts/src/installer/constants.ts";

const validDigest = "a".repeat(64);

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: INSTALL_SCHEMA,
    version: INSTALL_VERSION,
    skill_name: SKILL_NAME,
    runtime_version: "1.2.3",
    source_sha256: validDigest,
    installed_at: "2026-01-01T00:00:00.000Z",
    clients: ["claude", "codex"],
    ...overrides,
  };
}

describe("sealInstallationManifest", () => {
  test("seals a valid manifest with a matching metadata_sha256", () => {
    const sealed = sealInstallationManifest(validInput());
    expect(sealed.schema).toBe(INSTALL_SCHEMA);
    expect(sealed.clients).toEqual(["claude", "codex"]);
    expect(typeof sealed.metadata_sha256).toBe("string");
    const { metadata_sha256: _metadataSha256, ...manifest } = sealed;
    expect(sealed.metadata_sha256).toBe(sha256Bytes(canonicalJsonBytes(manifest)));
  });

  test("accepts an empty clients array", () => {
    const sealed = sealInstallationManifest(validInput({ clients: [] }));
    expect(sealed.clients).toEqual([]);
  });

  test("throws HarnessError when the payload fails validation", () => {
    expect(() => sealInstallationManifest(validInput({ schema: "wrong" }))).toThrow(HarnessError);
    try {
      sealInstallationManifest(validInput({ schema: "wrong" }));
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
    }
  });
});

describe("verifiedManifestPayload", () => {
  test("returns the manifest payload when metadata_sha256 matches and no extra keys exist", () => {
    const sealed = sealInstallationManifest(validInput());
    const verified = verifiedManifestPayload(sealed);
    expect(verified).not.toBeNull();
    expect(verified?.runtime_version).toBe("1.2.3");
  });

  test("returns null when the base payload itself is invalid", () => {
    expect(verifiedManifestPayload({ ...validInput(), schema: "wrong" })).toBeNull();
  });

  test("returns null when schema does not match", () => {
    expect(verifiedManifestPayload(validInput({ schema: "wrong" }))).toBeNull();
  });

  test("returns null when version does not match", () => {
    expect(verifiedManifestPayload(validInput({ version: 999 }))).toBeNull();
  });

  test("returns null when skill_name does not match", () => {
    expect(verifiedManifestPayload(validInput({ skill_name: "wrong" }))).toBeNull();
  });

  test("returns null when runtime_version is not a string", () => {
    expect(verifiedManifestPayload(validInput({ runtime_version: 1 }))).toBeNull();
  });

  test("returns null when source_sha256 is not a 64-hex-char digest", () => {
    expect(verifiedManifestPayload(validInput({ source_sha256: "not-a-digest" }))).toBeNull();
    expect(verifiedManifestPayload(validInput({ source_sha256: "A".repeat(64) }))).toBeNull();
  });

  test("returns null when installed_at is not a string", () => {
    expect(verifiedManifestPayload(validInput({ installed_at: 12345 }))).toBeNull();
  });

  test("returns null when installed_at does not parse as a date", () => {
    expect(verifiedManifestPayload(validInput({ installed_at: "not-a-date" }))).toBeNull();
  });

  test("returns null when clients is not an array", () => {
    expect(verifiedManifestPayload(validInput({ clients: "claude" }))).toBeNull();
  });

  test("returns null when a client entry is not a string", () => {
    expect(verifiedManifestPayload(validInput({ clients: ["claude", 5] }))).toBeNull();
  });

  test("returns null when a client entry is not a known client name", () => {
    expect(verifiedManifestPayload(validInput({ clients: ["not-a-client"] }))).toBeNull();
  });

  test("returns null when clients has duplicate entries", () => {
    expect(verifiedManifestPayload(validInput({ clients: ["claude", "claude"] }))).toBeNull();
  });

  test("returns null when clients are not sorted", () => {
    expect(verifiedManifestPayload(validInput({ clients: ["codex", "claude"] }))).toBeNull();
  });

  test("returns null when metadata_sha256 is not a string", () => {
    const sealed = sealInstallationManifest(validInput());
    expect(verifiedManifestPayload({ ...sealed, metadata_sha256: 5 })).toBeNull();
  });

  test("returns null when metadata_sha256 does not match the recomputed digest", () => {
    const sealed = sealInstallationManifest(validInput());
    expect(verifiedManifestPayload({ ...sealed, metadata_sha256: "0".repeat(64) })).toBeNull();
  });

  test("returns null when an unexpected extra key is present", () => {
    const sealed = sealInstallationManifest(validInput());
    expect(verifiedManifestPayload({ ...sealed, extra_key: "surprise" })).toBeNull();
  });
});
