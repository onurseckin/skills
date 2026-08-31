import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { assertInstallerPlatform } from "../../../olt/scripts/src/installer/platform.ts";

describe("assertInstallerPlatform", () => {
  test("accepts darwin", () => {
    expect(() => assertInstallerPlatform("darwin")).not.toThrow();
  });

  test("accepts linux", () => {
    expect(() => assertInstallerPlatform("linux")).not.toThrow();
  });

  test("defaults to the current process platform when none is given", () => {
    // The real process.platform in this suite's CI and dev environments is always darwin or
    // linux, so exercising the default parameter itself never throws here.
    expect(() => assertInstallerPlatform()).not.toThrow();
  });

  test("rejects an unsupported platform", () => {
    expect(() => assertInstallerPlatform("win32")).toThrow(HarnessError);
    try {
      assertInstallerPlatform("win32");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("UNSUPPORTED_PLATFORM");
      expect((error as HarnessError).message).toBe("installer is unsupported on win32");
    }
  });
});
