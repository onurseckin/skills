import { describe, expect, test } from "bun:test";
import {
  applyProjectionPatch,
  diffProjection,
} from "../../../../olt/scripts/src/engine/store/projections/projection-patch.ts";

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

  test("emits a suffix set when an array only gains an appended item", () => {
    const before = { list: [1, 2, 3] };
    const after = { list: [1, 2, 3, 4] };
    expect(diffProjection(before, after)).toEqual([{ op: "set", path: ["list", "3"], value: 4 }]);
    expect(applyProjectionPatch(before, diffProjection(before, after))).toEqual(after);
  });

  test("serializes a 100-item prefix append without repeating that prefix", () => {
    const prefix = Array.from({ length: 100 }, (_, index) => index);
    expect(diffProjection({ list: prefix }, { list: [...prefix, 100] })).toEqual([
      { op: "set", path: ["list", "100"], value: 100 },
    ]);
  });

  test("keeps a large-prefix patch proportional to ordered appended values", () => {
    const prefix = [
      "distinctive-prefix-marker-that-must-not-be-serialized",
      ...Array.from({ length: 500 }, (_, index) => index),
    ];
    const suffix = ["suffix-one", "suffix-two", "suffix-three"];
    const patch = diffProjection({ list: prefix }, { list: [...prefix, ...suffix] });
    expect(patch).toEqual([
      { op: "set", path: ["list", "501"], value: "suffix-one" },
      { op: "set", path: ["list", "502"], value: "suffix-two" },
      { op: "set", path: ["list", "503"], value: "suffix-three" },
    ]);
    expect(patch).toHaveLength(suffix.length);
    expect(JSON.stringify(patch)).not.toContain(
      "distinctive-prefix-marker-that-must-not-be-serialized",
    );
  });

  test("emits ordered suffix operations for a multi-item append and replays them exactly", () => {
    const before = { list: [1] };
    const after = { list: [1, 2, 3] };
    const patch = diffProjection(before, after);
    expect(patch).toEqual([
      { op: "set", path: ["list", "1"], value: 2 },
      { op: "set", path: ["list", "2"], value: 3 },
    ]);
    expect(applyProjectionPatch(before, patch)).toEqual(after);
  });

  test("emits numeric suffix operations when appending into an empty array", () => {
    const before = { list: [] };
    const after = { list: ["first"] };
    expect(diffProjection(before, after)).toEqual([
      { op: "set", path: ["list", "0"], value: "first" },
    ]);
    expect(applyProjectionPatch(before, diffProjection(before, after))).toEqual(after);
  });

  test("compares nested JSON prefix values canonically before emitting suffix operations", () => {
    const before = {
      list: [{ attributes: { alpha: 1, beta: [true, { name: "first" }] } }],
    };
    const after = {
      list: [
        { attributes: { beta: [true, { name: "first" }], alpha: 1 } },
        { attributes: { alpha: 2 } },
      ],
    };
    expect(diffProjection(before, after)).toEqual([
      { op: "set", path: ["list", "1"], value: { attributes: { alpha: 2 } } },
    ]);
  });

  test("replaces the whole array when its existing contents change", () => {
    const before = { list: [1, 2, 3] };
    const after = { list: [1, 2, 4] };
    expect(diffProjection(before, after)).toEqual([
      { op: "set", path: ["list"], value: [1, 2, 4] },
    ]);
  });

  test("replaces the whole array when an existing nested object key or value changes", () => {
    const before = { list: [{ state: { name: "one" } }] };
    expect(
      diffProjection(before, { list: [{ state: { name: "two" } }, { state: { name: "three" } }] }),
    ).toEqual([
      {
        op: "set",
        path: ["list"],
        value: [{ state: { name: "two" } }, { state: { name: "three" } }],
      },
    ]);
    expect(
      diffProjection(before, { list: [{ state: { name: "one", active: true } }, { state: {} }] }),
    ).toEqual([
      {
        op: "set",
        path: ["list"],
        value: [{ state: { name: "one", active: true } }, { state: {} }],
      },
    ]);
  });

  test("replaces the whole array when it shrinks or reorders", () => {
    expect(diffProjection({ list: [1, 2, 3] }, { list: [1, 2] })).toEqual([
      { op: "set", path: ["list"], value: [1, 2] },
    ]);
    expect(diffProjection({ list: [1, 2, 3] }, { list: [2, 1, 3] })).toEqual([
      { op: "set", path: ["list"], value: [2, 1, 3] },
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
