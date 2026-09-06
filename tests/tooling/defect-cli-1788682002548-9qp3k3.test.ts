import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveReportDagCommand,
  type ReportDagResolutionContext,
  type ReportDagResolutionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788682002548-9qp3k3.ts";

describe("Defect Remediation: defect-cli-1788682002548-9qp3k3", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788682002548-9qp3k3");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("report:dag")).toBe(true);
  });

  test("resolves report:dag to report:get", () => {
    const ctx: ReportDagResolutionContext = {
      requestedCommand: "report:dag",
    };
    const result: ReportDagResolutionResult = resolveReportDagCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("report:get");
    expect(result.suggestion).toBe("report:get");
  });

  test("rejects unknown command and suggests report:get", () => {
    const ctx: ReportDagResolutionContext = {
      requestedCommand: "report:tree",
    };
    const result: ReportDagResolutionResult = resolveReportDagCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toContain("did you mean 'report:get'?");
  });
});
