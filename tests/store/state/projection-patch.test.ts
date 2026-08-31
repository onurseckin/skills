import { describe, expect, test } from "bun:test";
import type {
  JsonObject,
  ProjectionPatchOp,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  applyProjectionPatch,
  diffProjection,
  reduceEventStream,
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

describe("projection-patch", () => {
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
      const before: JsonObject = { a: 1, list: [1, 2] };
      const patch = diffProjection(before, { a: 2, list: [1, 2, 3] });
      applyProjectionPatch(before, patch);
      expect(before).toEqual({ a: 1, list: [1, 2] });
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

    test("applies splice operations to arrays at root and nested paths", () => {
      const initial = { items: [1, 2, 5, 6], nested: { arr: ["a", "b", "c"] } };
      const patched = applyProjectionPatch(initial, [
        { op: "splice", path: ["items"], start: 2, deleteCount: 0, items: [3, 4] },
        { op: "splice", path: ["nested", "arr"], start: 1, deleteCount: 1, items: ["x", "y"] },
      ]);
      expect(patched).toEqual({ items: [1, 2, 3, 4, 5, 6], nested: { arr: ["a", "x", "y", "c"] } });
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

  describe("diffProjection integration with array diffing", () => {
    test("monotonic append generates granular suffix set ops", () => {
      const before = { log: ["msg-1", "msg-2"] };
      const after = { log: ["msg-1", "msg-2", "msg-3", "msg-4"] };
      const ops = diffProjection(before, after);
      expect(ops).toEqual([
        { op: "set", path: ["log", "2"], value: "msg-3" },
        { op: "set", path: ["log", "3"], value: "msg-4" },
      ]);
      expect(applyProjectionPatch(before, ops)).toEqual(after);
    });

    test("array element substitution generates in-place set ops", () => {
      const before = { config: ["prod", "us-east-1", "v1"] };
      const after = { config: ["prod", "eu-west-1", "v1"] };
      const ops = diffProjection(before, after);
      expect(ops).toEqual([{ op: "set", path: ["config", "1"], value: "eu-west-1" }]);
      expect(applyProjectionPatch(before, ops)).toEqual(after);
    });

    test("array insertion and deletion generate granular splice ops", () => {
      const before = { tags: ["init", "pending", "done"] };
      const after = { tags: ["init", "ready", "running", "done"] };
      const ops = diffProjection(before, after);
      expect(ops).toEqual([
        { op: "splice", path: ["tags"], start: 1, deleteCount: 1, items: ["ready", "running"] },
      ]);
      expect(applyProjectionPatch(before, ops)).toEqual(after);
    });
  });

  describe("500 escalations benchmark", () => {
    test("simulating 500 escalations yields cumulative log <= 1.8MB and O(1) append deltas", () => {
      let state: JsonObject = { escalations: [] };
      const patchLog: ProjectionPatchOp[][] = [];
      let totalLogBytes = 0;

      for (let i = 0; i < 500; i += 1) {
        const nextEscalation = {
          id: `esc-${i}`,
          severity: i % 10 === 0 ? "critical" : "warning",
          reason: `Escalation event ${i} detected in worker node`,
          timestamp: "2026-08-29T12:00:00.000Z",
          meta: { index: i, active: true },
        };
        const currentList = state.escalations as readonly JsonObject[];
        const nextState: JsonObject = {
          ...state,
          escalations: [...currentList, nextEscalation],
        };

        const patch = diffProjection(state, nextState);
        expect(patch).toHaveLength(1);
        expect(patch[0]).toEqual({
          op: "set",
          path: ["escalations", String(i)],
          value: nextEscalation,
        });

        const patchJson = JSON.stringify(patch);
        totalLogBytes += Buffer.byteLength(patchJson, "utf8");
        patchLog.push(patch);

        state = applyProjectionPatch(state, patch);
        expect(state).toEqual(nextState);
      }

      const MAX_LOG_BYTES = 1.8 * 1024 * 1024; // 1.8 MB
      expect(totalLogBytes).toBeLessThanOrEqual(MAX_LOG_BYTES);
      expect(state.escalations).toHaveLength(500);

      // Verify reduceEventStream also reproduces the identical state from patchLog
      const events = patchLog.map((projection_patch) => ({ projection_patch }));
      const reconstructed = reduceEventStream({ escalations: [] }, events);
      expect(reconstructed).toEqual(state);
    });
  });

  describe("reduceEventStream", () => {
    test("applies incremental patch events sequentially", () => {
      const initial = { count: 0, items: [] };
      const events = [
        { projection_patch: [{ op: "set" as const, path: ["count"], value: 1 }] },
        { projection_patch: [{ op: "set" as const, path: ["items", "0"], value: "first" }] },
        { projection_patch: [{ op: "set" as const, path: ["count"], value: 2 }] },
      ];
      const result = reduceEventStream(initial, events);
      expect(result).toEqual({ count: 2, items: ["first"] });
      expect(initial).toEqual({ count: 0, items: [] });
    });

    test("checkpoint snapshot resets accumulated state", () => {
      const initial = { count: 0, items: ["a"] };
      const checkpoint = { count: 100, items: ["x", "y"], checkpointed: true };
      const events = [
        { projection_patch: [{ op: "set" as const, path: ["count"], value: 5 }] },
        { projection: checkpoint },
        { projection_patch: [{ op: "set" as const, path: ["items", "2"], value: "z" }] },
      ];
      const result = reduceEventStream(initial, events);
      expect(result).toEqual({ count: 100, items: ["x", "y", "z"], checkpointed: true });
    });

    test("handles null, undefined, and empty event properties cleanly", () => {
      const initial = { status: "ok" };
      const events = [
        { projection: null, projection_patch: null },
        { projection: undefined, projection_patch: undefined },
        {},
      ];
      const result = reduceEventStream(initial, events);
      expect(result).toEqual(initial);
      expect(result).not.toBe(initial);
    });
  });

  describe("negative gates & boundary integrity", () => {
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

    test("rejects unsetting root projection", () => {
      expectIntegrity(() => {
        applyProjectionPatch({ a: 1 }, [{ op: "unset", path: [] }]);
      });
    });

    test("rejects splice on a non-array target", () => {
      expectIntegrity(() => {
        applyProjectionPatch({ notArray: "str" }, [
          { op: "splice", path: ["notArray"], start: 0, deleteCount: 0 },
        ]);
      });
    });

    test("rejects out-of-bounds splice operations", () => {
      expectIntegrity(() => {
        applyProjectionPatch({ list: [1, 2] }, [
          { op: "splice", path: ["list"], start: 5, deleteCount: 0 },
        ]);
      });
      expectIntegrity(() => {
        applyProjectionPatch({ list: [1, 2] }, [
          { op: "splice", path: ["list"], start: 0, deleteCount: 5 },
        ]);
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
  });
});
