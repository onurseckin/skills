import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  boundedReason,
  MAX_CLEANUP_REASON_BYTES,
  verificationKey,
  attemptStartedBaseDigest,
} from "../../../olt/scripts/src/engine/runner/execution/attempt-cleanup-signature.ts";
import { cleanupDispositionIssues } from "../../../olt/scripts/src/engine/runner/execution/attempt-cleanup-disposition.ts";

describe("boundedReason", () => {
  test("returns a short reason unchanged", () => {
    expect(boundedReason("cleanup uncertain")).toBe("cleanup uncertain");
  });

  test("falls back to a default message for an empty reason", () => {
    expect(boundedReason("")).toBe("unrecorded cleanup outcome");
  });

  test("truncates a reason exceeding the byte budget down to a UTF-8-safe prefix", () => {
    const longReason = "x".repeat(MAX_CLEANUP_REASON_BYTES + 100);
    const bounded = boundedReason(longReason);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(MAX_CLEANUP_REASON_BYTES);
    expect(bounded.length).toBe(MAX_CLEANUP_REASON_BYTES);
    expect(bounded).toBe("x".repeat(MAX_CLEANUP_REASON_BYTES));
  });

  test("truncates a multi-byte reason without splitting a character mid-codepoint", () => {
    const longReason = "é".repeat(MAX_CLEANUP_REASON_BYTES);
    const bounded = boundedReason(longReason);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(MAX_CLEANUP_REASON_BYTES);
    expect(Buffer.from(bounded, "utf8").toString("utf8")).toBe(bounded);
    expect(bounded.length).toBe(MAX_CLEANUP_REASON_BYTES / 2);
  });

  test("returns the exact string when it lands precisely on the byte budget", () => {
    const exact = "x".repeat(MAX_CLEANUP_REASON_BYTES);
    expect(boundedReason(exact)).toBe(exact);
  });
});

describe("verificationKey key-type guard", () => {
  test("rejects a well-formed, correctly canonical public key of a non-ed25519 type", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const der = publicKey.export({ format: "der", type: "spki" });
    expect(der.byteLength).toBeLessThan(128);
    expect(verificationKey(der.toString("base64"))).toBeUndefined();
  });

  test("rejects bytes that pass the size and base64 checks but are not valid DER/SPKI at all", () => {
    const garbage = Buffer.alloc(32, 0xff).toString("base64");
    expect(verificationKey(garbage)).toBeUndefined();
  });
});

describe("cleanupDispositionIssues malformed history entries", () => {
  function baseRecord() {
    const base = {
      schema: "harness.command-attempt-started",
      version: 1 as const,
      command_id: "C-1",
      attempt: 1,
      status: "running" as const,
      started_at: "2026-08-19T00:00:00.000Z",
      ownership_token_sha256: "a".repeat(64),
      verification_public_key: "",
    };
    return { ...base, base_sha256: attemptStartedBaseDigest(base) };
  }

  test("flags a null history entry and resets the running chain anchor instead of throwing", () => {
    const record = {
      ...baseRecord(),
      root_pid_identity: null,
      disposition_head_sha256: "not-a-real-hash",
      cleanup_disposition: null,
      cleanup_history: [null as never],
    };
    const issues = cleanupDispositionIssues(record, "");
    expect(issues).toContain("attempt cleanup disposition is invalid");
  });

  test("continues validating later entries against the reset 'invalid' chain anchor", () => {
    const record = {
      ...baseRecord(),
      root_pid_identity: null,
      disposition_head_sha256: "invalid",
      cleanup_disposition: null,
      cleanup_history: [null as never, null as never],
    };
    const issues = cleanupDispositionIssues(record, "");
    expect(
      issues.filter((issue) => issue === "attempt cleanup disposition is invalid"),
    ).toHaveLength(2);
    expect(issues).not.toContain("attempt cleanup disposition head hash does not match");
  });
});
