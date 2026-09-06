import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveCommandListDefect,
  type CommandListResolutionContext,
  type CommandListResolutionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788679722610-8a5mat.ts";

describe("Defect Remediation: defect-cli-1788679722610-8a5mat", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679722610-8a5mat");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("command:list")).toBe(true);
  });

  test("resolves command:list to agent:list", () => {
    const ctx: CommandListResolutionContext = {
      requestedCommand: "command:list",
    };
    const result: CommandListResolutionResult = resolveCommandListDefect(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("agent:list");
    expect(result.suggestion).toBe("agent:list");
  });

  test("flags unknown commands with agent:list suggestion", () => {
    const ctx: CommandListResolutionContext = {
      requestedCommand: "cmd:list",
    };
    const result: CommandListResolutionResult = resolveCommandListDefect(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toContain("did you mean 'agent:list'?");
  });
});
