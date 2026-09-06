import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveReportUnifiedAlias,
  type ReportUnifiedCommandContext,
  type ReportUnifiedCommandResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788680406655-ypjbmj.ts";

describe("Defect Remediation: defect-cli-1788680406655-ypjbmj", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788680406655-ypjbmj");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("report:unified")).toBe(true);
  });

  test("resolves report:unified to report:usage", () => {
    const ctx: ReportUnifiedCommandContext = {
      command: "report:unified",
    };
    const result: ReportUnifiedCommandResult = resolveReportUnifiedAlias(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.target).toBe("report:usage");
    expect(result.suggestion).toBe("report:usage");
  });

  test("rejects unknown command with did you mean message", () => {
    const ctx: ReportUnifiedCommandContext = {
      command: "report:xyz",
    };
    const result: ReportUnifiedCommandResult = resolveReportUnifiedAlias(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toBe("unknown command: report:xyz; did you mean 'report:usage'?");
  });
});
