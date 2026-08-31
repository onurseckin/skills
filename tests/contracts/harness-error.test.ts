import { describe, expect, test } from "bun:test";
import { ERROR_CODES, type ErrorCode } from "../../olt/scripts/src/core/errors/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { normalizeError } from "../../olt/scripts/src/core/errors/index.ts";

describe("core errors contract: HarnessError, codes, and normalizeError", () => {
  test("ERROR_CODES contains all canonical error code variants", () => {
    expect(ERROR_CODES).toContain("AUTHENTICATION_FAILURE");
    expect(ERROR_CODES).toContain("INTEGRITY");
    expect(ERROR_CODES).toContain("INVALID_ARGUMENT");
    expect(ERROR_CODES).toContain("INVALID_STATE");
    expect(ERROR_CODES).toContain("LOCK_TIMEOUT");
    expect(ERROR_CODES).toContain("NOT_IMPLEMENTED");
    expect(ERROR_CODES).toContain("PATH_SAFETY");
    expect(ERROR_CODES).toContain("ROLE_CONFINEMENT_VIOLATION");
    expect(ERROR_CODES).toContain("UNSUPPORTED_PLATFORM");
  });

  test("HarnessError assigns correct default exit codes based on error code", () => {
    const lockErr = new HarnessError("LOCK_TIMEOUT", "Lock acquisition timed out");
    expect(lockErr.exitCode).toBe(4);
    expect(lockErr.name).toBe("HarnessError");
    expect(lockErr.issues).toEqual([]);

    const notImplErr = new HarnessError("NOT_IMPLEMENTED", "Feature pending");
    expect(notImplErr.exitCode).toBe(70);

    const genericErr = new HarnessError("INVALID_ARGUMENT", "Bad value");
    expect(genericErr.exitCode).toBe(3);

    const customExitCodeErr = new HarnessError("INVALID_STATE", "Custom code", [], 99, "do fix");
    expect(customExitCodeErr.exitCode).toBe(99);
    expect(customExitCodeErr.fix).toBe("do fix");
  });

  test("normalizeError normalizes HarnessError, Error, and unknown thrown values", () => {
    const harnessErr = new HarnessError("PATH_SAFETY", "Unsafe path", ["issue-1"], 3, "fix path");
    const normalizedHarness = normalizeError(harnessErr);
    expect(normalizedHarness.code).toBe("PATH_SAFETY");
    expect(normalizedHarness.message).toBe("Unsafe path");
    expect(normalizedHarness.issues).toEqual(["issue-1"]);
    expect(normalizedHarness.fix).toBe("fix path");
    expect(normalizedHarness.footer).toContain("harness.ts explain PATH_SAFETY");

    const plainErr = new Error("Standard system failure");
    const normalizedPlain = normalizeError(plainErr);
    expect(normalizedPlain.code).toBe("INTERNAL");
    expect(normalizedPlain.message).toBe("Standard system failure");
    expect(normalizedPlain.footer).toContain("harness.ts explain INTERNAL");

    const unknownErr = normalizeError(12345);
    expect(unknownErr.code).toBe("INTERNAL");
    expect(unknownErr.message).toBe("Unknown internal failure");

    const nullErr = normalizeError(null);
    expect(nullErr.code).toBe("INTERNAL");
    expect(nullErr.message).toBe("Unknown internal failure");
  });
});
