import { describe, expect, test } from "bun:test";
import { cleanupDispositionIssues } from "../../../olt/scripts/src/runner/attempt-cleanup-disposition.ts";
import { attemptStartedBaseDigest } from "../../../olt/scripts/src/runner/attempt-cleanup-signature.ts";

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

describe("cleanupDispositionIssues malformed history entries", () => {
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
    // Both malformed entries are individually flagged, and because the running anchor was reset
    // to "invalid" after the first, the head-hash check against "invalid" here does not itself
    // add a further mismatch complaint.
    expect(
      issues.filter((issue) => issue === "attempt cleanup disposition is invalid"),
    ).toHaveLength(2);
    expect(issues).not.toContain("attempt cleanup disposition head hash does not match");
  });
});
