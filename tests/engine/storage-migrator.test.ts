import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "../../olt/scripts/src/core/contracts/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../olt/scripts/src/core/json.ts";
import {
  migrateLegacyCapsules,
  relocateVestigialLedgers,
  validateEventsFileShaChain,
  validateMigratedRun,
} from "../../olt/scripts/src/engine/store/hierarchy/storage-migrator.ts";

function createValidEventRecord(
  data: JsonObject,
  previousHash: string | null = null,
  sequence = 1,
): Record<string, unknown> {
  const content = { ...data, previous_hash: previousHash, sequence };
  const hash = sha256Bytes(canonicalJsonBytes(content as JsonObject));
  return { ...content, hash };
}

describe("storage-migrator coverage suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "migrator-cov-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("validates events file sha chain across empty, missing, invalid JSON, structure, and hashes", () => {
    const missingPath = join(tempDir, "nonexistent.jsonl");
    expect(validateEventsFileShaChain(missingPath).valid).toBe(true);

    const emptyPath = join(tempDir, "empty.jsonl");
    writeFileSync(emptyPath, "   \n\n");
    expect(validateEventsFileShaChain(emptyPath).valid).toBe(true);

    const badJsonPath = join(tempDir, "bad-json.jsonl");
    writeFileSync(badJsonPath, "{not-json\n");
    const badJsonRes = validateEventsFileShaChain(badJsonPath);
    expect(badJsonRes.valid).toBe(false);
    expect(badJsonRes.error).toContain("is not valid JSON");

    const nonObjPath = join(tempDir, "non-obj.jsonl");
    writeFileSync(nonObjPath, '["an", "array"]\n');
    expect(validateEventsFileShaChain(nonObjPath).error).toContain("must be a JSON object");

    const badHashPath = join(tempDir, "bad-hash.jsonl");
    writeFileSync(badHashPath, JSON.stringify({ hash: "not-a-sha", sequence: 1 }) + "\n");
    expect(validateEventsFileShaChain(badHashPath).error).toContain(
      "invalid or missing SHA-256 hash",
    );

    const badPrevHashPath = join(tempDir, "bad-prev.jsonl");
    const dummyHash = "a".repeat(64);
    writeFileSync(
      badPrevHashPath,
      JSON.stringify({ hash: dummyHash, previous_hash: "wrong", sequence: 1 }) + "\n",
    );
    expect(validateEventsFileShaChain(badPrevHashPath).error).toContain("previous_hash");

    const badSeqPath = join(tempDir, "bad-seq.jsonl");
    writeFileSync(
      badSeqPath,
      JSON.stringify({ hash: dummyHash, previous_hash: null, sequence: 99 }) + "\n",
    );
    expect(validateEventsFileShaChain(badSeqPath).error).toContain("sequence 99 does not match");

    const hashMismatchPath = join(tempDir, "mismatch.jsonl");
    writeFileSync(
      hashMismatchPath,
      JSON.stringify({ event: "e", previous_hash: null, sequence: 1, hash: dummyHash }) + "\n",
    );
    expect(validateEventsFileShaChain(hashMismatchPath).error).toContain("hash mismatch");

    const validPath = join(tempDir, "valid.jsonl");
    const rec1 = createValidEventRecord({ type: "start" }, null, 1);
    const rec2 = createValidEventRecord({ type: "finish" }, rec1.hash as string, 2);
    writeFileSync(validPath, `${JSON.stringify(rec1)}\n${JSON.stringify(rec2)}\n`);
    expect(validateEventsFileShaChain(validPath).valid).toBe(true);
  });

  it("validates migrated run directory checks", () => {
    const nonDir = join(tempDir, "a-file.txt");
    writeFileSync(nonDir, "hello");
    expect(validateMigratedRun(nonDir).valid).toBe(false);

    const validCapsuleDir = join(tempDir, "capsule-dir");
    mkdirSync(validCapsuleDir, { recursive: true });
    const rec = createValidEventRecord({ type: "init" }, null, 1);
    writeFileSync(join(validCapsuleDir, "events.jsonl"), JSON.stringify(rec) + "\n");
    expect(validateMigratedRun(validCapsuleDir).valid).toBe(true);
  });

  it("migrates legacy capsules handling invalid IDs, corrupt chains, collisions, and clean migration", () => {
    const repoRoot = join(tempDir, "repo");
    const legacyDir = join(repoRoot, ".capsules");
    mkdirSync(legacyDir, { recursive: true });

    // 1. Invalid run ID directory
    const invalidIdDir = join(legacyDir, "-invalid-start-dash-");
    mkdirSync(invalidIdDir);

    // 2. Corrupt run directory
    const corruptId = "2026-09-01T12-00-00-000Z-corrupt";
    const corruptDir = join(legacyDir, corruptId);
    mkdirSync(corruptDir);
    writeFileSync(join(corruptDir, "events.jsonl"), "{bad-json\n");

    // 3. Collision run directory (already exists in target storage)
    const collisionId = "2026-09-01T12-00-00-000Z-collsn";
    const collisionDir = join(legacyDir, collisionId);
    mkdirSync(collisionDir);
    const recCollision = createValidEventRecord({ type: "c" }, null, 1);
    writeFileSync(join(collisionDir, "events.jsonl"), JSON.stringify(recCollision) + "\n");
    const targetCollisionDir = join(repoRoot, ".olt", "capsules", collisionId);
    mkdirSync(targetCollisionDir, { recursive: true });

    // 4. Valid legacy run directory
    const validId = "2026-09-01T12-00-00-000Z-valid1";
    const validRunDir = join(legacyDir, validId);
    mkdirSync(validRunDir);
    const recValid = createValidEventRecord({ type: "ok" }, null, 1);
    writeFileSync(join(validRunDir, "events.jsonl"), JSON.stringify(recValid) + "\n");

    const result = migrateLegacyCapsules(repoRoot);
    expect(result.migratedCount).toBe(1);
    expect(result.errors.length).toBe(3);
    expect(result.errors.some((e) => e.includes("Invalid legacy capsule runId"))).toBe(true);
    expect(result.errors.some((e) => e.includes("failed integrity check"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Target capsule directory already exists"))).toBe(
      true,
    );
  });

  it("relocates vestigial ledgers and scratch files with merge deduplication", () => {
    const repoRoot = join(tempDir, "repo2");
    const staticOlt = join(repoRoot, "olt");
    const targetOlt = join(repoRoot, ".olt");
    mkdirSync(staticOlt, { recursive: true });
    mkdirSync(targetOlt, { recursive: true });

    // 1. Backlog file with merge
    writeFileSync(join(staticOlt, "backlog.jsonl"), '{"id":"b1"}\n{"id":"b2"}\n');
    writeFileSync(join(targetOlt, "backlog.jsonl"), '{"id":"b1"}\n');

    // 2. Defects file without pre-existing target
    writeFileSync(join(staticOlt, "defects.jsonl"), '{"id":"d1"}\n');

    // 3. Empty telemetry file
    writeFileSync(join(staticOlt, "telemetry.jsonl"), "\n");

    // 4. Scratch directory
    const staticScratch = join(staticOlt, "scratch");
    mkdirSync(staticScratch, { recursive: true });
    writeFileSync(join(staticScratch, "notes.txt"), "scratch notes");

    const res = relocateVestigialLedgers(repoRoot);
    expect(res.relocatedCount).toBe(4);
    expect(res.errors).toEqual([]);

    // Missing olt directory check
    const emptyRepo = join(tempDir, "empty-repo");
    const noOltRes = relocateVestigialLedgers(emptyRepo);
    expect(noOltRes.relocatedCount).toBe(0);
  });
});
