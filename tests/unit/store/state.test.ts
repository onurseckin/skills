import { describe, expect, test } from "bun:test";
import {
  cloneObject,
  initialState,
  sameJson,
} from "../../../orchestrating-long-tasks/scripts/src/store/state.ts";

describe("initialState", () => {
  test("returns a freshly minted zero-revision state", () => {
    expect(initialState()).toEqual({
      schema: "harness.state",
      version: 1,
      revision: 0,
      event_sequence: 0,
      event_head: null,
    });
  });

  test("returns a new object on every call", () => {
    expect(initialState()).not.toBe(initialState());
  });
});

describe("cloneObject", () => {
  test("deep clones so mutating the clone leaves the original untouched", () => {
    const original = {
      schema: "harness.state" as const,
      version: 1,
      revision: 0,
      event_sequence: 0,
      event_head: null,
      nested: { a: 1 },
    };
    const clone = cloneObject(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    (clone as unknown as { nested: { a: number } }).nested.a = 2;
    expect(original.nested.a).toBe(1);
  });
});

describe("sameJson (re-exported from core/json)", () => {
  test("treats key order as irrelevant", () => {
    expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  test("treats differing values as unequal", () => {
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
  });
});
