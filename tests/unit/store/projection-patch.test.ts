import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import {
  applyProjectionPatch,
  diffProjection,
} from "../../../orchestrating-long-tasks/scripts/src/store/projection-patch.ts";

describe("diffProjection", () => {
  test("returns no ops for two identical objects", () => {
    expect(diffProjection({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
  });

  test("emits a set op for an added top-level key", () => {
    expect(diffProjection({}, { added: "value" })).toEqual([
      { op: "set", path: ["added"], value: "value" },
    ]);
  });

  test("emits an unset op for a removed top-level key", () => {
    expect(diffProjection({ gone: "value" }, {})).toEqual([{ op: "unset", path: ["gone"] }]);
  });

  test("emits a set op for a changed primitive value", () => {
    expect(diffProjection({ count: 1 }, { count: 2 })).toEqual([
      { op: "set", path: ["count"], value: 2 },
    ]);
  });

  test("recurses into nested objects and reports only the leaf that changed", () => {
    const before = { agents: { a1: { status: "idle" }, a2: { status: "idle" } } };
    const after = { agents: { a1: { status: "busy" }, a2: { status: "idle" } } };
    expect(diffProjection(before, after)).toEqual([
      { op: "set", path: ["agents", "a1", "status"], value: "busy" },
    ]);
  });

  test("replaces the whole subtree in one op when a nested object becomes a non-object", () => {
    const before = { field: { nested: true } };
    const after = { field: "now-a-string" };
    expect(diffProjection(before, after)).toEqual([
      { op: "set", path: ["field"], value: "now-a-string" },
    ]);
  });

  test("treats arrays as atomic values, replacing the whole array on any change", () => {
    const before = { list: [1, 2, 3] };
    const after = { list: [1, 2, 4] };
    expect(diffProjection(before, after)).toEqual([
      { op: "set", path: ["list"], value: [1, 2, 4] },
    ]);
  });

  test("does not emit an op for an unchanged array", () => {
    expect(diffProjection({ list: [1, 2] }, { list: [1, 2] })).toEqual([]);
  });

  test("adds a nested key inside an object that exists on both sides", () => {
    const before = { agents: { a1: { status: "idle" } } };
    const after = { agents: { a1: { status: "idle" }, a2: { status: "idle" } } };
    expect(diffProjection(before, after)).toEqual([
      { op: "set", path: ["agents", "a2"], value: { status: "idle" } },
    ]);
  });
});

describe("applyProjectionPatch", () => {
  test("round-trips: applying diffProjection(before, after) to before reproduces after", () => {
    const before: JsonObject = {
      agents: { a1: { status: "idle" }, a2: { status: "busy" } },
      tasks: { "T-1": { state: "open" } },
      stale: true,
    };
    const after: JsonObject = {
      agents: { a1: { status: "busy" }, a2: { status: "busy" } },
      tasks: { "T-1": { state: "open" }, "T-2": { state: "open" } },
    };
    const patch = diffProjection(before, after);
    expect(applyProjectionPatch(before, patch)).toEqual(after);
  });

  test("does not mutate the object passed as the base", () => {
    const before: JsonObject = { a: 1 };
    const patch = diffProjection(before, { a: 2 });
    applyProjectionPatch(before, patch);
    expect(before).toEqual({ a: 1 });
  });

  test("creates missing intermediate objects when applying a nested set", () => {
    const result = applyProjectionPatch({}, [
      { op: "set", path: ["agents", "a1", "status"], value: "busy" },
    ]);
    expect(result).toEqual({ agents: { a1: { status: "busy" } } });
  });

  test("unset removes only the named key, leaving siblings intact", () => {
    const result = applyProjectionPatch({ a: 1, b: 2 }, [{ op: "unset", path: ["a"] }]);
    expect(result).toEqual({ b: 2 });
  });

  test("applying an empty patch list returns an equal but distinct object", () => {
    const before = { a: 1 };
    const result = applyProjectionPatch(before, []);
    expect(result).toEqual(before);
    expect(result).not.toBe(before);
  });
});
