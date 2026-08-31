import { afterAll, describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  formatCliError,
  mapErrorToExitCode,
  propagateCliExitCode,
} from "../../../olt/scripts/src/cli/signals/error-propagation.ts";

afterAll(() => {
  process.exitCode = 0;
});

describe("error-propagation", () => {
  describe("mapErrorToExitCode", () => {
    test("maps HarnessError to its declared exitCode", () => {
      const err = new HarnessError("INVALID_ARGUMENT", "Invalid argument passed", [], 2);
      expect(mapErrorToExitCode(err)).toBe(2);

      const lockErr = new HarnessError("LOCK_TIMEOUT", "Lock timeout", [], 4);
      expect(mapErrorToExitCode(lockErr)).toBe(4);
    });

    test("maps object with numeric exitCode property", () => {
      expect(mapErrorToExitCode({ exitCode: 5 })).toBe(5);
      expect(mapErrorToExitCode({ exitCode: 0, code: "INVALID_ARGUMENT" })).toBe(2);
    });

    test("maps object with known error code strings", () => {
      expect(mapErrorToExitCode({ code: "INVALID_ARGUMENT" })).toBe(2);
      expect(mapErrorToExitCode({ code: "PATH_SAFETY" })).toBe(3);
      expect(mapErrorToExitCode({ code: "INTEGRITY" })).toBe(3);
      expect(mapErrorToExitCode({ code: "PERMISSION_DENIED" })).toBe(3);
      expect(mapErrorToExitCode({ code: "AUTHENTICATION_FAILURE" })).toBe(3);
      expect(mapErrorToExitCode({ code: "ROLE_CONFINEMENT_VIOLATION" })).toBe(3);
      expect(mapErrorToExitCode({ code: "LOCK_TIMEOUT" })).toBe(4);
      expect(mapErrorToExitCode({ code: "NOT_IMPLEMENTED" })).toBe(70);
      expect(mapErrorToExitCode({ code: "OTHER_CUSTOM_CODE" })).toBe(1);
    });

    test("falls back to exit code 70 for unclassified errors", () => {
      expect(mapErrorToExitCode(null)).toBe(70);
      expect(mapErrorToExitCode(undefined)).toBe(70);
      expect(mapErrorToExitCode("raw error string")).toBe(70);
      expect(mapErrorToExitCode(12345)).toBe(70);
      expect(mapErrorToExitCode({})).toBe(70);
      expect(mapErrorToExitCode(new Error("standard error without code"))).toBe(70);
    });
  });

  describe("formatCliError", () => {
    test("formats json output for errors", () => {
      const err = new HarnessError("INVALID_ARGUMENT", "Bad value");
      const jsonOut = formatCliError(err, { json: true });
      const parsed = JSON.parse(jsonOut) as { ok: boolean; error: { code: string; message: string } };
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe("INVALID_ARGUMENT");
      expect(parsed.error.message).toBe("Bad value");
    });

    test("formats HarnessError with and without fix", () => {
      const errWithFix = new HarnessError("INVALID_ARGUMENT", "Missing flag", [], 2, "Pass --flag");
      const formattedFix = formatCliError(errWithFix);
      expect(formattedFix).toContain("**Error (INVALID_ARGUMENT)**: Missing flag");
      expect(formattedFix).toContain("> **Fix**: Pass --flag");

      const errNoFix = new HarnessError("INVALID_STATE", "Cannot proceed");
      const formattedNoFix = formatCliError(errNoFix);
      expect(formattedNoFix).toContain("**Error (INVALID_STATE)**: Cannot proceed");
      expect(formattedNoFix).not.toContain("**Fix**");
    });

    test("formats standard Error and non-Error objects", () => {
      const stdErr = new Error("Generic failure");
      expect(formatCliError(stdErr)).toBe("**Fatal Internal Error**: Generic failure\n");

      expect(formatCliError("string failure")).toBe("**Fatal Internal Error**: string failure\n");
      expect(formatCliError(404)).toBe("**Fatal Internal Error**: 404\n");
    });
  });

  describe("propagateCliExitCode", () => {
    test("assigns process.exitCode and returns mapped exit code", () => {
      const originalExitCode = process.exitCode;
      try {
        const err = new HarnessError("PATH_SAFETY", "Unsafe path", [], 3);
        const code = propagateCliExitCode(err);
        expect(code).toBe(3);
        expect(process.exitCode).toBe(3);
      } finally {
        process.exitCode = originalExitCode;
      }
    });
  });
});
