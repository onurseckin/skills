import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveUnifiedReportCommand,
  type UnifiedReportResolutionContext,
  type UnifiedReportResolutionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788682000674-phgfcb.ts";

describe("Defect Remediation: defect-cli-1788682000674-phgfcb", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788682000674-phgfcb");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("report:unified")).toBe(true);
  });

  test("resolves report:unified to report:usage", () => {
    const ctx: UnifiedReportResolutionContext = {
      requestedCommand: "report:unified",
    };
    const result: UnifiedReportResolutionResult =
      resolveUnifiedReportCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.targetCommand).toBe("report:usage");
  });

  test("rejects unknown command and suggests report:usage", () => {
    const ctx: UnifiedReportResolutionContext = {
      requestedCommand: "report:overview",
    };
    const result: UnifiedReportResolutionResult =
      resolveUnifiedReportCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toContain("did you mean 'report:usage'?");
  });
});
