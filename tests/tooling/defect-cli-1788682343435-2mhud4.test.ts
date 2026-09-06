import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveMsgReadCommand,
  type MsgReadResolutionContext,
  type MsgReadResolutionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788682343435-2mhud4.ts";

describe("Defect Remediation: defect-cli-1788682343435-2mhud4", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788682343435-2mhud4");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("msg:read")).toBe(true);
  });

  test("resolves msg:read to canonical msg:recv", () => {
    const ctx: MsgReadResolutionContext = {
      requestedCommand: "msg:read",
    };
    const result: MsgReadResolutionResult = resolveMsgReadCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("msg:recv");
  });

  test("preserves native msg:recv", () => {
    const ctx: MsgReadResolutionContext = {
      requestedCommand: "msg:recv",
    };
    const result: MsgReadResolutionResult = resolveMsgReadCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("msg:recv");
  });

  test("rejects unknown commands", () => {
    const ctx: MsgReadResolutionContext = {
      requestedCommand: "msg:fetch",
    };
    const result: MsgReadResolutionResult = resolveMsgReadCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toBe("unknown command: msg:fetch");
  });
});
