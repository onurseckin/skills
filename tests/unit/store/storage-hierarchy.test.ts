import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import {
  assertSafeStoragePath,
  resolveCapsulePaths,
  resolveStoragePaths,
} from "../../../olt/scripts/src/engine/store/hierarchy/storage-paths.ts";
import {
  migrateLegacyCapsules,
  relocateVestigialLedgers,
  validateEventsFileShaChain,
  validateMigratedRun,
} from "../../../olt/scripts/src/engine/store/hierarchy/storage-migrator.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function createValidEvent(
  runId: string,
  sequence: number,
  previousHash: string | null,
  payload: Record<string, unknown> = {},
) {
  const content = {
    actor: "test-runner",
    capsule_id: "0123456789abcdef0123456789abcdef",
    kind: "action",
    payload,
    previous_hash: previousHash,
    revision: sequence,
    run_id: runId,
    schema: "harness_event_schema",
    sequence,
    timestamp: "2026-08-29T10:00:00.000Z",
  };
  const hash = sha256Bytes(canonicalJsonBytes(content as JsonObject));
  return { ...content, hash };
}

describe("Storage Hierarchy & Migration Engine", () => {
  describe("resolveStoragePaths", () => {
    it("resolves all canonical storage paths strictly within .olt/", () => {
      const root = scratchRoot(import.meta.path, "storage-paths-basic");
      const paths = resolveStoragePaths(root);

      expect(paths.repoRoot).toBe(root);
      expect(paths.oltDir).toBe(join(root, ".olt"));
      expect(paths.capsulesDir).toBe(join(root, ".olt", "capsules"));
      expect(paths.globalBacklogPath).toBe(join(root, ".olt", "backlog.jsonl"));
      expect(paths.globalDefectsPath).toBe(join(root, ".olt", "defects.jsonl"));
      expect(paths.globalPolicyPath).toBe(join(root, ".olt", "policy.json"));
      expect(paths.globalTelemetryPath).toBe(join(root, ".olt", "telemetry.jsonl"));
      expect(paths.globalMailboxesDir).toBe(join(root, ".olt", "mailboxes"));
      expect(paths.scratchDir).toBe(join(root, ".olt", "scratch"));
    });
  });

  describe("resolveCapsulePaths", () => {
    it("resolves all immutable capsule file paths for a valid runId", () => {
      const root = scratchRoot(import.meta.path, "capsule-paths-valid");
      const capsule = resolveCapsulePaths("run-2026-08-29-01", root);

      expect(capsule.runRoot).toBe(join(root, ".olt", "capsules", "run-2026-08-29-01"));
      expect(capsule.manifestPath).toBe(join(capsule.runRoot, "manifest.json"));
      expect(capsule.eventsPath).toBe(join(capsule.runRoot, "events.jsonl"));
      expect(capsule.statePath).toBe(join(capsule.runRoot, "state.json"));
      expect(capsule.sparseIndexPath).toBe(join(capsule.runRoot, "sparse-index.json"));
      expect(capsule.snapshotsDir).toBe(join(capsule.runRoot, "snapshots"));
      expect(capsule.blobsDir).toBe(join(capsule.runRoot, "blobs"));
      expect(capsule.tracePath).toBe(join(capsule.runRoot, "trace.md"));
    });

    it("normalizes optional capsules prefix before resolving", () => {
      const root = scratchRoot(import.meta.path, "capsule-paths-prefix");
      const capsule = resolveCapsulePaths(".olt/capsules/run-prefix-01", root);
      expect(capsule.runRoot).toBe(join(root, ".olt", "capsules", "run-prefix-01"));
    });

    it("throws HarnessError on invalid or traversal runId", () => {
      const root = scratchRoot(import.meta.path, "capsule-paths-invalid");
      expect(() => resolveCapsulePaths("", root)).toThrow(HarnessError);
      expect(() => resolveCapsulePaths("   ", root)).toThrow(HarnessError);
      expect(() => resolveCapsulePaths("../escape", root)).toThrow(HarnessError);
      expect(() => resolveCapsulePaths("sub/nested/run", root)).toThrow(HarnessError);
      expect(() => resolveCapsulePaths("invalid space", root)).toThrow(HarnessError);
    });
  });

  describe("assertSafeStoragePath", () => {
    it("accepts valid storage paths within .olt/", () => {
      const root = scratchRoot(import.meta.path, "assert-safe-valid");
      expect(() => assertSafeStoragePath(join(root, ".olt", "backlog.jsonl"), root)).not.toThrow();
      expect(() =>
        assertSafeStoragePath(join(root, ".olt", "capsules", "run-01", "events.jsonl"), root),
      ).not.toThrow();
      expect(() =>
        assertSafeStoragePath(join(root, ".olt", "scratch", "tmp.txt"), root),
      ).not.toThrow();
    });

    it("rejects runtime ledgers targeting static package root olt/ with PATH_SAFETY", () => {
      const root = scratchRoot(import.meta.path, "assert-safe-vestigial-olt");
      expect(() => assertSafeStoragePath("olt/backlog.jsonl", root)).toThrow(HarnessError);
      expect(() => assertSafeStoragePath("olt/defects.jsonl", root)).toThrow(HarnessError);
      expect(() => assertSafeStoragePath(join(root, "olt", "capsules", "run-1"), root)).toThrow(
        HarnessError,
      );
      try {
        assertSafeStoragePath("olt/backlog.jsonl", root);
      } catch (err) {
        expect((err as HarnessError).code).toBe("PATH_SAFETY");
      }
    });

    it("rejects path traversal escaping root and blank strings", () => {
      const root = scratchRoot(import.meta.path, "assert-safe-traversal");
      expect(() => assertSafeStoragePath("../outside", root)).toThrow(HarnessError);
      expect(() => assertSafeStoragePath(join(root, "..", "escape.jsonl"), root)).toThrow(
        HarnessError,
      );
      expect(() => assertSafeStoragePath("", root)).toThrow(HarnessError);
      expect(() => assertSafeStoragePath("   ", root)).toThrow(HarnessError);
      expect(() => assertSafeStoragePath("safe/path\0null", root)).toThrow(HarnessError);
    });

    it("rejects invalid runId inside capsules path", () => {
      const root = scratchRoot(import.meta.path, "assert-safe-invalid-runid");
      expect(() =>
        assertSafeStoragePath(
          join(root, ".olt", "capsules", "invalid run id", "events.jsonl"),
          root,
        ),
      ).toThrow(HarnessError);
    });
  });

  describe("validateEventsFileShaChain & validateMigratedRun", () => {
    it("validates empty or well-formed sha256 event chains", () => {
      const root = scratchRoot(import.meta.path, "events-valid-chain");
      const eventsPath = join(root, "events.jsonl");

      expect(validateEventsFileShaChain(eventsPath).valid).toBe(true);

      const ev1 = createValidEvent("run-test-1", 1, null, { step: 1 });
      const ev2 = createValidEvent("run-test-1", 2, ev1.hash, { step: 2 });
      writeFileSync(eventsPath, `${JSON.stringify(ev1)}\n${JSON.stringify(ev2)}\n`, "utf-8");

      expect(validateEventsFileShaChain(eventsPath).valid).toBe(true);
    });

    it("detects corrupted hashes and broken chains", () => {
      const root = scratchRoot(import.meta.path, "events-corrupt-chain");
      const eventsPath = join(root, "events.jsonl");

      const ev1 = createValidEvent("run-test-2", 1, null, { step: 1 });
      const ev2 = {
        ...createValidEvent("run-test-2", 2, ev1.hash, { step: 2 }),
        hash: "00".repeat(32),
      };
      writeFileSync(eventsPath, `${JSON.stringify(ev1)}\n${JSON.stringify(ev2)}\n`, "utf-8");

      const res = validateEventsFileShaChain(eventsPath);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/hash mismatch/i);
    });
  });

  describe("migrateLegacyCapsules", () => {
    it("migrates valid legacy capsules from .capsules and olt/capsules into .olt/capsules", () => {
      const root = scratchRoot(import.meta.path, "migrate-legacy-valid");
      const legacy1 = join(root, ".capsules", "legacy-run-01");
      const legacy2 = join(root, "olt", "capsules", "legacy-run-02");
      mkdirSync(legacy1, { recursive: true });
      mkdirSync(legacy2, { recursive: true });

      const ev1 = createValidEvent("legacy-run-01", 1, null);
      writeFileSync(join(legacy1, "events.jsonl"), `${JSON.stringify(ev1)}\n`, "utf-8");
      writeFileSync(
        join(legacy1, "manifest.json"),
        JSON.stringify({ run_id: "legacy-run-01" }),
        "utf-8",
      );

      const ev2 = createValidEvent("legacy-run-02", 1, null);
      writeFileSync(join(legacy2, "events.jsonl"), `${JSON.stringify(ev2)}\n`, "utf-8");
      writeFileSync(
        join(legacy2, "manifest.json"),
        JSON.stringify({ run_id: "legacy-run-02" }),
        "utf-8",
      );

      const result = migrateLegacyCapsules(root);
      expect(result.migratedCount).toBe(2);
      expect(result.errors.length).toBe(0);

      expect(existsSync(join(root, ".olt", "capsules", "legacy-run-01"))).toBe(true);
      expect(existsSync(join(root, ".olt", "capsules", "legacy-run-02"))).toBe(true);
      expect(existsSync(legacy1)).toBe(false);
      expect(existsSync(legacy2)).toBe(false);

      expect(validateMigratedRun(join(root, ".olt", "capsules", "legacy-run-01")).valid).toBe(true);
    });

    it("refuses to migrate legacy capsule with broken hash chain and prevents target corruption", () => {
      const root = scratchRoot(import.meta.path, "migrate-legacy-corrupted");
      const legacyDir = join(root, ".capsules", "corrupted-run-01");
      mkdirSync(legacyDir, { recursive: true });

      const badEvent = {
        actor: "test",
        hash: "badhashbadhashbadhashbadhashbadhashbadhashbadhashbadhashbadhash1234",
        previous_hash: null,
        sequence: 1,
      };
      writeFileSync(join(legacyDir, "events.jsonl"), `${JSON.stringify(badEvent)}\n`, "utf-8");

      const result = migrateLegacyCapsules(root);
      expect(result.migratedCount).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toMatch(/failed integrity check/i);

      expect(existsSync(join(root, ".olt", "capsules", "corrupted-run-01"))).toBe(false);
      expect(existsSync(legacyDir)).toBe(true);
    });
  });

  describe("relocateVestigialLedgers", () => {
    it("relocates vestigial ledger files and scratch from olt/ to .olt/", () => {
      const root = scratchRoot(import.meta.path, "relocate-vestigial");
      const staticOlt = join(root, "olt");
      const targetOlt = join(root, ".olt");
      mkdirSync(staticOlt, { recursive: true });
      mkdirSync(targetOlt, { recursive: true });

      // Existing target backlog with item A
      writeFileSync(
        join(targetOlt, "backlog.jsonl"),
        JSON.stringify({ id: "item-A" }) + "\n",
        "utf-8",
      );

      // Vestigial backlog with item A and item B (tests merging without duplicate A)
      writeFileSync(
        join(staticOlt, "backlog.jsonl"),
        `${JSON.stringify({ id: "item-A" })}\n${JSON.stringify({ id: "item-B" })}\n`,
        "utf-8",
      );

      // Vestigial defects
      writeFileSync(
        join(staticOlt, "defects.jsonl"),
        JSON.stringify({ defect: "d1" }) + "\n",
        "utf-8",
      );

      // Vestigial scratch
      const vestigialScratch = join(staticOlt, "scratch");
      mkdirSync(vestigialScratch, { recursive: true });
      writeFileSync(join(vestigialScratch, "temp.log"), "sample-log", "utf-8");

      const result = relocateVestigialLedgers(root);
      expect(result.migratedCount ?? result.relocatedCount).toBe(3);
      expect(result.errors.length).toBe(0);

      // Verify olt/ ledgers removed
      expect(existsSync(join(staticOlt, "backlog.jsonl"))).toBe(false);
      expect(existsSync(join(staticOlt, "defects.jsonl"))).toBe(false);
      expect(existsSync(vestigialScratch)).toBe(false);

      // Verify .olt/ target has merged contents
      const mergedBacklog = readFileSync(join(targetOlt, "backlog.jsonl"), "utf-8")
        .trim()
        .split("\n");
      expect(mergedBacklog.length).toBe(2);
      expect(mergedBacklog[0]).toBe(JSON.stringify({ id: "item-A" }));
      expect(mergedBacklog[1]).toBe(JSON.stringify({ id: "item-B" }));

      expect(existsSync(join(targetOlt, "defects.jsonl"))).toBe(true);
      expect(existsSync(join(targetOlt, "scratch", "temp.log"))).toBe(true);
    });
  });
});
