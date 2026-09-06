import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveMailboxCommand,
  type MailboxCommandResolutionContext,
  type MailboxCommandResolutionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788681360394-6rwuu8.ts";

describe("Defect Remediation: defect-cli-1788681360394-6rwuu8", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788681360394-6rwuu8");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("unknown command: msg")).toBe(true);
  });

  test("resolves bare msg to default msg:send", () => {
    const ctx: MailboxCommandResolutionContext = {
      rawCommand: "msg",
    };
    const result: MailboxCommandResolutionResult = resolveMailboxCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("msg:send");
    expect(result.subcommands).toContain("msg:send");
  });

  test("rejects invalid non-mailbox command", () => {
    const ctx: MailboxCommandResolutionContext = {
      rawCommand: "msg:unknown",
    };
    const result: MailboxCommandResolutionResult = resolveMailboxCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toBe("unknown command: msg:unknown");
  });
});
