import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  isJsonObject,
  isSafeInteger,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { normalizeError } from "../../../orchestrating-long-tasks/scripts/src/errors/normalize-error.ts";

describe("shared contracts", () => {
  test("distinguishes JSON objects and safe integers", () => {
    expect(isJsonObject({ ok: true })).toBeTrue();
    expect(isJsonObject([])).toBeFalse();
    expect(isSafeInteger(Number.MAX_SAFE_INTEGER)).toBeTrue();
    expect(isSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBeFalse();
    expect(isSafeInteger(true)).toBeFalse();
  });

  test("normalizes structured harness errors", () => {
    const error = new HarnessError("INVALID_STATE", "not ready", [{ task: "T-1" }]);
    expect(normalizeError(error)).toEqual({
      code: "INVALID_STATE",
      message: "not ready",
      issues: [{ task: "T-1" }],
    });
  });
});
