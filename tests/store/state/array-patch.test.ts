import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  type ArrayPatchOperation,
  applyArrayPatchOperation,
  diffArrayElements,
  isMonotonicArrayAppend,
} from "../../../olt/scripts/src/engine/store/projections/array-patch.ts";

function expectIntegrity(fn: () => void): void {
  try {
    fn();
    throw new Error("expected an integrity error");
  } catch (error) {
    expect(error).toBeInstanceOf(HarnessError);
    expect((error as HarnessError).code).toBe("INTEGRITY");
  }
}

describe("array-patch", () => {
  describe("isMonotonicArrayAppend", () => {
    test("returns true for identical or appended sequences", () => {
      expect(isMonotonicArrayAppend([], [])).toBe(true);
      expect(isMonotonicArrayAppend([], [1, 2])).toBe(true);
      expect(isMonotonicArrayAppend([1, 2], [1, 2])).toBe(true);
      expect(isMonotonicArrayAppend([1, 2], [1, 2, 3, 4])).toBe(true);
      expect(
        isMonotonicArrayAppend(
          [{ id: "a", v: 1 }],
          [
            { id: "a", v: 1 },
            { id: "b", v: 2 },
          ],
        ),
      ).toBe(true);
    });

    test("returns false when length decreases or elements differ", () => {
      expect(isMonotonicArrayAppend([1, 2, 3], [1, 2])).toBe(false);
      expect(isMonotonicArrayAppend([1, 2, 3], [1, 99, 3])).toBe(false);
      expect(isMonotonicArrayAppend([1, 2, 3], [1, 99, 3, 4])).toBe(false);
    });

    test("returns false for non-arrays or sparse slots", () => {
      const sparse: unknown[] = [];
      sparse[0] = 1;
      sparse[2] = 3;
      expect(isMonotonicArrayAppend(sparse, [1, 2, 3])).toBe(false);
      expect(isMonotonicArrayAppend(null as unknown as readonly unknown[], [1, 2])).toBe(false);
    });
  });

  describe("diffArrayElements", () => {
    test("monotonic append of 500 items emits exactly 500 single-item set ops", () => {
      const before: readonly string[] = [];
      const after: readonly string[] = Array.from({ length: 500 }, (_, i) => `item-${i}`);
      const ops: ArrayPatchOperation[] = [];

      diffArrayElements(["escalations"], before, after, ops);

      expect(ops.length).toBe(500);
      for (let i = 0; i < 500; i += 1) {
        expect(ops[i]).toEqual({
          op: "set",
          path: ["escalations", String(i)],
          value: `item-${i}`,
        });
      }

      // Verify applying these 500 ops sequentially on a target array reproduces after
      const target: unknown[] = [];
      for (const op of ops) {
        applyArrayPatchOperation(target, op);
      }
      expect(target).toEqual(Array.from(after));
    });

    test("appending to existing non-empty array emits only delta suffix set ops", () => {
      const before = [{ id: 1 }, { id: 2 }];
      const after = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
      const ops: ArrayPatchOperation[] = [];

      diffArrayElements(["tasks"], before, after, ops);

      expect(ops).toEqual([
        { op: "set", path: ["tasks", "2"], value: { id: 3 } },
        { op: "set", path: ["tasks", "3"], value: { id: 4 } },
      ]);
    });

    test("targeted index mutation diffs only the modified elements", () => {
      const before = ["a", "b", "c", "d"];
      const after = ["a", "MUTATED", "c", "CHANGED"];
      const ops: ArrayPatchOperation[] = [];

      diffArrayElements(["list"], before, after, ops);

      expect(ops).toEqual([
        { op: "set", path: ["list", "1"], value: "MUTATED" },
        { op: "set", path: ["list", "3"], value: "CHANGED" },
      ]);

      const target: unknown[] = [...before];
      for (const op of ops) applyArrayPatchOperation(target, op);
      expect(target).toEqual([...after]);
    });

    test("truncation emits splice delete operation", () => {
      const before = [10, 20, 30, 40, 50];
      const after = [10, 20];
      const ops: ArrayPatchOperation[] = [];

      diffArrayElements(["numbers"], before, after, ops);

      expect(ops).toEqual([{ op: "splice", path: ["numbers"], start: 2, deleteCount: 3 }]);

      const target: unknown[] = [...before];
      for (const op of ops) applyArrayPatchOperation(target, op);
      expect(target).toEqual([...after]);
    });

    test("general mutations emit granular splice operations", () => {
      // Middle insertion
      const before1 = [1, 2, 5, 6];
      const after1 = [1, 2, 3, 4, 5, 6];
      const ops1: ArrayPatchOperation[] = [];
      diffArrayElements(["arr"], before1, after1, ops1);
      expect(ops1).toEqual([
        { op: "splice", path: ["arr"], start: 2, deleteCount: 0, items: [3, 4] },
      ]);
      const target1 = [...before1];
      for (const op of ops1) applyArrayPatchOperation(target1, op);
      expect(target1).toEqual(after1);

      // Middle deletion
      const before2 = [1, 2, 3, 4, 5];
      const after2 = [1, 4, 5];
      const ops2: ArrayPatchOperation[] = [];
      diffArrayElements(["arr"], before2, after2, ops2);
      expect(ops2).toEqual([{ op: "splice", path: ["arr"], start: 1, deleteCount: 2 }]);
      const target2 = [...before2];
      for (const op of ops2) applyArrayPatchOperation(target2, op);
      expect(target2).toEqual(after2);
    });
  });

  describe("applyArrayPatchOperation negative gates", () => {
    test("rejects invalid path segments and non-canonical numeric strings", () => {
      const invalidPaths = [
        ["items", "not-a-number"],
        ["items", "01"],
        ["items", "-1"],
        ["items", "1.5"],
        ["items", "9007199254740992"],
      ] as const;

      for (const path of invalidPaths) {
        expectIntegrity(() => {
          applyArrayPatchOperation([1, 2, 3], { op: "set", path: [...path], value: 99 });
        });
      }
    });

    test("rejects empty path for set operation", () => {
      expectIntegrity(() => {
        applyArrayPatchOperation([1, 2], { op: "set", path: [], value: 3 });
      });
    });

    test("rejects unset operations on arrays", () => {
      expectIntegrity(() => {
        applyArrayPatchOperation([1, 2, 3], { op: "unset", path: ["items", "1"] });
      });
    });

    test("rejects out-of-bounds index mutations creating sparse arrays", () => {
      expectIntegrity(() => {
        applyArrayPatchOperation([1, 2], { op: "set", path: ["items", "5"], value: 99 });
      });
    });

    test("rejects non-array target", () => {
      expectIntegrity(() => {
        applyArrayPatchOperation({} as unknown as unknown[], {
          op: "set",
          path: ["0"],
          value: 1,
        });
      });
    });

    test("rejects invalid splice parameters", () => {
      // Negative start
      expectIntegrity(() => {
        applyArrayPatchOperation([1, 2, 3], {
          op: "splice",
          path: ["items"],
          start: -1,
          deleteCount: 1,
        });
      });

      // Start out of bounds
      expectIntegrity(() => {
        applyArrayPatchOperation([1, 2, 3], {
          op: "splice",
          path: ["items"],
          start: 5,
          deleteCount: 0,
        });
      });

      // Non-integer start
      expectIntegrity(() => {
        applyArrayPatchOperation([1, 2, 3], {
          op: "splice",
          path: ["items"],
          start: 1.5,
          deleteCount: 0,
        });
      });

      // Negative deleteCount
      expectIntegrity(() => {
        applyArrayPatchOperation([1, 2, 3], {
          op: "splice",
          path: ["items"],
          start: 1,
          deleteCount: -1,
        });
      });

      // Delete count exceeding array bounds
      expectIntegrity(() => {
        applyArrayPatchOperation([1, 2, 3], {
          op: "splice",
          path: ["items"],
          start: 2,
          deleteCount: 3,
        });
      });

      // Non-array items
      expectIntegrity(() => {
        applyArrayPatchOperation([1, 2, 3], {
          op: "splice",
          path: ["items"],
          start: 1,
          deleteCount: 1,
          items: "invalid" as unknown as unknown[],
        });
      });
    });

    test("rejects unknown operation op kind", () => {
      expectIntegrity(() => {
        applyArrayPatchOperation([1, 2], {
          op: "unknown",
          path: ["0"],
        } as unknown as ArrayPatchOperation);
      });
    });
  });
});
