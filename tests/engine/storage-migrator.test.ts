import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { JsonObject } from "../../olt/scripts/src/core/contracts/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../olt/scripts/src/core/json.ts";
import {
  migrateLegacyCapsules,
  relocateVestigialLedgers,
  validateEventsFileShaChain,
  validateMigratedRun,
} from "../../olt/scripts/src/engine/store/hierarchy/storage-migrator.ts";
import { cleanupVirtualEngineFS, setupVirtualEngineFS } from "./fixture.ts";

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
  let vfs: ReturnType<typeof setupVirtualEngineFS>;

  beforeEach(() => {
    vfs = setupVirtualEngineFS();
    tempDir = `/virtual/migrator-cov-${crypto.randomUUID()}`;
    vfs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualEngineFS();
  });

  it("validates events file sha chain across empty, missing, invalid JSON, structure, and hashes", () => {
    const missingPath = join(tempDir, "nonexistent.jsonl");
    expect(validateEventsFileShaChain(missingPath).valid).toBe(true);

    const emptyPath = join(tempDir, "empty.jsonl");
    vfs.writeFileSync(emptyPath, "   \n\n");
    expect(validateEventsFileShaChain(emptyPath).valid).toBe(true);

    const badJsonPath = join(tempDir, "bad-json.jsonl");
    vfs.writeFileSync(badJsonPath, "{not-json\n");
    const badJsonRes = validateEventsFileShaChain(badJsonPath);
    expect(badJsonRes.valid).toBe(false);
    expect(badJsonRes.error).toContain("is not valid JSON");

    const nonObjPath = join(tempDir, "non-obj.jsonl");
    vfs.writeFileSync(nonObjPath, '["an", "array"]\n');
    expect(validateEventsFileShaChain(nonObjPath).error).toContain("must be a JSON object");

    const badHashPath = join(tempDir, "bad-hash.jsonl");
    vfs.writeFileSync(badHashPath, JSON.stringify({ hash: "not-a-sha", sequence: 1 }) + "\n");
    expect(validateEventsFileShaChain(badHashPath).error).toContain(
      "invalid or missing SHA-256 hash",
    );

    const badPrevHashPath = join(tempDir, "bad-prev.jsonl");
    const dummyHash = "a".repeat(64);
    vfs.writeFileSync(
      badPrevHashPath,
      JSON.stringify({ hash: dummyHash, previous_hash: "wrong", sequence: 1 }) + "\n",
    );
    expect(validateEventsFileShaChain(badPrevHashPath).error).toContain("previous_hash");

    const badSeqPath = join(tempDir, "bad-seq.jsonl");
    vfs.writeFileSync(
      badSeqPath,
      JSON.stringify({ hash: dummyHash, previous_hash: null, sequence: 99 }) + "\n",
    );
    expect(validateEventsFileShaChain(badSeqPath).error).toContain("sequence 99 does not match");

    const hashMismatchPath = join(tempDir, "mismatch.jsonl");
    vfs.writeFileSync(
      hashMismatchPath,
      JSON.stringify({ event: "e", previous_hash: null, sequence: 1, hash: dummyHash }) + "\n",
    );
    expect(validateEventsFileShaChain(hashMismatchPath).error).toContain("hash mismatch");

    const validPath = join(tempDir, "valid.jsonl");
    const rec1 = createValidEventRecord({ type: "start" }, null, 1);
    const rec2 = createValidEventRecord({ type: "finish" }, rec1.hash as string, 2);
    vfs.writeFileSync(validPath, `${JSON.stringify(rec1)}\n${JSON.stringify(rec2)}\n`);
    expect(validateEventsFileShaChain(validPath).valid).toBe(true);
  });

  it("validates migrated run directory checks", () => {
    const nonDir = join(tempDir, "a-file.txt");
    vfs.writeFileSync(nonDir, "hello");
    expect(validateMigratedRun(nonDir).valid).toBe(false);

    const validCapsuleDir = join(tempDir, "capsule-dir");
    vfs.mkdirSync(validCapsuleDir, { recursive: true });
    const rec = createValidEventRecord({ type: "init" }, null, 1);
    vfs.writeFileSync(join(validCapsuleDir, "events.jsonl"), JSON.stringify(rec) + "\n");
    expect(validateMigratedRun(validCapsuleDir).valid).toBe(true);
  });

  it("migrates legacy capsules handling invalid IDs, corrupt chains, collisions, and clean migration", () => {
    const repoRoot = join(tempDir, "repo");
    const legacyDir = join(repoRoot, ".capsules");
    vfs.mkdirSync(legacyDir, { recursive: true });

    // 1. Invalid run ID directory
    const invalidIdDir = join(legacyDir, "-invalid-start-dash-");
    vfs.mkdirSync(invalidIdDir);

    // 2. Corrupt run directory
    const corruptId = "2026-09-01T12-00-00-000Z-corrupt";
    const corruptDir = join(legacyDir, corruptId);
    vfs.mkdirSync(corruptDir);
    vfs.writeFileSync(join(corruptDir, "events.jsonl"), "{bad-json\n");

    // 3. Collision run directory (already exists in target storage)
    const collisionId = "2026-09-01T12-00-00-000Z-collsn";
    const collisionDir = join(legacyDir, collisionId);
    vfs.mkdirSync(collisionDir);
    const recCollision = createValidEventRecord({ type: "c" }, null, 1);
    vfs.writeFileSync(join(collisionDir, "events.jsonl"), JSON.stringify(recCollision) + "\n");
    const targetCollisionDir = join(repoRoot, ".olt", "capsules", collisionId);
    vfs.mkdirSync(targetCollisionDir, { recursive: true });

    // 4. Valid legacy run directory
    const validId = "2026-09-01T12-00-00-000Z-valid1";
    const validRunDir = join(legacyDir, validId);
    vfs.mkdirSync(validRunDir);
    const recValid = createValidEventRecord({ type: "ok" }, null, 1);
    vfs.writeFileSync(join(validRunDir, "events.jsonl"), JSON.stringify(recValid) + "\n");

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
    vfs.mkdirSync(staticOlt, { recursive: true });
    vfs.mkdirSync(targetOlt, { recursive: true });

    // 1. Backlog file with merge
    vfs.writeFileSync(join(staticOlt, "backlog.jsonl"), '{"id":"b1"}\n{"id":"b2"}\n');
    vfs.writeFileSync(join(targetOlt, "backlog.jsonl"), '{"id":"b1"}\n');

    // 2. Defects file without pre-existing target
    vfs.writeFileSync(join(staticOlt, "defects.jsonl"), '{"id":"d1"}\n');

    // 3. Empty telemetry file
    vfs.writeFileSync(join(staticOlt, "telemetry.jsonl"), "\n");

    // 4. Scratch directory
    const staticScratch = join(staticOlt, "scratch");
    vfs.mkdirSync(staticScratch, { recursive: true });
    vfs.writeFileSync(join(staticScratch, "notes.txt"), "scratch notes");

    const res = relocateVestigialLedgers(repoRoot);
    expect(res.relocatedCount).toBe(4);
    expect(res.errors).toEqual([]);

    // Missing olt directory check
    const emptyRepo = join(tempDir, "empty-repo");
    const noOltRes = relocateVestigialLedgers(emptyRepo);
    expect(noOltRes.relocatedCount).toBe(0);
  });

  it("ignores non-directory entries like .DS_Store in .capsules during migration", () => {
    const repoRoot = join(tempDir, "repo-non-dir");
    const legacyDir = join(repoRoot, ".capsules");
    vfs.mkdirSync(legacyDir, { recursive: true });

    // Add regular files that should be ignored
    vfs.writeFileSync(join(legacyDir, ".DS_Store"), "binary-junk");
    vfs.writeFileSync(join(legacyDir, ".gitkeep"), "");
    vfs.writeFileSync(join(legacyDir, "notes.txt"), "some notes");

    // Add one valid capsule
    const validId = "2026-09-01T12-00-00-000Z-valid2";
    const validRunDir = join(legacyDir, validId);
    vfs.mkdirSync(validRunDir);
    const recValid = createValidEventRecord({ type: "ok" }, null, 1);
    vfs.writeFileSync(join(validRunDir, "events.jsonl"), JSON.stringify(recValid) + "\n");

    const result = migrateLegacyCapsules(repoRoot);
    expect(result.migratedCount).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("reports integrity error on torn or truncated event line in events.jsonl", () => {
    const tornPath = join(tempDir, "torn-event.jsonl");
    const validRec = createValidEventRecord({ type: "start" }, null, 1);
    vfs.writeFileSync(tornPath, `${JSON.stringify(validRec)}\n{"sequence": 2, "kind": "unfini`);
    const res = validateEventsFileShaChain(tornPath);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("is not valid JSON");
  });
});
