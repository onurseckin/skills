import { describe, expect, test } from "bun:test";
import {
  BUN_COMPATIBILITY,
  compatibleBunVersion,
} from "../../../orchestrating-long-tasks/scripts/src/store/bun-compatibility.ts";

// The manifest/capsule-enforcement cases (real initRun, real hand-tampered manifest.json) live in
// tests/integration/store-bun-compatibility.test.ts; this file keeps the pure-function cases only.

describe("compatibleBunVersion", () => {
  test("accepts the exact creating version", () => {
    expect(compatibleBunVersion("1.2.3", "1.2.3", BUN_COMPATIBILITY)).toBe(true);
  });

  test("accepts a newer minor or patch within the same major", () => {
    expect(compatibleBunVersion("1.2.3", "1.2.4", BUN_COMPATIBILITY)).toBe(true);
    expect(compatibleBunVersion("1.2.3", "1.3.0", BUN_COMPATIBILITY)).toBe(true);
  });

  test("rejects an older minor or patch within the same major", () => {
    expect(compatibleBunVersion("1.2.3", "1.2.2", BUN_COMPATIBILITY)).toBe(false);
    expect(compatibleBunVersion("1.3.0", "1.2.9", BUN_COMPATIBILITY)).toBe(false);
  });

  test("rejects a different major in either direction", () => {
    expect(compatibleBunVersion("1.2.3", "2.0.0", BUN_COMPATIBILITY)).toBe(false);
    expect(compatibleBunVersion("2.0.0", "1.9.9", BUN_COMPATIBILITY)).toBe(false);
  });

  test("rejects an unparseable version string on either side", () => {
    expect(compatibleBunVersion("not-a-version", "1.2.3", BUN_COMPATIBILITY)).toBe(false);
    expect(compatibleBunVersion("1.2.3", "not-a-version", BUN_COMPATIBILITY)).toBe(false);
  });

  test("rejects a policy value it does not recognize", () => {
    expect(compatibleBunVersion("1.2.3", "1.2.3", "some-other-policy")).toBe(false);
  });
});
