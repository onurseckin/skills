import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  resolveManifestPath,
  computeManifestSha256Pin,
  computeMerkleGenesisBinding,
  syncOrchestratorToManifest,
  validateCapsuleManifestBinding,
} from "../../../olt/scripts/src/mind/lifecycle/manifest-sync.ts";
import type { OrchestratorRegistrationRecord } from "../../../olt/scripts/src/mind/lifecycle/orchestration/index.ts";

describe("Manifest Sync & Genesis Binding Suite (manifest-sync.ts)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `manifest-sync-cov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  const createDummyRecord = (
    overrides: Partial<OrchestratorRegistrationRecord> = {},
  ): OrchestratorRegistrationRecord => ({
    run_id: "run-abc-123",
    orchestrator_id: "orch-001",
    pid: 12345,
    conversation_id: "conv-xyz-789",
    manifest_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    registered_at: "2026-09-01T12:00:00.000Z",
    ...overrides,
  });

  describe("resolveManifestPath", () => {
    it("resolves explicit manifestPath if provided", () => {
      const explicit = join(testDir, "custom", "manifest.json");
      expect(resolveManifestPath("run-1", { manifestPath: explicit })).toBe(resolve(explicit));
    });

    it("resolves runRoot ending with manifest.json", () => {
      const target = join(testDir, "runs", "manifest.json");
      expect(resolveManifestPath("run-1", { runRoot: target })).toBe(resolve(target));
    });

    it("resolves runRoot ending with runId", () => {
      const target = join(testDir, "capsules", "run-1");
      expect(resolveManifestPath("run-1", { runRoot: target })).toBe(
        resolve(target, "manifest.json"),
      );
    });

    it("resolves runRoot as parent directory when not ending with runId or manifest.json", () => {
      expect(resolveManifestPath("run-1", { runRoot: testDir })).toBe(
        resolve(testDir, ".olt", "capsules", "run-1", "manifest.json"),
      );
    });

    it("resolves relative to cwd when options is omitted", () => {
      expect(resolveManifestPath("run-default")).toBe(
        resolve(process.cwd(), ".olt", "capsules", "run-default", "manifest.json"),
      );
    });
  });

  describe("computeManifestSha256Pin & computeMerkleGenesisBinding", () => {
    it("computes pin for Uint8Array content", () => {
      const bytes = new TextEncoder().encode('{"test":true}');
      const pin = computeManifestSha256Pin(bytes);
      expect(pin).toMatch(/^[0-9a-f]{64}$/);
    });

    it("computes pin for valid JSON string as canonical object hash", () => {
      const pin1 = computeManifestSha256Pin('{"b": 2, "a": 1}');
      const pin2 = computeManifestSha256Pin('{"a": 1, "b": 2}');
      expect(pin1).toBe(pin2);
      expect(pin1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("computes pin for invalid JSON or array string via raw utf-8 hash fallback", () => {
      const pinRaw = computeManifestSha256Pin("not a json string");
      expect(pinRaw).toMatch(/^[0-9a-f]{64}$/);

      const pinArray = computeManifestSha256Pin("[1, 2, 3]");
      expect(pinArray).toMatch(/^[0-9a-f]{64}$/);
    });

    it("computes pin for plain JS object", () => {
      const pin = computeManifestSha256Pin({ alpha: "value", beta: 42 });
      expect(pin).toMatch(/^[0-9a-f]{64}$/);
    });

    it("computes Merkle Genesis binding for hex string, raw string, and Uint8Array", () => {
      const record = createDummyRecord();
      const hexSha = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      const bindingHex = computeMerkleGenesisBinding(record, hexSha);
      expect(bindingHex).toMatch(/^[0-9a-f]{64}$/);

      const bindingHexUpper = computeMerkleGenesisBinding(record, hexSha.toUpperCase());
      expect(bindingHexUpper).toBe(bindingHex);

      const rawBinding = computeMerkleGenesisBinding(record, "arbitrary raw string");
      expect(rawBinding).toMatch(/^[0-9a-f]{64}$/);

      const bytesBinding = computeMerkleGenesisBinding(record, new Uint8Array([1, 2, 3, 4]));
      expect(bytesBinding).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("syncOrchestratorToManifest", () => {
    it("creates manifest and parent directory when file does not exist", () => {
      const manifestPath = join(testDir, "capsule", "run-1", "manifest.json");
      const record = createDummyRecord({ run_id: "run-1", orchestrator_id: "orch-1" });

      const syncResult = syncOrchestratorToManifest(record, { manifestPath });
      expect(existsSync(manifestPath)).toBe(true);
      expect(syncResult.pin).toMatch(/^[0-9a-f]{64}$/);
      expect(syncResult.updatedManifest.run_id).toBe("run-1");
      expect(syncResult.updatedManifest.orchestrator_id).toBe("orch-1");
      expect(syncResult.updatedManifest.orchestrator_binding_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("preserves existing fields and updates binding when manifest exists", () => {
      const manifestPath = join(testDir, "existing-manifest.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({ custom_field: "preserve_me", run_id: "run-1" }),
        "utf-8",
      );

      const record = createDummyRecord({ run_id: "run-1", orchestrator_id: "orch-2" });
      const syncResult = syncOrchestratorToManifest(record, { manifestPath });

      expect(syncResult.updatedManifest.custom_field).toBe("preserve_me");
      expect(syncResult.updatedManifest.orchestrator_id).toBe("orch-2");
    });

    it("recovers gracefully when existing manifest contains corrupted JSON", () => {
      const manifestPath = join(testDir, "corrupted-manifest.json");
      writeFileSync(manifestPath, "{ corrupt json ...", "utf-8");

      const record = createDummyRecord({ run_id: "run-corrupt" });
      const syncResult = syncOrchestratorToManifest(record, { manifestPath });

      expect(syncResult.updatedManifest.run_id).toBe("run-corrupt");
    });
  });

  describe("validateCapsuleManifestBinding", () => {
    it("returns error or throws when manifest file does not exist", () => {
      const record = createDummyRecord();
      const manifestPath = join(testDir, "missing-manifest.json");

      const nonAssertResult = validateCapsuleManifestBinding(record, { manifestPath });
      expect(nonAssertResult.valid).toBe(false);
      expect(nonAssertResult.error).toContain("Manifest file not found");

      expect(() => validateCapsuleManifestBinding(record, { manifestPath, assert: true })).toThrow(
        HarnessError,
      );
    });

    it("handles corrupted or non-object manifest files", () => {
      const manifestPath = join(testDir, "invalid.json");
      writeFileSync(manifestPath, "[1, 2, 3]", "utf-8");
      const record = createDummyRecord();

      const res = validateCapsuleManifestBinding(record, { manifestPath });
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Corrupt or unreadable manifest");

      expect(() => validateCapsuleManifestBinding(record, { manifestPath, assert: true })).toThrow(
        HarnessError,
      );
    });

    it("detects orchestrator_id, run_id, and conversation_id mismatches", () => {
      const manifestPath = join(testDir, "mismatch-manifest.json");
      const record = createDummyRecord({
        orchestrator_id: "orch-correct",
        run_id: "run-correct",
        conversation_id: "conv-correct",
      });

      // Orchestrator ID mismatch
      writeFileSync(
        manifestPath,
        JSON.stringify({
          orchestrator_id: "orch-wrong",
          run_id: "run-correct",
          conversation_id: "conv-correct",
        }),
        "utf-8",
      );
      const orchMismatch = validateCapsuleManifestBinding(record, { manifestPath });
      expect(orchMismatch.valid).toBe(false);
      expect(orchMismatch.error).toContain("orchestrator_id mismatch");
      expect(() => validateCapsuleManifestBinding(record, { manifestPath, assert: true })).toThrow(
        HarnessError,
      );

      // Run ID mismatch
      writeFileSync(
        manifestPath,
        JSON.stringify({
          orchestrator_id: "orch-correct",
          run_id: "run-wrong",
          conversation_id: "conv-correct",
        }),
        "utf-8",
      );
      const runMismatch = validateCapsuleManifestBinding(record, { manifestPath });
      expect(runMismatch.valid).toBe(false);
      expect(runMismatch.error).toContain("run_id mismatch");
      expect(() => validateCapsuleManifestBinding(record, { manifestPath, assert: true })).toThrow(
        HarnessError,
      );

      // Conversation ID mismatch
      writeFileSync(
        manifestPath,
        JSON.stringify({
          orchestrator_id: "orch-correct",
          run_id: "run-correct",
          conversation_id: "conv-wrong",
        }),
        "utf-8",
      );
      const convMismatch = validateCapsuleManifestBinding(record, { manifestPath });
      expect(convMismatch.valid).toBe(false);
      expect(convMismatch.error).toContain("conversation_id mismatch");
      expect(() => validateCapsuleManifestBinding(record, { manifestPath, assert: true })).toThrow(
        HarnessError,
      );
    });

    it("detects manifest pin hash mismatch when record has expected sha256", () => {
      const manifestPath = join(testDir, "pin-mismatch.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({ orchestrator_id: "orch-1", run_id: "run-1", conversation_id: "conv-1" }),
        "utf-8",
      );

      const record = createDummyRecord({
        orchestrator_id: "orch-1",
        run_id: "run-1",
        conversation_id: "conv-1",
        manifest_sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      });

      const mismatch = validateCapsuleManifestBinding(record, { manifestPath });
      expect(mismatch.valid).toBe(false);
      expect(mismatch.error).toContain("manifest pin mismatch");
      expect(() => validateCapsuleManifestBinding(record, { manifestPath, assert: true })).toThrow(
        HarnessError,
      );
    });

    it("validates successfully with matching pin or empty record manifest_sha256", () => {
      const manifestPath = join(testDir, "valid-manifest.json");
      const manifestObj = { orchestrator_id: "orch-1", run_id: "run-1", conversation_id: "conv-1" };
      writeFileSync(manifestPath, JSON.stringify(manifestObj), "utf-8");

      const pin = computeManifestSha256Pin(manifestObj);
      const recordWithPin = createDummyRecord({
        orchestrator_id: "orch-1",
        run_id: "run-1",
        conversation_id: "conv-1",
        manifest_sha256: pin,
      });

      const validResult = validateCapsuleManifestBinding(recordWithPin, {
        manifestPath,
        assert: true,
      });
      expect(validResult.valid).toBe(true);
      expect(validResult.actualPin).toBe(pin);

      const recordWithoutPin = createDummyRecord({
        orchestrator_id: "orch-1",
        run_id: "run-1",
        conversation_id: "conv-1",
        manifest_sha256: "",
      });
      const validNoPin = validateCapsuleManifestBinding(recordWithoutPin, { manifestPath });
      expect(validNoPin.valid).toBe(true);
      expect(validNoPin.expectedPin).toBe(pin);
    });
  });
});
