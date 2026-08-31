import { describe, expect, it } from "bun:test";
import { ERROR_CODES, HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("HarnessError Definitions & Exit Codes", () => {
  it("defines standard error codes", () => {
    expect(ERROR_CODES).toContain("INTEGRITY");
    expect(ERROR_CODES).toContain("INVALID_ARGUMENT");
    expect(ERROR_CODES).toContain("INVALID_STATE");
    expect(ERROR_CODES).toContain("LOCK_TIMEOUT");
    expect(ERROR_CODES).toContain("NOT_IMPLEMENTED");
    expect(ERROR_CODES).toContain("PATH_SAFETY");
    expect(ERROR_CODES).toContain("ROLE_CONFINEMENT_VIOLATION");
    expect(ERROR_CODES).toContain("UNSUPPORTED_PLATFORM");
  });

  it("instantiates HarnessError with expected properties and default exit codes", () => {
    const errLock = new HarnessError("LOCK_TIMEOUT", "Lock held");
    expect(errLock.code).toBe("LOCK_TIMEOUT");
    expect(errLock.exitCode).toBe(4);
    expect(errLock.issues).toEqual([]);

    const errNotImpl = new HarnessError("NOT_IMPLEMENTED", "Not yet");
    expect(errNotImpl.exitCode).toBe(70);

    const errArg = new HarnessError("INVALID_ARGUMENT", "Bad arg", ["issue1"], 3, "Try fix");
    expect(errArg.exitCode).toBe(3);
    expect(errArg.issues).toEqual(["issue1"]);
    expect(errArg.fix).toBe("Try fix");
  });
});
