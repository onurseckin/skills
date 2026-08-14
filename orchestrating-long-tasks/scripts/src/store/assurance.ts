import type { CaptureAssurance, CaptureMode } from "../contracts/capsule.ts";
import { HarnessError } from "../errors/harness-error.ts";

export const VERBATIM_CAPTURE_MODE: CaptureMode = "verbatim_context_copy";
export const CAPTURE_MODES: readonly CaptureMode[] = ["file", "stdin", VERBATIM_CAPTURE_MODE];

export function isCaptureMode(value: unknown): value is CaptureMode {
  return typeof value === "string" && (CAPTURE_MODES as readonly string[]).includes(value);
}

export function captureAssurance(captureMode: string, sourceVerified: boolean): CaptureAssurance {
  if (!isCaptureMode(captureMode)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `capture_mode must be one of: ${CAPTURE_MODES.join(", ")}`,
    );
  }
  const expected = captureMode !== VERBATIM_CAPTURE_MODE;
  if (sourceVerified !== expected) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `${captureMode} requires source_verified=${String(expected)}`,
    );
  }
  return expected ? "source-verified" : "recorded-unverified";
}
