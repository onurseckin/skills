import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  normalizeCapsuleRunPath,
  type PathNormalizationContext,
  type PathNormalizationResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788678550002-pathnorm.ts";

describe("Defect Remediation: defect-cli-1788678550002-pathnorm", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788678550002-pathnorm");
    expect(ERROR_CODE).toBe("INTEGRITY_RESOLUTION_ERROR");
    expect(DEFECT_TITLE.includes("wave-47")).toBe(true);
  });

  test("normalizes bare run id 'wave-47' to '.olt/capsules/wave-47'", () => {
    const ctx: PathNormalizationContext = {
      rawRunIdentifier: "wave-47",
    };
    const result: PathNormalizationResult = normalizeCapsuleRunPath(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.normalizedCapsulePath).toBe(".olt/capsules/wave-47");
    expect(result.wasNormalized).toBe(true);
  });

  test("preserves already normalized paths starting with .olt/capsules/", () => {
    const ctx: PathNormalizationContext = {
      rawRunIdentifier: ".olt/capsules/wave-47",
    };
    const result: PathNormalizationResult = normalizeCapsuleRunPath(ctx);
    expect(result.remediated).toBe(true);
    expect(result.normalizedCapsulePath).toBe(".olt/capsules/wave-47");
    expect(result.wasNormalized).toBe(false);
  });

  test("preserves absolute paths", () => {
    const ctx: PathNormalizationContext = {
      rawRunIdentifier: "/var/tmp/.olt/capsules/wave-47",
    };
    const result: PathNormalizationResult = normalizeCapsuleRunPath(ctx);
    expect(result.remediated).toBe(true);
    expect(result.isAbsolute).toBe(true);
    expect(result.wasNormalized).toBe(false);
  });
});
