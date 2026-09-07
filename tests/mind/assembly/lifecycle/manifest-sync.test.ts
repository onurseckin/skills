import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  computeManifestSha256Pin,
  computeMerkleGenesisBinding,
  resolveManifestPath,
  syncOrchestratorToManifest,
  validateCapsuleManifestBinding,
} from "../../../../olt/scripts/src/mind/lifecycle/manifest-sync.ts";
import type { OrchestratorRegistrationRecord } from "../../../../olt/scripts/src/mind/lifecycle/orchestration/index.ts";
import {
  setupVirtualMindFS,
  cleanupVirtualMindFS,
  scratchRoot,
} from "../../fixtures/mind-fixture.ts";
import type { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Assembly Lifecycle Manifest Sync Suite", () => {
  let testDir: string;
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = setupVirtualMindFS();
    testDir = scratchRoot("manifest-sync");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  const makeRecord = (
    overrides: Partial<OrchestratorRegistrationRecord> = {},
  ): OrchestratorRegistrationRecord => ({
    run_id: "run-sync-100",
    orchestrator_id: "orch-sync-1",
    pid: 12345,
    conversation_id: "conv-100",
    manifest_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    spawned_at: "2026-09-01T12:00:00.000Z",
    status: "ACTIVE",
    ...overrides,
  });

  describe("resolveManifestPath", () => {
    it("resolves explicit manifestPath if provided", () => {
      const explicit = path.join(testDir, "custom", "manifest.json");
      expect(resolveManifestPath("run-1", { manifestPath: explicit })).toBe(path.resolve(explicit));
    });

    it("resolves runRoot ending with manifest.json or ending with runId", () => {
      const manifestFile = path.join(testDir, "runs", "manifest.json");
      expect(resolveManifestPath("run-1", { runRoot: manifestFile })).toBe(
        path.resolve(manifestFile),
      );

      const runDir = path.join(testDir, "capsules", "run-1");
      expect(resolveManifestPath("run-1", { runRoot: runDir })).toBe(
        path.resolve(runDir, "manifest.json"),
      );
    });

    it("resolves default path from runRoot directory root", () => {
      expect(resolveManifestPath("run-1", { runRoot: testDir })).toBe(
        path.resolve(testDir, ".olt", "capsules", "run-1", "manifest.json"),
      );
    });
  });

  describe("computeManifestSha256Pin Multi-Format Hashing", () => {
    it("hashes Uint8Array bytes directly", () => {
      const bytes = new TextEncoder().encode("hello-manifest");
      const pin = computeManifestSha256Pin(bytes);
      expect(typeof pin).toBe("string");
      expect(pin.length).toBe(64);
    });

    it("sorts object keys canonically ensuring deterministic hashing", () => {
      const obj1 = { z: 1, a: 2, m: { y: "b", x: "a" } };
      const obj2 = { a: 2, z: 1, m: { x: "a", y: "b" } };

      const pin1 = computeManifestSha256Pin(obj1);
      const pin2 = computeManifestSha256Pin(obj2);
      expect(pin1).toBe(pin2);

      const strPin1 = computeManifestSha256Pin(JSON.stringify(obj1));
      const strPin2 = computeManifestSha256Pin(JSON.stringify(obj2));
      expect(strPin1).toBe(strPin2);
      expect(strPin1).toBe(pin1);
    });

    it("falls back to raw UTF-8 string hashing when input is not valid JSON object", () => {
      const raw = "raw-string-content-not-json";
      const pin = computeManifestSha256Pin(raw);
      expect(typeof pin).toBe("string");
      expect(pin.length).toBe(64);
    });

    it("deterministically computes 64-char hex pins for boundary inputs ({}, '', Uint8Array(0))", () => {
      const pinObj = computeManifestSha256Pin({});
      const pinStr = computeManifestSha256Pin("");
      const pinBytes = computeManifestSha256Pin(new Uint8Array(0));

      expect(pinObj).toHaveLength(64);
      expect(pinStr).toHaveLength(64);
      expect(pinBytes).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(pinObj)).toBe(true);
      expect(/^[0-9a-f]{64}$/.test(pinStr)).toBe(true);
      expect(/^[0-9a-f]{64}$/.test(pinBytes)).toBe(true);
    });
  });

  describe("computeMerkleGenesisBinding", () => {
    it("computes deterministic SHA-256 Merkle binding", () => {
      const record = makeRecord();
      const manifestPin = "a".repeat(64);

      const binding1 = computeMerkleGenesisBinding(record, manifestPin);
      const binding2 = computeMerkleGenesisBinding(record, manifestPin);
      expect(binding1).toBe(binding2);
      expect(binding1.length).toBe(64);

      const tamperedRecord = makeRecord({ pid: 99999 });
      const tamperedBinding = computeMerkleGenesisBinding(tamperedRecord, manifestPin);
      expect(tamperedBinding).not.toBe(binding1);
    });

    it("accepts raw manifest content and computes hash on the fly", () => {
      const record = makeRecord();
      const rawContent = JSON.stringify({ version: "1.0", name: "test-manifest" });

      const binding = computeMerkleGenesisBinding(record, rawContent);
      expect(typeof binding).toBe("string");
      expect(binding.length).toBe(64);
    });
  });

  describe("syncOrchestratorToManifest & validateCapsuleManifestBinding", () => {
    it("synchronizes manifest file durably in VirtualMemoryFS", () => {
      const manifestPath = path.join(testDir, "manifest.json");
      const record = makeRecord();

      const syncResult = syncOrchestratorToManifest(record, { manifestPath });
      expect(syncResult.pin).toBeDefined();
      expect(syncResult.updatedManifest.orchestrator_id).toBe("orch-sync-1");
      expect(syncResult.updatedManifest.orchestrator_binding_sha256).toBeDefined();

      expect(vfs.existsSync(manifestPath)).toBe(true);
      const savedRaw = vfs.readFileSync(manifestPath, "utf8");
      const saved = JSON.parse(savedRaw);
      expect(saved.run_id).toBe("run-sync-100");
    });

    it("validates matching manifest successfully", () => {
      const manifestPath = path.join(testDir, "manifest.json");
      const record = makeRecord();
      const syncResult = syncOrchestratorToManifest(record, { manifestPath });

      const recordWithPin = makeRecord({ manifest_sha256: syncResult.pin });
      const validation = validateCapsuleManifestBinding(recordWithPin, { manifestPath });
      expect(validation.valid).toBe(true);
      expect(validation.expectedPin).toBe(syncResult.pin);
    });

    it("fails validation on hash divergence / tampering", () => {
      const manifestPath = path.join(testDir, "manifest.json");
      const record = makeRecord();
      syncOrchestratorToManifest(record, { manifestPath });

      const recordWithMismatchedPin = makeRecord({ manifest_sha256: "0".repeat(64) });
      const validation = validateCapsuleManifestBinding(recordWithMismatchedPin, { manifestPath });
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("mismatch");

      expect(() =>
        validateCapsuleManifestBinding(recordWithMismatchedPin, { manifestPath, assert: true }),
      ).toThrow(HarnessError);
    });

    it("fails validation when manifest file is missing", () => {
      const missingPath = path.join(testDir, "nonexistent-manifest.json");
      const record = makeRecord();

      const validation = validateCapsuleManifestBinding(record, { manifestPath: missingPath });
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("not found");
    });

    it("throws HarnessError('INTEGRITY') in assert mode on corrupt JSON, orchestrator_id or run_id mismatch", () => {
      const manifestPath = path.join(testDir, "manifest.json");
      const record = makeRecord();

      vfs.writeFileSync(manifestPath, "{ invalid json root", "utf8");
      expect(() => validateCapsuleManifestBinding(record, { manifestPath, assert: true })).toThrow(
        HarnessError,
      );

      vfs.writeFileSync(
        manifestPath,
        JSON.stringify({ orchestrator_id: "mismatched-orch" }),
        "utf8",
      );
      expect(() => validateCapsuleManifestBinding(record, { manifestPath, assert: true })).toThrow(
        HarnessError,
      );

      vfs.writeFileSync(
        manifestPath,
        JSON.stringify({ orchestrator_id: record.orchestrator_id, run_id: "mismatched-run" }),
        "utf8",
      );
      expect(() => validateCapsuleManifestBinding(record, { manifestPath, assert: true })).toThrow(
        HarnessError,
      );
    });
  });
});
