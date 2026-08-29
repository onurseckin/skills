import { describe, expect, test } from "bun:test";
import { FailureEvidence } from "../../../olt/scripts/src/engine/runner/receipt/failure-evidence.ts";

describe("FailureEvidence", () => {
  test("starts with no signals found", () => {
    const evidence = new FailureEvidence();
    expect(evidence.snapshot()).toEqual({
      authorization: false,
      networkTransient: false,
      testFailure: false,
    });
  });

  test("accumulates signals across multiple ingests without losing earlier ones", () => {
    const evidence = new FailureEvidence();
    evidence.ingest("401 Unauthorized\n");
    evidence.ingest("connection reset by peer\n");
    expect(evidence.snapshot()).toEqual({
      authorization: true,
      networkTransient: true,
      testFailure: false,
    });
  });

  test("detects a signal split across a chunk boundary via the retained overlap", () => {
    const evidence = new FailureEvidence();
    // "AssertionError" split mid-token across two ingest calls.
    evidence.ingest("boom: Assertio");
    evidence.ingest("nError: expected true");
    expect(evidence.snapshot().testFailure).toBe(true);
  });

  test("caps the retained overlap so unrelated far-apart chunks do not falsely combine", () => {
    const evidence = new FailureEvidence();
    evidence.ingest(`padding ${"x".repeat(200)} Assertio`);
    // The retained overlap is only the last 128 chars, so the prefix "Assertio" is dropped
    // once it is followed by 200 chars of filler on the next ingest, and no match should occur.
    evidence.ingest(`${"y".repeat(200)}nError`);
    expect(evidence.snapshot().testFailure).toBe(false);
  });

  test("snapshot returns an independent copy", () => {
    const evidence = new FailureEvidence();
    const first = evidence.snapshot();
    evidence.ingest("service unavailable");
    const second = evidence.snapshot();
    expect(first.networkTransient).toBe(false);
    expect(second.networkTransient).toBe(true);
  });
});
