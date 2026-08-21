import { describe, expect, test } from "bun:test";
import {
  boundedReason,
  MAX_CLEANUP_REASON_BYTES,
} from "../../../orchestrating-long-tasks/scripts/src/runner/attempt-cleanup-signature.ts";

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
    // Each "é" is 2 UTF-8 bytes, so a naive character-count truncation at the byte budget would
    // cut a codepoint in half; the binary search must always land on a whole-character boundary.
    const longReason = "é".repeat(MAX_CLEANUP_REASON_BYTES);
    const bounded = boundedReason(longReason);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(MAX_CLEANUP_REASON_BYTES);
    // Re-encoding and decoding must round-trip cleanly (no replacement characters from a split).
    expect(Buffer.from(bounded, "utf8").toString("utf8")).toBe(bounded);
    expect(bounded.length).toBe(MAX_CLEANUP_REASON_BYTES / 2);
  });

  test("returns the exact string when it lands precisely on the byte budget", () => {
    const exact = "x".repeat(MAX_CLEANUP_REASON_BYTES);
    expect(boundedReason(exact)).toBe(exact);
  });
});
