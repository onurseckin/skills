import { describe, expect, test } from "bun:test";
import {
  exactInteger,
  validateProjection,
} from "../../../orchestrating-long-tasks/scripts/src/store/event-validation.ts";

describe("exactInteger", () => {
  test("accepts a safe integer equal to the expected value", () => {
    expect(exactInteger(5, 5)).toBe(true);
  });

  test("rejects a mismatched integer, a non-integer number, and a non-number", () => {
    expect(exactInteger(4, 5)).toBe(false);
    expect(exactInteger(5.5, 5.5)).toBe(false);
    expect(exactInteger(Number.MAX_SAFE_INTEGER + 2, Number.MAX_SAFE_INTEGER + 2)).toBe(false);
    expect(exactInteger("5", 5)).toBe(false);
  });
});

describe("validateProjection", () => {
  const validProjection = { schema: "harness.state", version: 1, revision: 3, event_sequence: 3 };

  test("returns no issues for a projection that matches schema, version, revision and sequence", () => {
    expect(validateProjection(validProjection, 3, 3, 7)).toEqual([]);
  });

  test("flags a non-object projection with a single issue naming the line index", () => {
    const found = validateProjection("not-an-object", 3, 3, 7);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: "EVENT_PROJECTION" });
    expect(found[0]?.message).toContain("event line 7");
  });

  test("flags a null and an array projection the same way as a non-object", () => {
    expect(validateProjection(null, 3, 3, 1)).toHaveLength(1);
    expect(validateProjection([], 3, 3, 1)).toHaveLength(1);
  });

  test("flags a projection that circularly embeds event_head", () => {
    const found = validateProjection({ ...validProjection, event_head: null }, 3, 3, 1);
    expect(found.some((entry) => entry.message.includes("circularly includes event_head"))).toBe(
      true,
    );
  });

  test("flags an invalid schema, version, revision and sequence independently", () => {
    expect(
      validateProjection({ ...validProjection, schema: "wrong" }, 3, 3, 1).some((entry) =>
        entry.message.includes("invalid state schema"),
      ),
    ).toBe(true);
    expect(
      validateProjection({ ...validProjection, version: 2 }, 3, 3, 1).some((entry) =>
        entry.message.includes("invalid state version"),
      ),
    ).toBe(true);
    expect(
      validateProjection({ ...validProjection, revision: 9 }, 3, 3, 1).some((entry) =>
        entry.message.includes("revision does not match"),
      ),
    ).toBe(true);
    expect(
      validateProjection({ ...validProjection, event_sequence: 9 }, 3, 3, 1).some((entry) =>
        entry.message.includes("sequence does not match"),
      ),
    ).toBe(true);
  });
});
