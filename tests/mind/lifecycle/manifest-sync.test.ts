import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  computeManifestSha256Pin,
  computeMerkleGenesisBinding,
  resolveManifestPath,
  syncOrchestratorToManifest,
  validateCapsuleManifestBinding,
} from "../../../olt/scripts/src/mind/lifecycle/manifest-sync.ts";
import type { OrchestratorRegistrationRecord } from "../../../olt/scripts/src/mind/lifecycle/orchestrator-ledger.ts";

describe("Capsule Manifest Binding & Sync Engine", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "manifest-sync-test-"));
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const createMockRecord = (
    overrides?: Partial<OrchestratorRegistrationRecord>,
  ): OrchestratorRegistrationRecord => ({
    orchestrator_id: "orch-101",
    run_id: "capsule-run-abc-123",
    conversation_id: "conv-xyz-789",
    pid: 12345,
    host_type: "antigravity",
    spawned_at: "2026-08-29T12:00:00.000Z",
    status: "ACTIVE",
    manifest_sha256: "",
    last_heartbeat_at: "2026-08-29T12:00:00.000Z",
    ...overrides,
  });

  describe("computeManifestSha256Pin", () => {
    it("computes identical SHA-256 for objects with different key ordering", () => {
      const objA = { b: "value_b", a: "value_a", nested: { z: 2, y: 1 } };
      const objB = { nested: { y: 1, z: 2 }, a: "value_a", b: "value_b" };

      const pinA = computeManifestSha256Pin(objA);
      const pinB = computeManifestSha256Pin(objB);

      expect(pinA).toBe(pinB);
      expect(pinA).toMatch(/^[0-9a-f]{64}$/);
    });

    it("handles JSON strings, raw strings, and Uint8Array buffers", () => {
      const jsonStr = '{"a":"value_a","b":"value_b"}';
      const rawText = "plain-text-manifest-payload";
      const bytes = new TextEncoder().encode(rawText);

      const pinJson = computeManifestSha256Pin(jsonStr);
      const pinRaw = computeManifestSha256Pin(rawText);
      const pinBytes = computeManifestSha256Pin(bytes);

      expect(pinJson).toMatch(/^[0-9a-f]{64}$/);
      expect(pinRaw).toBe(pinBytes);
    });
  });

  describe("computeMerkleGenesisBinding", () => {
    it("computes deterministic Merkle genesis binding from record and manifest pin", () => {
      const record = createMockRecord();
      const manifestBytes = '{"goal":"test-capsule","stage":"preplanning"}';

      const binding1 = computeMerkleGenesisBinding(record, manifestBytes);
      const binding2 = computeMerkleGenesisBinding(record, manifestBytes);

      expect(binding1).toBe(binding2);
      expect(binding1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("generates different binding when record fields or manifest differ", () => {
      const recordA = createMockRecord({ orchestrator_id: "orch-101" });
      const recordB = createMockRecord({ orchestrator_id: "orch-102" });
      const manifestPin = "a".repeat(64);

      const bindingA = computeMerkleGenesisBinding(recordA, manifestPin);
      const bindingB = computeMerkleGenesisBinding(recordB, manifestPin);

      expect(bindingA).not.toBe(bindingB);
    });
  });

  describe("syncOrchestratorToManifest", () => {
    it("creates manifest atomically when file does not exist yet", () => {
      const record = createMockRecord();
      const manifestPath = join(tempDir, ".olt", "capsules", record.run_id, "manifest.json");

      const result = syncOrchestratorToManifest(record, { manifestPath });

      expect(existsSync(manifestPath)).toBe(true);
      expect(result.updatedManifest.orchestrator_id).toBe("orch-101");
      expect(result.updatedManifest.orchestrator_pid).toBe(12345);
      expect(result.updatedManifest.conversation_id).toBe("conv-xyz-789");
      expect(result.updatedManifest.run_id).toBe("capsule-run-abc-123");
      expect(typeof result.updatedManifest.orchestrator_binding_sha256).toBe("string");
      expect(result.pin).toMatch(/^[0-9a-f]{64}$/);

      const onDisk = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(onDisk.orchestrator_id).toBe("orch-101");
    });

    it("preserves pre-existing manifest properties during sync", () => {
      const record = createMockRecord();
      const manifestPath = join(tempDir, "custom-manifest.json");
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(
        manifestPath,
        JSON.stringify({ custom_field: "preserve_me", goal: "infinite_cadence" }),
      );

      const result = syncOrchestratorToManifest(record, { manifestPath });

      expect(result.updatedManifest.custom_field).toBe("preserve_me");
      expect(result.updatedManifest.goal).toBe("infinite_cadence");
      expect(result.updatedManifest.orchestrator_id).toBe("orch-101");
    });

    it("resolves paths correctly using runRoot", () => {
      const record = createMockRecord({ run_id: "test-run-root-id" });
      const result = syncOrchestratorToManifest(record, { runRoot: tempDir });

      const expectedPath = join(tempDir, ".olt", "capsules", "test-run-root-id", "manifest.json");
      expect(existsSync(expectedPath)).toBe(true);
      expect(result.updatedManifest.run_id).toBe("test-run-root-id");
    });
  });

  describe("validateCapsuleManifestBinding", () => {
    it("returns valid: true for matching manifest and recorded pin", () => {
      const initialRecord = createMockRecord();
      const syncResult = syncOrchestratorToManifest(initialRecord, { runRoot: tempDir });
      const recordWithPin = createMockRecord({ manifest_sha256: syncResult.pin });

      const validation = validateCapsuleManifestBinding(recordWithPin, { runRoot: tempDir });

      expect(validation.valid).toBe(true);
      expect(validation.expectedPin).toBe(syncResult.pin);
      expect(validation.actualPin).toBe(syncResult.pin);
      expect(validation.error).toBeUndefined();
    });

    it("returns valid: false when manifest file is missing", () => {
      const record = createMockRecord();
      const validation = validateCapsuleManifestBinding(record, { runRoot: tempDir });

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("MANIFEST_DESYNC_ERROR: Manifest file not found");
    });

    it("throws HarnessError with MANIFEST_DESYNC_ERROR on missing manifest when assert is true", () => {
      const record = createMockRecord();
      expect(() => {
        validateCapsuleManifestBinding(record, { runRoot: tempDir, assert: true });
      }).toThrow(HarnessError);

      try {
        validateCapsuleManifestBinding(record, { runRoot: tempDir, assert: true });
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INTEGRITY");
        expect(harnessErr.message).toContain("MANIFEST_DESYNC_ERROR");
      }
    });

    it("detects orchestrator_id mismatch", () => {
      const record = createMockRecord({ orchestrator_id: "orch-correct" });
      syncOrchestratorToManifest(record, { runRoot: tempDir });

      const wrongRecord = createMockRecord({ orchestrator_id: "orch-imposter" });
      const result = validateCapsuleManifestBinding(wrongRecord, { runRoot: tempDir });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("orchestrator_id mismatch");

      expect(() => {
        validateCapsuleManifestBinding(wrongRecord, { runRoot: tempDir, assert: true });
      }).toThrow(/MANIFEST_DESYNC_ERROR: orchestrator_id mismatch/);
    });

    it("detects run_id and conversation_id mismatch", () => {
      const record = createMockRecord({ conversation_id: "conv-1" });
      syncOrchestratorToManifest(record, { runRoot: tempDir });

      const wrongConvRecord = createMockRecord({ conversation_id: "conv-2" });
      const result = validateCapsuleManifestBinding(wrongConvRecord, { runRoot: tempDir });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("conversation_id mismatch");
    });

    it("detects tampered manifest content / SHA-256 pin mismatch", () => {
      const record = createMockRecord();
      const syncResult = syncOrchestratorToManifest(record, { runRoot: tempDir });
      const recordWithPin = createMockRecord({ manifest_sha256: syncResult.pin });

      const manifestPath = resolveManifestPath(record.run_id, { runRoot: tempDir });
      const current = JSON.parse(readFileSync(manifestPath, "utf-8"));
      current.tampered_property = "unauthorized_modification";
      writeFileSync(manifestPath, JSON.stringify(current));

      const validation = validateCapsuleManifestBinding(recordWithPin, { runRoot: tempDir });
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("manifest pin mismatch");

      expect(() => {
        validateCapsuleManifestBinding(recordWithPin, { runRoot: tempDir, assert: true });
      }).toThrow(/MANIFEST_DESYNC_ERROR: manifest pin mismatch/);
    });

    it("handles corrupt / non-JSON manifest gracefully", () => {
      const record = createMockRecord();
      const manifestPath = resolveManifestPath(record.run_id, { runRoot: tempDir });
      mkdirSync(join(tempDir, ".olt", "capsules", record.run_id), { recursive: true });
      writeFileSync(manifestPath, "{ corrupt json ... invalid syntax");

      const validation = validateCapsuleManifestBinding(record, { runRoot: tempDir });
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("MANIFEST_DESYNC_ERROR: Corrupt or unreadable manifest");
    });
  });
});
