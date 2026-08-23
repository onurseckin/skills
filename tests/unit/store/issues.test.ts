import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { issue, throwIntegrity } from "../../../olt/scripts/src/engine/store/issues.ts";

describe("issue", () => {
  test("omits path when not given", () => {
    expect(issue("CODE", "message")).toEqual({ code: "CODE", message: "message" });
  });

  test("includes path when given", () => {
    expect(issue("CODE", "message", "some/path")).toEqual({
      code: "CODE",
      message: "message",
      path: "some/path",
    });
  });
});

describe("throwIntegrity", () => {
  test("throws a HarnessError carrying the issues as its payload", () => {
    const found = [issue("A", "first"), issue("B", "second")];
    expect(() => throwIntegrity(found)).toThrow(HarnessError);
    try {
      throwIntegrity(found);
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      const harnessError = error as HarnessError;
      expect(harnessError.code).toBe("INTEGRITY");
      expect(harnessError.issues).toEqual(found);
    }
  });
});
