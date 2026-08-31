import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { normalizeError } from "../../../olt/scripts/src/core/errors/normalize-error.ts";
import * as ErrorsIndex from "../../../olt/scripts/src/core/errors/index.ts";

describe("core/errors/normalize-error.ts", () => {
  it("normalizes HarnessError instances correctly", () => {
    const errorWithFix = new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid argument provided",
      ["issue1"],
      3,
      "check the flags",
    );
    const normalizedWithFix = normalizeError(errorWithFix);
    expect(normalizedWithFix.code).toBe("INVALID_ARGUMENT");
    expect(normalizedWithFix.message).toBe("Invalid argument provided");
    expect(normalizedWithFix.issues).toEqual(["issue1"]);
    expect(normalizedWithFix.fix).toBe("check the flags");
    expect(normalizedWithFix.footer).toContain("INVALID_ARGUMENT");

    const errorWithoutFix = new HarnessError("PATH_SAFETY", "Path safety violated");
    const normalizedWithoutFix = normalizeError(errorWithoutFix);
    expect(normalizedWithoutFix.code).toBe("PATH_SAFETY");
    expect(normalizedWithoutFix.message).toBe("Path safety violated");
    expect(normalizedWithoutFix.fix).toBeUndefined();
    expect(normalizedWithoutFix.footer).toContain("PATH_SAFETY");

    const lockError = new HarnessError("LOCK_TIMEOUT", "Lock held");
    expect(lockError.exitCode).toBe(4);
    const notImplError = new HarnessError("NOT_IMPLEMENTED", "Not impl");
    expect(notImplError.exitCode).toBe(70);
  });

  it("normalizes standard Error instances correctly", () => {
    const stdError = new Error("Standard runtime crash");
    const normalized = normalizeError(stdError);
    expect(normalized.code).toBe("INTERNAL");
    expect(normalized.message).toBe("Standard runtime crash");
    expect(normalized.issues).toEqual([]);
    expect(normalized.footer).toContain("INTERNAL");
  });

  it("normalizes non-Error unknown values safely", () => {
    expect(normalizeError("string error")).toEqual({
      code: "INTERNAL",
      message: "Unknown internal failure",
      issues: [],
      footer:
        "never read the harness source; run `harness.ts help <command>` or `harness.ts explain INTERNAL`.",
    });
    expect(normalizeError(null)).toEqual({
      code: "INTERNAL",
      message: "Unknown internal failure",
      issues: [],
      footer:
        "never read the harness source; run `harness.ts help <command>` or `harness.ts explain INTERNAL`.",
    });
  });

  it("exports all error constructs from index.ts", () => {
    expect(ErrorsIndex.HarnessError).toBe(HarnessError);
    expect(ErrorsIndex.normalizeError).toBe(normalizeError);
  });
});
