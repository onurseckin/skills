import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveReportUnifiedCommand,
  type ReportCommandResolutionContext,
  type ReportCommandResolutionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788678566314-si9rnh.ts";

describe("Defect Remediation: defect-cli-1788678566314-si9rnh", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788678566314-si9rnh");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("report:unified")).toBe(true);
  });

  test("resolves report:unified to canonical report:usage", () => {
    const ctx: ReportCommandResolutionContext = {
      requestedCommand: "report:unified",
    };
    const result: ReportCommandResolutionResult = resolveReportUnifiedCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("report:usage");
    expect(result.suggestion).toBe("report:usage");
  });

  test("accepts canonical report:usage directly", () => {
    const ctx: ReportCommandResolutionContext = {
      requestedCommand: "report:usage",
    };
    const result: ReportCommandResolutionResult = resolveReportUnifiedCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("report:usage");
  });

  test("returns error for unknown non-report command", () => {
    const ctx: ReportCommandResolutionContext = {
      requestedCommand: "unknown_cmd",
    };
    const result: ReportCommandResolutionResult = resolveReportUnifiedCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toBe("unknown command: unknown_cmd");
  });
});
