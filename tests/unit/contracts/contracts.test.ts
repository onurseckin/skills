import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import { isJsonObject, isSafeInteger } from "../../../olt/scripts/src/contracts/json.ts";
import { normalizeError } from "../../../olt/scripts/src/errors/normalize-error.ts";

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
      footer:
        "never read the harness source; run `harness.ts help <command>` or `harness.ts explain INVALID_STATE`.",
    });
  });

  test("carries an optional fix through to the rendered error", () => {
    const error = new HarnessError(
      "INVALID_ARGUMENT",
      "unknown option: --prompt",
      [],
      undefined,
      "replace --prompt with --prompt-file or --prompt-stdin",
    );
    expect(normalizeError(error)).toEqual({
      code: "INVALID_ARGUMENT",
      message: "unknown option: --prompt",
      issues: [],
      fix: "replace --prompt with --prompt-file or --prompt-stdin",
      footer:
        "never read the harness source; run `harness.ts help <command>` or `harness.ts explain INVALID_ARGUMENT`.",
    });
  });

  test("normalizes a plain Error to INTERNAL with an empty issues list", () => {
    expect(normalizeError(new TypeError("boom"))).toEqual({
      code: "INTERNAL",
      message: "boom",
      issues: [],
      footer:
        "never read the harness source; run `harness.ts help <command>` or `harness.ts explain INTERNAL`.",
    });
  });

  test("normalizes a thrown non-Error value to a generic internal failure", () => {
    expect(normalizeError("string thrown")).toEqual({
      code: "INTERNAL",
      message: "Unknown internal failure",
      issues: [],
      footer:
        "never read the harness source; run `harness.ts help <command>` or `harness.ts explain INTERNAL`.",
    });
    expect(normalizeError(undefined)).toEqual({
      code: "INTERNAL",
      message: "Unknown internal failure",
      issues: [],
      footer:
        "never read the harness source; run `harness.ts help <command>` or `harness.ts explain INTERNAL`.",
    });
  });
});
