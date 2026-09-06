import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  handleReportUnifiedCommand,
  type ReportUnifiedCommandDispatchContext,
  type ReportUnifiedCommandDispatchResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788682146638-efzouk.ts";

describe("Defect Remediation: defect-cli-1788682146638-efzouk", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788682146638-efzouk");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("report:unified")).toBe(true);
  });

  test("resolves report:unified command to report:usage", () => {
    const ctx: ReportUnifiedCommandDispatchContext = {
      command: "report:unified",
    };
    const result: ReportUnifiedCommandDispatchResult =
      handleReportUnifiedCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("report:usage");
  });

  test("reports unknown command with suggestion", () => {
    const ctx: ReportUnifiedCommandDispatchContext = {
      command: "report:delta",
    };
    const result: ReportUnifiedCommandDispatchResult =
      handleReportUnifiedCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toContain("did you mean 'report:usage'?");
  });
});
