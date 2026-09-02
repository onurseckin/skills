import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../../olt/scripts/src/core/json.ts";
import { verifyEventsHashChain } from "../../../../olt/scripts/src/mind/evidence/hash-chain.ts";

function signEvent(content: Record<string, unknown>): Record<string, unknown> {
  const hash = sha256Bytes(canonicalJsonBytes(content as JsonObject));
  return { ...content, hash };
}

describe("Hash Chain Evidence Verification Suite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "hash-cov-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles missing file, directory read error, and empty file", () => {
    const missingResult = verifyEventsHashChain(join(tmpDir, "non-existent.jsonl"));
    expect(missingResult.verification.valid).toBe(false);
    expect(missingResult.verification.error).toContain("Events file not found");

    // Reading a directory path triggers read error
    const dirResult = verifyEventsHashChain(tmpDir);
    expect(dirResult.verification.valid).toBe(false);
    expect(dirResult.verification.error).toContain("Failed to read events file");

    const emptyPath = join(tmpDir, "empty.jsonl");
    writeFileSync(emptyPath, "   \n\n  ", "utf-8");
    const emptyResult = verifyEventsHashChain(emptyPath);
    expect(emptyResult.verification.valid).toBe(true);
    expect(emptyResult.verification.totalEvents).toBe(0);
    expect(emptyResult.verification.headHash).toBeNull();
  });

  it("detects malformed JSON lines and non-object records", () => {
    const malformedPath = join(tmpDir, "malformed.jsonl");
    writeFileSync(malformedPath, "{invalid json\n", "utf-8");
    const malformedResult = verifyEventsHashChain(malformedPath);
    expect(malformedResult.verification.valid).toBe(false);
    expect(malformedResult.verification.error).toContain("Line 1 is invalid JSON");

    const nonObjectPath = join(tmpDir, "non-object.jsonl");
    writeFileSync(nonObjectPath, '["an", "array"]\n', "utf-8");
    const nonObjResult = verifyEventsHashChain(nonObjectPath);
    expect(nonObjResult.verification.valid).toBe(false);
    expect(nonObjResult.verification.error).toContain("must be a JSON object");
  });

  it("validates hash field formatting and sequence 1 previous_hash invariant", () => {
    const invalidHashPath = join(tmpDir, "invalid-hash.jsonl");
    writeFileSync(
      invalidHashPath,
      JSON.stringify({ sequence: 1, hash: "not-a-valid-sha256" }) + "\n",
      "utf-8",
    );
    const invHashResult = verifyEventsHashChain(invalidHashPath);
    expect(invHashResult.verification.valid).toBe(false);
    expect(invHashResult.verification.error).toContain("invalid SHA-256 hash");

    const badSeq1Path = join(tmpDir, "bad-seq1.jsonl");
    const dummyHash = "a".repeat(64);
    writeFileSync(
      badSeq1Path,
      JSON.stringify({ sequence: 1, previous_hash: "unexpected_hash", hash: dummyHash }) + "\n",
      "utf-8",
    );
    const badSeq1Result = verifyEventsHashChain(badSeq1Path);
    expect(badSeq1Result.verification.valid).toBe(false);
    expect(badSeq1Result.verification.error).toContain("Sequence 1 must have null previous_hash");
  });

  it("detects previous_hash linkage breakage and sequence jumps", () => {
    const ev1 = signEvent({ sequence: 1, previous_hash: null, type: "init" });
    const ev2BadLink = signEvent({ sequence: 2, previous_hash: "b".repeat(64), type: "pulse" });

    const brokenLinkPath = join(tmpDir, "broken-link.jsonl");
    writeFileSync(
      brokenLinkPath,
      `${JSON.stringify(ev1)}\n${JSON.stringify(ev2BadLink)}\n`,
      "utf-8",
    );
    const brokenLinkResult = verifyEventsHashChain(brokenLinkPath);
    expect(brokenLinkResult.verification.valid).toBe(false);
    expect(brokenLinkResult.verification.error).toContain("previous_hash");

    const ev2BadSeq = signEvent({ sequence: 5, previous_hash: ev1["hash"], type: "pulse" });
    const brokenSeqPath = join(tmpDir, "broken-seq.jsonl");
    writeFileSync(brokenSeqPath, `${JSON.stringify(ev1)}\n${JSON.stringify(ev2BadSeq)}\n`, "utf-8");
    const brokenSeqResult = verifyEventsHashChain(brokenSeqPath);
    expect(brokenSeqResult.verification.valid).toBe(false);
    expect(brokenSeqResult.verification.error).toContain("does not match expected sequence 2");
  });

  it("detects hash mismatch when payload content is tampered", () => {
    const ev1 = signEvent({ sequence: 1, previous_hash: null, data: "original" });
    const tampered = { ...ev1, data: "tampered" };

    const tamperedPath = join(tmpDir, "tampered.jsonl");
    writeFileSync(tamperedPath, JSON.stringify(tampered) + "\n", "utf-8");
    const tamperedResult = verifyEventsHashChain(tamperedPath);
    expect(tamperedResult.verification.valid).toBe(false);
    expect(tamperedResult.verification.error).toContain("hash mismatch");
  });

  it("successfully verifies valid multi-event cryptographic hash chains", () => {
    const ev1 = signEvent({
      sequence: 1,
      previous_hash: null,
      type: "init",
      payload: { count: 1 },
    });
    const ev2 = signEvent({
      sequence: 2,
      previous_hash: ev1["hash"],
      type: "pulse",
      payload: { count: 2 },
    });
    const ev3 = signEvent({
      sequence: 3,
      previous_hash: ev2["hash"],
      type: "commit",
      payload: { count: 3 },
    });

    const validPath = join(tmpDir, "valid-chain.jsonl");
    writeFileSync(
      validPath,
      `${JSON.stringify(ev1)}\n\n${JSON.stringify(ev2)}\n${JSON.stringify(ev3)}\n`,
      "utf-8",
    );

    const result = verifyEventsHashChain(validPath);
    expect(result.verification.valid).toBe(true);
    expect(result.verification.totalEvents).toBe(3);
    expect(result.verification.headHash).toBe(ev3["hash"] as string);
    expect(result.events.length).toBe(3);
    expect(result.events[0]?.["type"]).toBe("init");
    expect(result.events[2]?.["type"]).toBe("commit");
  });
});
