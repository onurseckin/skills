import { describe, expect, test } from "bun:test";
import {
  exactInteger,
  validateProjection,
  validateProjectionField,
  validateProjectionPatch,
} from "../../../../olt/scripts/src/engine/store/events/event-validation.ts";

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

describe("validateProjectionPatch", () => {
  test("returns no issues for a well-formed patch of set and unset ops", () => {
    expect(
      validateProjectionPatch(
        [
          { op: "set", path: ["agents", "a1", "status"], value: "busy" },
          { op: "unset", path: ["stale"] },
        ],
        7,
      ),
    ).toEqual([]);
  });

  test("flags a non-array patch with a single issue naming the line index", () => {
    const found = validateProjectionPatch("not-an-array", 7);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: "EVENT_PROJECTION_PATCH" });
    expect(found[0]?.message).toContain("event line 7");
  });

  test("flags a patch entry that is not an object", () => {
    const found = validateProjectionPatch(["not-an-object"], 1);
    expect(found.some((entry) => entry.message.includes("patch op 0 must be an object"))).toBe(
      true,
    );
  });

  test("flags a patch entry with an invalid op", () => {
    const found = validateProjectionPatch([{ op: "replace", path: ["a"] }], 1);
    expect(found.some((entry) => entry.message.includes("invalid op"))).toBe(true);
  });

  test("flags a patch entry whose path is missing, empty, or contains a non-string segment", () => {
    expect(
      validateProjectionPatch([{ op: "set", value: 1 }], 1).some((entry) =>
        entry.message.includes("invalid path"),
      ),
    ).toBe(true);
    expect(
      validateProjectionPatch([{ op: "set", path: [], value: 1 }], 1).some((entry) =>
        entry.message.includes("invalid path"),
      ),
    ).toBe(true);
    expect(
      validateProjectionPatch([{ op: "set", path: [1], value: 1 }], 1).some((entry) =>
        entry.message.includes("invalid path"),
      ),
    ).toBe(true);
  });

  test("flags a set op that is missing its value, even when the path is valid", () => {
    const found = validateProjectionPatch([{ op: "set", path: ["a"] }], 1);
    expect(found.some((entry) => entry.message.includes("missing a value"))).toBe(true);
  });

  test("does not require a value on an unset op", () => {
    expect(validateProjectionPatch([{ op: "unset", path: ["a"] }], 1)).toEqual([]);
  });

  test("flags a patch op whose path touches a reserved state field", () => {
    const found = validateProjectionPatch([{ op: "unset", path: ["event_sequence"] }], 1);
    expect(found.some((entry) => entry.message.includes("touches reserved field"))).toBe(true);
  });

  test("returns no issues for a well-formed splice patch op", () => {
    expect(
      validateProjectionPatch(
        [
          { op: "splice", path: ["items"], start: 2, deleteCount: 1, items: ["x", "y"] },
          { op: "splice", path: ["tasks"], start: 0, deleteCount: 2 },
        ],
        7,
      ),
    ).toEqual([]);
  });

  test("flags splice ops with invalid start, deleteCount, or items", () => {
    expect(
      validateProjectionPatch([{ op: "splice", path: ["a"], start: -1, deleteCount: 0 }], 1).some(
        (entry) => entry.message.includes("invalid splice start"),
      ),
    ).toBe(true);
    expect(
      validateProjectionPatch([{ op: "splice", path: ["a"], start: 0, deleteCount: -1 }], 1).some(
        (entry) => entry.message.includes("invalid splice deleteCount"),
      ),
    ).toBe(true);
    expect(
      validateProjectionPatch(
        [{ op: "splice", path: ["a"], start: 0, deleteCount: 0, items: "not-array" }],
        1,
      ).some((entry) => entry.message.includes("splice items must be an array")),
    ).toBe(true);
  });
});

describe("validateProjectionField", () => {
  const patch = [{ op: "set" as const, path: ["a"], value: 1 }];
  const projection = { schema: "harness.state", version: 1, revision: 3, event_sequence: 3 };

  test("validates a checkpoint projection when only projection is present", () => {
    expect(validateProjectionField(projection, null, 3, 3, 1)).toEqual([]);
  });

  test("validates a patch when only projection_patch is present", () => {
    expect(validateProjectionField(null, patch, 3, 3, 1)).toEqual([]);
  });

  test("treats an absent (undefined) projection_patch the same as null", () => {
    expect(validateProjectionField(projection, undefined, 3, 3, 1)).toEqual([]);
  });

  test("flags an event that carries neither a projection nor a patch", () => {
    const found = validateProjectionField(null, null, 3, 3, 1);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("must carry a checkpoint projection or a patch");
  });

  test("flags an event that carries both a projection and a patch", () => {
    const found = validateProjectionField(projection, patch, 3, 3, 1);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("must not carry both");
  });

  test("propagates the underlying projection issue when only projection is malformed", () => {
    const found = validateProjectionField({ ...projection, schema: "wrong" }, null, 3, 3, 1);
    expect(found.some((entry) => entry.code === "EVENT_PROJECTION")).toBe(true);
  });

  test("propagates the underlying patch issue when only projection_patch is malformed", () => {
    const found = validateProjectionField(null, "not-an-array", 3, 3, 1);
    expect(found.some((entry) => entry.code === "EVENT_PROJECTION_PATCH")).toBe(true);
  });
});
