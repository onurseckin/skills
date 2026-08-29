import { describe, expect, test } from "bun:test";
import type { RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  businessFields,
  cloneObject,
  initialState,
  isTerminalState,
  sameJson,
} from "../../../olt/scripts/src/engine/store/capsule/state.ts";

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

describe("businessFields", () => {
  test("strips every reserved key, leaving only caller-defined fields", () => {
    const state = { ...initialState(), tasks: { "T-1": {} }, phase: "implementation" };
    expect(businessFields(state)).toEqual({ tasks: { "T-1": {} }, phase: "implementation" });
  });

  test("returns an empty object for a state with no business fields", () => {
    expect(businessFields(initialState())).toEqual({});
  });
});

describe("isTerminalState", () => {
  test('is true only when completion_result.status is exactly "complete"', () => {
    const state = {
      ...initialState(),
      completion_result: { status: "complete" },
    } as unknown as RunState;
    expect(isTerminalState(state)).toBe(true);
  });

  test("is false when completion_result is absent, non-object, or has a different status", () => {
    expect(isTerminalState(initialState())).toBe(false);
    expect(
      isTerminalState({ ...initialState(), completion_result: "complete" } as unknown as RunState),
    ).toBe(false);
    expect(
      isTerminalState({
        ...initialState(),
        completion_result: { status: "in_progress" },
      } as unknown as RunState),
    ).toBe(false);
    expect(
      isTerminalState({
        ...initialState(),
        completion_result: ["complete"],
      } as unknown as RunState),
    ).toBe(false);
  });
});
