import { describe, expect, test } from "bun:test";
import { isRecord, text } from "../../../olt/scripts/src/engine/store/layout-json.ts";

describe("isRecord", () => {
  test("accepts plain objects", () => {
    expect(isRecord({ a: 1 })).toBe(true);
  });

  test("rejects arrays and null", () => {
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });
});

describe("text", () => {
  test("returns non-empty strings unchanged", () => {
    expect(text("hello")).toBe("hello");
  });

  test("returns undefined for an empty string", () => {
    expect(text("")).toBeUndefined();
  });

  test("returns undefined for non-string values", () => {
    expect(text(42)).toBeUndefined();
    expect(text(undefined)).toBeUndefined();
    expect(text(null)).toBeUndefined();
  });
});
