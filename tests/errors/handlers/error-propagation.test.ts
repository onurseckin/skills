import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  mapErrorToExitCode,
  propagateCliExitCode,
} from "../../../olt/scripts/src/cli/signals/error-propagation.ts";

describe("CLI Error Propagation & Exit Code Mapping (in-memory virtualization)", () => {
  it("maps HarnessError exit codes directly", () => {
    const err = new HarnessError("LOCK_TIMEOUT", "Lock busy");
    expect(mapErrorToExitCode(err)).toBe(4);
  });

  it("maps standard error code objects to standard codes", () => {
    expect(mapErrorToExitCode({ code: "INVALID_ARGUMENT" })).toBe(2);
    expect(mapErrorToExitCode({ code: "PATH_SAFETY" })).toBe(3);
    expect(mapErrorToExitCode({ code: "NOT_IMPLEMENTED" })).toBe(70);
  });

  it("propagates exit code to process.exitCode safely", () => {
    try {
      const code = propagateCliExitCode(new HarnessError("INVALID_ARGUMENT", "Invalid"));
      expect(code).toBe(3);
    } finally {
      process.exitCode = 0;
    }
  });
});
