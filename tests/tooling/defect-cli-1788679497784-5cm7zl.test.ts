import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveTaskShowCommand,
  type TaskShowResolutionContext,
  type TaskShowResolutionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788679497784-5cm7zl.ts";

describe("Defect Remediation: defect-cli-1788679497784-5cm7zl", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679497784-5cm7zl");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("task:show")).toBe(true);
  });

  test("resolves task:show to canonical task:brief with task:add suggestion", () => {
    const ctx: TaskShowResolutionContext = {
      requestedCommand: "task:show",
    };
    const result: TaskShowResolutionResult = resolveTaskShowCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.suggestion).toBe("task:add");
    expect(result.canonicalCommand).toBe("task:brief");
  });

  test("handles other unknown commands with suggestion", () => {
    const ctx: TaskShowResolutionContext = {
      requestedCommand: "task:display",
    };
    const result: TaskShowResolutionResult = resolveTaskShowCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toContain("did you mean 'task:add'?");
  });
});
