import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveReportUsageCommand,
  type ReportUsageResolutionContext,
  type ReportUsageResolutionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788680051205-5pk575.ts";

describe("Defect Remediation: defect-cli-1788680051205-5pk575", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788680051205-5pk575");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("report:unified")).toBe(true);
  });

  test("resolves report:unified to report:usage", () => {
    const ctx: ReportUsageResolutionContext = {
      rawCommand: "report:unified",
    };
    const result: ReportUsageResolutionResult = resolveReportUsageCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("report:usage");
    expect(result.suggestion).toBe("report:usage");
  });

  test("rejects unknown commands and provides suggestion", () => {
    const ctx: ReportUsageResolutionContext = {
      rawCommand: "report:custom",
    };
    const result: ReportUsageResolutionResult = resolveReportUsageCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toContain("did you mean 'report:usage'?");
  });
});
