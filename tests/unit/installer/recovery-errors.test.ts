import { describe, expect, test } from "bun:test";
import {
  combinedFailure,
  recoveryErrors,
} from "../../../olt/scripts/src/installer/recovery-errors.ts";

describe("recoveryErrors", () => {
  test("returns an empty array when there are no steps", async () => {
    expect(await recoveryErrors([])).toEqual([]);
  });

  test("returns an empty array when every step resolves", async () => {
    let ran = 0;
    const errors = await recoveryErrors([
      async () => {
        ran += 1;
      },
      async () => {
        ran += 1;
      },
    ]);
    expect(errors).toEqual([]);
    expect(ran).toBe(2);
  });

  test("collects the thrown value from each failing step without stopping the run", async () => {
    const first = new Error("first failure");
    const second = new Error("second failure");
    let thirdRan = false;
    const errors = await recoveryErrors([
      async () => {
        throw first;
      },
      async () => {
        throw second;
      },
      async () => {
        thirdRan = true;
      },
    ]);
    expect(errors).toEqual([first, second]);
    expect(thirdRan).toBe(true);
  });

  test("preserves non-Error thrown values as-is", async () => {
    const errors = await recoveryErrors([
      async () => {
        throw "a string failure";
      },
    ]);
    expect(errors).toEqual(["a string failure"]);
  });
});

describe("combinedFailure", () => {
  test("returns the primary error unchanged when there is no recovery error", () => {
    const primary = new Error("primary");
    expect(combinedFailure(primary, [], "message")).toBe(primary);
  });

  test("wraps primary and recovery errors in an AggregateError when recovery failed too", () => {
    const primary = new Error("primary");
    const recoveryA = new Error("recovery-a");
    const recoveryB = new Error("recovery-b");
    const combined = combinedFailure(primary, [recoveryA, recoveryB], "combined message");
    expect(combined).toBeInstanceOf(AggregateError);
    const aggregate = combined as AggregateError;
    expect(aggregate.message).toBe("combined message");
    expect(aggregate.cause).toBe(primary);
    expect([...aggregate.errors]).toEqual([primary, recoveryA, recoveryB]);
  });
});
