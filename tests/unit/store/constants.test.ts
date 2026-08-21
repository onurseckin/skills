import { describe, expect, test } from "bun:test";
import {
  RUN_ID_PATTERN,
  SHA256_PATTERN,
  CAPSULE_ID_PATTERN,
  limits,
} from "../../../orchestrating-long-tasks/scripts/src/store/constants.ts";

describe("limits", () => {
  test("fills in every default when no overrides are given", () => {
    expect(limits()).toEqual({
      maxJsonBytes: 64 * 1024 * 1024,
      maxEventBytes: 64 * 1024 * 1024,
      maxEventLogBytes: 256 * 1024 * 1024,
      maxEventCount: 100_000,
      maxDepth: 128,
    });
  });

  test("preserves each override while defaulting the rest", () => {
    expect(limits({ maxJsonBytes: 10, maxDepth: 2 })).toEqual({
      maxJsonBytes: 10,
      maxEventBytes: 64 * 1024 * 1024,
      maxEventLogBytes: 256 * 1024 * 1024,
      maxEventCount: 100_000,
      maxDepth: 2,
    });
  });
});

describe("RUN_ID_PATTERN", () => {
  test("accepts single characters and slugs with internal separators", () => {
    expect(RUN_ID_PATTERN.test("a")).toBe(true);
    expect(RUN_ID_PATTERN.test("my-run.id_2")).toBe(true);
  });

  test("rejects leading separators and path traversal", () => {
    expect(RUN_ID_PATTERN.test("-leading")).toBe(false);
    expect(RUN_ID_PATTERN.test("a/b")).toBe(false);
    expect(RUN_ID_PATTERN.test("")).toBe(false);
  });
});

describe("SHA256_PATTERN and CAPSULE_ID_PATTERN", () => {
  test("accept lowercase hex of the exact expected length", () => {
    expect(SHA256_PATTERN.test("a".repeat(64))).toBe(true);
    expect(CAPSULE_ID_PATTERN.test("a".repeat(32))).toBe(true);
  });

  test("reject uppercase hex or the wrong length", () => {
    expect(SHA256_PATTERN.test("A".repeat(64))).toBe(false);
    expect(SHA256_PATTERN.test("a".repeat(63))).toBe(false);
    expect(CAPSULE_ID_PATTERN.test("a".repeat(31))).toBe(false);
  });
});
