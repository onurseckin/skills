import { describe, expect, it } from "bun:test";
import { checkManifest } from "../../../olt/scripts/src/engine/store/layout/manifest.ts";
import {
  CAPSULE_ID_PATTERN,
  RUN_ID_PATTERN,
  SHA256_PATTERN,
} from "../../../olt/scripts/src/engine/store/layout/constants.ts";

describe("Workspace Layout: Manifest Format & Validation", () => {
  it("matches valid run IDs against slug pattern", () => {
    expect(RUN_ID_PATTERN.test("run-123")).toBe(true);
    expect(RUN_ID_PATTERN.test("run_test_01")).toBe(true);
    expect(RUN_ID_PATTERN.test("12345")).toBe(true);
    expect(RUN_ID_PATTERN.test("")).toBe(false);
  });

  it("matches valid SHA-256 digests against hex pattern", () => {
    const validSha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(SHA256_PATTERN.test(validSha)).toBe(true);
    expect(SHA256_PATTERN.test("invalid-hash")).toBe(false);
  });

  it("matches valid capsule IDs against 32-char hex pattern", () => {
    const validCapsuleId = "e3b0c44298fc1c149afbf4c8996fb924";
    expect(CAPSULE_ID_PATTERN.test(validCapsuleId)).toBe(true);
    expect(CAPSULE_ID_PATTERN.test("short-id")).toBe(false);
  });

  it("reports issues when checking nonexistent run directory", () => {
    const res = checkManifest("/tmp/nonexistent-run-dir-12345");
    expect(res.issues.length).toBeGreaterThanOrEqual(1);
  });
});
