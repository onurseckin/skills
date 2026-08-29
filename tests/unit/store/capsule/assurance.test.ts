import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  CAPTURE_MODES,
  VERBATIM_CAPTURE_MODE,
  captureAssurance,
  isCaptureMode,
} from "../../../../olt/scripts/src/engine/store/integrity/assurance.ts";

describe("isCaptureMode", () => {
  test("accepts every declared capture mode", () => {
    for (const mode of CAPTURE_MODES) expect(isCaptureMode(mode)).toBe(true);
  });

  test("rejects unknown strings and non-strings", () => {
    expect(isCaptureMode("not-a-mode")).toBe(false);
    expect(isCaptureMode(42)).toBe(false);
    expect(isCaptureMode(undefined)).toBe(false);
  });
});

describe("captureAssurance", () => {
  test("requires source_verified=true for a directly-captured mode and returns source-verified", () => {
    expect(captureAssurance("file", true)).toBe("source-verified");
    expect(captureAssurance("stdin", true)).toBe("source-verified");
    expect(captureAssurance("argv", true)).toBe("source-verified");
  });

  test("requires source_verified=false for the verbatim copy mode and returns recorded-unverified", () => {
    expect(captureAssurance(VERBATIM_CAPTURE_MODE, false)).toBe("recorded-unverified");
  });

  test("rejects an unsupported capture mode", () => {
    expect(() => captureAssurance("bogus", true)).toThrow(HarnessError);
    expect(() => captureAssurance("bogus", true)).toThrow(/capture_mode must be one of/);
  });

  test("rejects a directly-captured mode claiming it was not source-verified", () => {
    expect(() => captureAssurance("file", false)).toThrow(HarnessError);
    expect(() => captureAssurance("file", false)).toThrow(/requires source_verified=true/);
  });

  test("rejects the verbatim mode claiming it was source-verified", () => {
    expect(() => captureAssurance(VERBATIM_CAPTURE_MODE, true)).toThrow(
      /requires source_verified=false/,
    );
  });
});
