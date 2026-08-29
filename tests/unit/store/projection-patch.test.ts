import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  applyProjectionPatch,
  diffProjection,
} from "../../../olt/scripts/src/engine/store/projections/projection-patch.ts";

function expectIntegrity(operation: () => void): void {
  try {
    operation();
    throw new Error("expected an integrity error");
  } catch (error) {
    expect(error).toBeInstanceOf(HarnessError);
    expect((error as HarnessError).code).toBe("INTEGRITY");
  }
}

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

  test("appends at a numeric array path and preserves existing array values", () => {
    const result = applyProjectionPatch({ list: [1, 2, 3] }, [
      { op: "set", path: ["list", "3"], value: 4 },
    ]);
    expect(result).toEqual({ list: [1, 2, 3, 4] });
  });

  test("accepts replacing an existing numeric array path", () => {
    expect(
      applyProjectionPatch({ list: [1, 2, 3] }, [{ op: "set", path: ["list", "1"], value: 4 }]),
    ).toEqual({ list: [1, 4, 3] });
  });

  test("traverses an existing array element without replacing the array or object", () => {
    expect(
      applyProjectionPatch({ list: [{ values: [1] }] }, [
        { op: "set", path: ["list", "0", "values", "1"], value: 2 },
      ]),
    ).toEqual({ list: [{ values: [1, 2] }] });
  });

  test("traverses arrays nested in an object and another array", () => {
    expect(
      applyProjectionPatch({ groups: { lists: [[1]] } }, [
        { op: "set", path: ["groups", "lists", "0", "1"], value: 2 },
      ]),
    ).toEqual({ groups: { lists: [[1, 2]] } });
  });

  test("keeps numeric-looking object keys as object properties", () => {
    expect(
      applyProjectionPatch({ records: { "01": "first" } }, [
        { op: "set", path: ["records", "01"], value: "second" },
      ]),
    ).toEqual({ records: { "01": "second" } });
  });

  test("preserves historical whole-array set patches", () => {
    expect(
      applyProjectionPatch({ list: [1, 2, 3] }, [{ op: "set", path: ["list"], value: [4, 5] }]),
    ).toEqual({ list: [4, 5] });
  });

  test("rejects malformed, noncanonical, negative, and sparse numeric array paths", () => {
    const invalidPaths = [
      ["list", "item"],
      ["list", "01"],
      ["list", "-1"],
      ["list", "4"],
      ["list", "9007199254740992"],
    ] as const;
    for (const path of invalidPaths) {
      expectIntegrity(() => {
        applyProjectionPatch({ list: [1, 2, 3] }, [{ op: "set", path: [...path], value: 4 }]);
      });
    }
  });

  test("rejects unsetting an array index because it would create a sparse array", () => {
    expectIntegrity(() => {
      applyProjectionPatch({ list: [1, 2, 3] }, [{ op: "unset", path: ["list", "1"] }]);
    });
  });

  test("rejects traversal through a primitive array element without mutating the source", () => {
    const before = { list: [1] };
    expectIntegrity(() => {
      applyProjectionPatch(before, [{ op: "set", path: ["list", "0", "name"], value: "one" }]);
    });
    expect(before).toEqual({ list: [1] });
  });

  test("keeps the source externally atomic when a later array operation is invalid", () => {
    const before = { list: [1] };
    const serializedBefore = JSON.stringify(before);
    expectIntegrity(() => {
      applyProjectionPatch(before, [
        { op: "set", path: ["list", "1"], value: 2 },
        { op: "set", path: ["list", "3"], value: 4 },
      ]);
    });
    expect(before).toEqual({ list: [1] });
    expect(JSON.stringify(before)).toBe(serializedBefore);
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
